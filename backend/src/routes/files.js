const express = require('express');
const { requireAuth } = require('../middleware/auth');
const fileSystemService = require('../services/fileSystemService');

function createFilesRouter() {
  const router = express.Router();

  // Get project file tree
  router.get('/tree', (req, res, next) => {
    try {
      const tree = fileSystemService.scanProjectTree();
      res.json({ success: true, tree });
    } catch (error) {
      next(error);
    }
  });

  // Read a single file securely
  router.get('/read', (req, res, next) => {
    try {
      const targetPath = req.query.path;
      if (!targetPath) {
        return res.status(400).json({ success: false, error: 'Path query parameter is required.' });
      }
      const file = fileSystemService.readFile(targetPath);
      res.json({ success: true, file });
    } catch (error) {
      next(error);
    }
  });

  // Calculate unified diff
  router.post('/diff', (req, res, next) => {
    try {
      const { path: targetPath, proposedContent } = req.body || {};
      if (!targetPath || typeof proposedContent !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Both path and proposedContent string are required.',
        });
      }
      const diff = fileSystemService.createUnifiedDiff(targetPath, proposedContent);
      res.json({ success: true, diff });
    } catch (error) {
      next(error);
    }
  });

  // Apply a file change to disk (requires authentication)
  router.post('/apply', requireAuth, (req, res, next) => {
    try {
      const { path: targetPath, content } = req.body || {};
      if (!targetPath || typeof content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Both path and content are required to apply changes.',
        });
      }
      const result = fileSystemService.applyFileChange(targetPath, content);
      res.json({ success: true, result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createFilesRouter };

