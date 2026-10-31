require('dotenv').config();
const http = require('node:http');
const { createApp } = require('./src/app');
const { port } = require('./src/config');
const { pool, testConnection, runMigrations } = require('./src/db/index');
const { initEditorWebSocket } = require('./src/services/editorSocket');

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);

  // Initialize WebSocket integration for editor communication
  const wss = initEditorWebSocket(server);

  // Attempt database connection and schema setup if configured
  const dbHealth = await testConnection();
  if (dbHealth.connected) {
    console.log(`[DB] Connected to PostgreSQL. Verifying schema migrations...`);
    try {
      await runMigrations();
      console.log(`[DB] Schema migrations applied successfully.`);
    } catch (migErr) {
      console.error(`[DB] Migration check encountered an error:`, migErr.message);
    }
  } else {
    console.log(`[DB] Running in local dual-mode with atomic JSON persistence: ${dbHealth.message}`);
  }

  server.listen(port, () => {
    console.log(`CodePilot AI backend running at http://localhost:${port}`);
    console.log(`CodePilot AI WebSocket bridge available at ws://localhost:${port}/ws/editor`);
  });

  // Graceful shutdown with resource draining
  let isShuttingDown = false;
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[${signal}] Gracefully shutting down CodePilot AI backend...`);

    // Force exit after 5 seconds if connection drain takes too long
    const forceExitTimer = setTimeout(() => {
      console.error('[Shutdown] Forcefully terminating active lingering handles.');
      process.exit(1);
    }, 5000);
    forceExitTimer.unref();

    // 1. Close WebSocket clients
    if (wss && wss.clients) {
      for (const client of wss.clients) {
        try {
          client.close(1001, 'Server is shutting down');
        } catch {
          // Ignore close errors
        }
      }
    }

    // 2. Close PostgreSQL Pool
    if (pool) {
      try {
        await pool.end();
        console.log('[DB] PostgreSQL pool drained.');
      } catch (poolErr) {
        console.error('[DB] Error draining pool:', poolErr.message);
      }
    }

    // 3. Close HTTP Server
    server.close(() => {
      console.log('[HTTP] Server stopped listening. Shutdown clean.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal error starting CodePilot AI backend:', err);
  process.exit(1);
});
