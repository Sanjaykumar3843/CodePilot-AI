const { randomUUID } = require('node:crypto');

function requestLogger(req, res, next) {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const isTest = process.env.NODE_ENV === 'test';

    // In non-test environments, output structured request log
    if (!isTest) {
      const statusColor = res.statusCode >= 500 ? 'ERR' : res.statusCode >= 400 ? 'WARN' : 'OK';
      console.log(
        `[HTTP] ${req.method} ${req.originalUrl || req.url} ${res.statusCode} (${duration}ms) - id: ${requestId.slice(0, 8)} [${statusColor}]`
      );
    }
  });

  next();
}

module.exports = { requestLogger };

