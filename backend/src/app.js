const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const { corsOrigins, groqApiKey, groqModel } = require('./config');
const { testConnection } = require('./db/index');
const { authenticate } = require('./middleware/auth');
const { generalLimiter } = require('./middleware/rateLimiter');
const { requestLogger } = require('./middleware/requestLogger');
const { createAuthRouter } = require('./routes/auth');
const { createTasksRouter } = require('./routes/tasks');
const { createFilesRouter } = require('./routes/files');
const { createAiRouter } = require('./routes/ai');
const { createTaskStore } = require('./services/taskStore');

function createApp(taskStore = createTaskStore()) {
  const app = express();

  // 1. Structured Request Logging & Correlation ID (x-request-id)
  app.use(requestLogger);

  // 2. Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // 3. Cross-Origin Resource Sharing with credentials support
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin || corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error(`Origin ${origin} not allowed by CORS.`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-session-token', 'x-request-id'],
    })
  );

  // 4. General rate limiting across endpoints
  app.use(generalLimiter);

  // 5. Body parser with size limits
  app.use(express.json({ limit: '2mb' }));

  // 6. Global authentication session extraction (attaches req.user and req.sessionToken)
  app.use(authenticate);

  // 7. Liveness & Readiness Probes (Industry Standard Cloud & Kubernetes)
  app.get('/api/health/live', (req, res) => {
    res.json({ success: true, status: 'alive', uptime: process.uptime() });
  });

  app.get('/api/health/ready', async (req, res) => {
    const dbStatus = await testConnection();
    res.json({
      success: true,
      status: 'ready',
      database: dbStatus,
      ai: { configured: Boolean(groqApiKey), model: groqModel },
    });
  });

  // Main Health Diagnostics Endpoint
  app.get('/api/health', async (req, res) => {
    const dbStatus = await testConnection();
    res.json({
      success: true,
      message: 'CodePilot AI backend is running!',
      status: 'healthy',
      database: dbStatus,
      ai: {
        configured: Boolean(groqApiKey),
        model: groqModel,
      },
      version: '1.0.0',
    });
  });

  // Feature Routers
  app.use('/api/auth', createAuthRouter());
  app.use('/api/tasks', createTasksRouter(taskStore));
  app.use('/api/files', createFilesRouter());
  app.use('/api/ai', createAiRouter());

  // Centralized Error Handling Middleware with Request Correlation
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    const reqId = req.id ? `[req:${req.id.slice(0, 8)}] ` : '';
    console.error(`[API Error] ${reqId}${req.method} ${req.url}:`, error.message || error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    const message = status < 500 ? error.message : 'An unexpected server error occurred.';

    res.status(status).json({
      success: false,
      error: message,
      code: error.code || undefined,
      requestId: req.id || undefined,
    });
  });

  return app;
}

module.exports = { createApp };
