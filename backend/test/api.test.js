require('dotenv').config();
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createApp } = require('../src/app');
const { createTaskStore } = require('../src/services/taskStore');
const { initEditorWebSocket } = require('../src/services/editorSocket');
const { WebSocket } = require('ws');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-api-test-'));
const taskStore = createTaskStore(path.join(temporaryDirectory, 'tasks.json'));
const server = createApp(taskStore).listen(0);
initEditorWebSocket(server);
let baseUrl;
let wsUrl;

before(async () => {
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws/editor`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('health endpoint reports a healthy backend with db and ai details', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'healthy');
  assert.ok(body.database !== undefined);
  assert.ok(body.ai !== undefined);
  assert.equal(typeof body.ai.configured, 'boolean');
});

test('task API validates, creates, and reloads persisted tasks', async () => {
  const invalidResponse = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '  ' }),
  });

  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).success, false);

  const tooLongResponse = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'x'.repeat(501) }),
  });

  assert.equal(tooLongResponse.status, 400);

  const createResponse = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '  Create a task  ' }),
  });
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(created.task.title, 'Create a task');
  assert.equal(created.task.category, 'Custom task');

  const listResponse = await fetch(`${baseUrl}/api/tasks`);
  const listed = await listResponse.json();

  assert.equal(listResponse.status, 200);
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].id, created.task.id);
});

test('authentication flow: registration, login, protected me, and logout', async () => {
  const testEmail = `engineer_${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  const testName = 'Senior Engineer';

  // 1. Validation failure: Short password
  const badPassRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'short', name: testName }),
  });
  assert.equal(badPassRes.status, 400);

  // 2. Successful Registration
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword, name: testName }),
  });
  const regBody = await regRes.json();
  assert.equal(regRes.status, 201);
  assert.equal(regBody.success, true);
  assert.equal(regBody.user.email, testEmail);
  assert.equal(regBody.user.name, testName);
  assert.ok(regBody.token);

  const token = regBody.token;

  // 3. Duplicate Registration rejection
  const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  assert.equal(dupRes.status, 409);

  // 4. Access protected /api/auth/me with token
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meBody = await meRes.json();
  assert.equal(meRes.status, 200);
  assert.equal(meBody.success, true);
  assert.equal(meBody.user.email, testEmail);

  // 5. Access protected /api/auth/me without token fails with 401
  const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(unauthRes.status, 401);

  // 6. Login with invalid password
  const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'WrongPassword!' }),
  });
  assert.equal(badLoginRes.status, 401);

  // 7. Successful Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const loginBody = await loginRes.json();
  assert.equal(loginRes.status, 200);
  assert.equal(loginBody.success, true);
  assert.ok(loginBody.token);

  // 8. Logout
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });
  assert.equal(logoutRes.status, 200);
});

test('file operations: path traversal protection and diff generation', async () => {
  // 1. Path traversal attempt must be blocked
  const traversalRes = await fetch(
    `${baseUrl}/api/files/read?path=${encodeURIComponent('../../../windows/system32/cmd.exe')}`
  );
  assert.equal(traversalRes.status, 403);

  // 2. Sensitive file (.env) access must be blocked
  const envRes = await fetch(`${baseUrl}/api/files/read?path=.env`);
  assert.equal(envRes.status, 403);

  // 3. Read valid file (backend/package.json)
  const validRes = await fetch(`${baseUrl}/api/files/read?path=backend/package.json`);
  const validBody = await validRes.json();
  assert.equal(validRes.status, 200);
  assert.equal(validBody.success, true);
  assert.ok(validBody.file.content.includes('"name": "backend"'));

  // 4. Generate diff
  const diffRes = await fetch(`${baseUrl}/api/files/diff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'backend/package.json',
      proposedContent: validBody.file.content + '\n// comment',
    }),
  });
  const diffBody = await diffRes.json();
  assert.equal(diffRes.status, 200);
  assert.equal(diffBody.success, true);
  assert.ok(diffBody.diff.patch.includes('+// comment'));

  // 5. Applying files requires authentication
  const unauthApply = await fetch(`${baseUrl}/api/files/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'backend/test/test_dummy.txt',
      content: 'test content',
    }),
  });
  assert.equal(unauthApply.status, 401);
});

test('AI status reports configured model information safely', async () => {
  const statusRes = await fetch(`${baseUrl}/api/ai/status`);
  const statusBody = await statusRes.json();

  assert.equal(statusRes.status, 200);
  assert.equal(statusBody.success, true);
  assert.equal(statusBody.provider, 'Groq');
  assert.equal(typeof statusBody.configured, 'boolean');
  assert.ok(statusBody.model);

  // If Groq is configured, test /api/ai/generate endpoint
  if (statusBody.configured) {
    const aiGenRes = await fetch(`${baseUrl}/api/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Create a greeting helper function in src/utils/greet.js',
      }),
    });
    const aiGenBody = await aiGenRes.json();
    assert.equal(aiGenRes.status, 200);
    assert.equal(aiGenBody.success, true);
    assert.ok(Array.isArray(aiGenBody.files));
  }
});

test('editor WebSocket handles connection, handshake, ping/pong, and status', async () => {
  const client = new WebSocket(wsUrl);

  const messages = [];
  await new Promise((resolve, reject) => {
    client.on('open', resolve);
    client.on('error', reject);
    client.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });
  });

  // Verify initial handshake message
  assert.ok(messages.length >= 1);
  assert.equal(messages[0].type, 'handshake');

  // Send ping
  client.send(JSON.stringify({ type: 'ping', correlationId: 'test-ping-1' }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const pongMsg = messages.find((m) => m.correlationId === 'test-ping-1');
  assert.ok(pongMsg);
  assert.equal(pongMsg.type, 'pong');

  // Send status request
  client.send(JSON.stringify({ type: 'status', correlationId: 'test-status-1' }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const statusMsg = messages.find((m) => m.correlationId === 'test-status-1');
  assert.ok(statusMsg);
  assert.equal(statusMsg.type, 'status');
  assert.ok(statusMsg.activeClients >= 1);

  client.close();
});
