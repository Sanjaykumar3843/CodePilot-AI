const fs = require('node:fs');
const path = require('node:path');

function createTaskStore(filePath = path.join(__dirname, '..', '..', 'data', 'tasks.json')) {
  function readTasks() {
    let contents;

    try {
      contents = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }

    const tasks = JSON.parse(contents);

    if (!Array.isArray(tasks)) {
      throw new Error('Task data must be a JSON array.');
    }

    return tasks;
  }

  function writeTasks(tasks) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const temporaryFile = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(tasks, null, 2));
    fs.renameSync(temporaryFile, filePath);
  }

  return { readTasks, writeTasks };
}

module.exports = { createTaskStore };
