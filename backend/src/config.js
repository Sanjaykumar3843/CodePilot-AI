const path = require('node:path');

const defaultOrigins = ['http://localhost:5173', 'http://localhost:5174'];

function parseOrigins(value) {
  if (!value) return defaultOrigins;

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const projectRoot = path.resolve(
  process.env.PROJECT_ROOT || path.join(__dirname, '..', '..')
);

module.exports = {
  port,
  corsOrigins: parseOrigins(process.env.FRONTEND_ORIGINS),
  projectRoot,
  databaseUrl: process.env.DATABASE_URL || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  sessionSecret: process.env.SESSION_SECRET || 'codepilot-dev-secret-key-change-in-production',
  isProduction: process.env.NODE_ENV === 'production',
};
