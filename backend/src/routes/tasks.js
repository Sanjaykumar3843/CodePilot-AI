const express = require('express');
const taskRepo = require('../db/taskRepository');

function createTasksRouter(taskStore) {
  const router = express.Router();

  router.get('/', async (req, res, next) => {
    try {
      const tasks = await taskRepo.getTasks(taskStore);
      res.json({ success: true, tasks });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    const { title, category, status, diff } = req.body || {};

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'A task title is required.',
      });
    }

    const normalizedTitle = title.trim();

    if (normalizedTitle.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Task titles must be 500 characters or fewer.',
      });
    }

    try {
      const userId = req.user ? req.user.id : null;
      const task = await taskRepo.createTask(
        {
          title: normalizedTitle,
          category: typeof category === 'string' && category.trim() ? category.trim() : 'Custom task',
          status: typeof status === 'string' && status.trim() ? status.trim() : 'Draft',
          diff: typeof diff === 'string' ? diff : null,
          userId,
        },
        taskStore
      );

      res.status(201).json({ success: true, task });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createTasksRouter };
