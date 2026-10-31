const express = require('express');
const { aiLimiter } = require('../middleware/rateLimiter');
const aiService = require('../services/aiService');
const { groqModel, groqApiKey } = require('../config');

function createAiRouter() {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      success: true,
      configured: Boolean(groqApiKey),
      model: groqModel,
      provider: 'Groq',
    });
  });

  router.post('/generate', aiLimiter, async (req, res, next) => {
    try {
      const { prompt, contextFiles } = req.body || {};
      const result = await aiService.generatePlan({ prompt, contextFiles });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAiRouter };

