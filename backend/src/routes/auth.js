const express = require('express');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const authService = require('../services/authService');
const { isProduction } = require('../config');

function createAuthRouter() {
  const router = express.Router();

  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  router.post('/register', authLimiter, async (req, res, next) => {
    try {
      const { email, password, name } = req.body || {};
      const result = await authService.register({ email, password, name });

      res.cookie('codepilot_session', result.token, cookieOptions);
      res.status(201).json({
        success: true,
        user: result.user,
        token: result.token,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', authLimiter, async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      const result = await authService.login({ email, password });

      res.cookie('codepilot_session', result.token, cookieOptions);
      res.json({
        success: true,
        user: result.user,
        token: result.token,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = req.sessionToken;
      if (token) {
        await authService.logout(token);
      }
      res.clearCookie('codepilot_session');
      res.json({ success: true, message: 'Logged out successfully.' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({
      success: true,
      user: req.user,
    });
  });

  return router;
}

module.exports = { createAuthRouter };
