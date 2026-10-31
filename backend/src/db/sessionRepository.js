const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const db = require('./index');
const userRepo = require('./userRepository');

const FALLBACK_SESSIONS_PATH = path.join(__dirname, '..', '..', 'data', 'sessions.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readFallbackSessions() {
  try {
    const raw = fs.readFileSync(FALLBACK_SESSIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeFallbackSessions(sessions) {
  fs.mkdirSync(path.dirname(FALLBACK_SESSIONS_PATH), { recursive: true });
  const tmp = `${FALLBACK_SESSIONS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2), 'utf8');
  fs.renameSync(tmp, FALLBACK_SESSIONS_PATH);
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const createdAt = new Date().toISOString();

  if (db.getIsPostgresAvailable()) {
    await db.query(
      `INSERT INTO sessions (id, user_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      [token, userId, expiresAt, createdAt]
    );
    return { token, userId, expiresAt };
  }

  const sessions = readFallbackSessions();
  // Filter out expired sessions
  const now = Date.now();
  const activeSessions = sessions.filter((s) => new Date(s.expires_at).getTime() > now);

  const newSession = {
    id: token,
    user_id: userId,
    expires_at: expiresAt,
    created_at: createdAt,
  };

  activeSessions.push(newSession);
  writeFallbackSessions(activeSessions);

  return { token, userId, expiresAt };
}

async function getSession(token) {
  if (!token || typeof token !== 'string') return null;

  if (db.getIsPostgresAvailable()) {
    const res = await db.query(
      `SELECT s.id, s.user_id, s.expires_at,
              u.email, u.name, u.created_at as user_created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = $1 AND s.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [token]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      token: row.id,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        created_at: row.user_created_at,
      },
      expires_at: row.expires_at,
    };
  }

  const sessions = readFallbackSessions();
  const now = Date.now();
  const session = sessions.find((s) => s.id === token && new Date(s.expires_at).getTime() > now);

  if (!session) return null;

  // Fetch user
  const user = await userRepo.findById(session.user_id);
  if (!user) return null;

  return {
    token: session.id,
    user,
    expires_at: session.expires_at,
  };
}

async function deleteSession(token) {
  if (!token) return false;

  if (db.getIsPostgresAvailable()) {
    await db.query('DELETE FROM sessions WHERE id = $1', [token]);
    return true;
  }

  const sessions = readFallbackSessions();
  const filtered = sessions.filter((s) => s.id !== token);
  writeFallbackSessions(filtered);
  return true;
}

module.exports = {
  createSession,
  getSession,
  deleteSession,
};
