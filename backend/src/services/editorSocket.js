const { WebSocketServer, WebSocket } = require('ws');
const fileSystemService = require('./fileSystemService');

let wss = null;

function initEditorWebSocket(httpServer) {
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws/editor',
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(ws, message);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON message payload.' }));
      }
    });

    // Send initial handshake
    ws.send(
      JSON.stringify({
        type: 'handshake',
        version: '1.0.0',
        message: 'Connected to CodePilot AI Editor Bridge',
      })
    );
  });

  // Heartbeat interval to clean up stale connections
  const interval = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  interval.unref();

  httpServer.on('close', () => {
    clearInterval(interval);
    if (wss) {
      wss.close();
    }
  });

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

function handleClientMessage(ws, message) {
  const { type, payload, correlationId } = message || {};

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', correlationId, timestamp: Date.now() }));
      break;

    case 'status':
      ws.send(
        JSON.stringify({
          type: 'status',
          correlationId,
          activeClients: wss ? wss.clients.size : 0,
          timestamp: Date.now(),
        })
      );
      break;

    case 'open_file': {
      const targetPath = payload?.path;
      const line = Number.isInteger(payload?.line) ? payload.line : 1;

      if (!targetPath || !fileSystemService.isPathSafe(targetPath)) {
        ws.send(
          JSON.stringify({
            type: 'open_file_response',
            correlationId,
            success: false,
            error: 'File path is unauthorized, forbidden, or invalid.',
          })
        );
        return;
      }

      // Broadcast reveal request to other connected editor instances
      let notifiedCount = 0;
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: 'reveal_file',
              payload: { path: targetPath, line },
            })
          );
          notifiedCount++;
        }
      }

      ws.send(
        JSON.stringify({
          type: 'open_file_response',
          correlationId,
          success: true,
          path: targetPath,
          line,
          notifiedClients: notifiedCount,
        })
      );
      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: 'unrecognized_command',
          correlationId,
          command: type,
        })
      );
  }
}

function getConnectedClientsCount() {
  return wss ? wss.clients.size : 0;
}

module.exports = {
  initEditorWebSocket,
  getConnectedClientsCount,
};
