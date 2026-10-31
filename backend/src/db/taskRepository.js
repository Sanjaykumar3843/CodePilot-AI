const { randomUUID } = require('node:crypto');
const db = require('./index');
const { createTaskStore } = require('../services/taskStore');

const defaultTaskStore = createTaskStore();

/**
 * Retrieves tasks from PostgreSQL or fallback JSON store.
 */
async function getTasks(taskStore = defaultTaskStore) {
  if (db.getIsPostgresAvailable()) {
    const res = await db.query(
      `SELECT id, user_id AS "userId", title, category, status, diff, created_at AS "createdAt"
       FROM tasks
       ORDER BY created_at DESC`
    );
    return res.rows;
  }

  return taskStore.readTasks();
}

/**
 * Creates and persists a task to PostgreSQL or fallback JSON store.
 */
async function createTask({ title, category = 'Custom task', userId = null, status = 'Draft', diff = null }, taskStore = defaultTaskStore) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  if (db.getIsPostgresAvailable()) {
    const res = await db.query(
      `INSERT INTO tasks (id, user_id, title, category, status, diff, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id AS "userId", title, category, status, diff, created_at AS "createdAt"`,
      [id, userId, title, category, status, diff, createdAt]
    );
    return res.rows[0];
  }

  const task = {
    id,
    userId,
    title,
    category,
    status,
    diff,
    createdAt,
  };

  taskStore.writeTasks([task, ...taskStore.readTasks()]);
  return task;
}

module.exports = {
  getTasks,
  createTask,
};

