const { getSessionUser } = require('../services/authService');

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  const customHeader = req.headers['x-session-token'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)codepilot_session=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  return null;
}

async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    req.sessionToken = null;
    return next();
  }

  try {
    const user = await getSessionUser(token);
    req.user = user;
    req.sessionToken = token;
  } catch (error) {
    req.user = null;
    req.sessionToken = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in.',
      code: 'UNAUTHORIZED',
    });
  }
  next();
}

module.exports = {
  extractToken,
  authenticate,
  requireAuth,
};
