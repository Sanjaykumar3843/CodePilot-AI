const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const diff = require('diff');
const { projectRoot } = require('../config');

// Sensitive and non-source file patterns blocked from reading or writing
const FORBIDDEN_PATTERNS = [
  /^\.env/i,
  /\.env(\..+)?$/i,
  /\.(key|pem|cert|p12|pfx|crt)$/i,
  /id_rsa/i,
  /node_modules/i,
  /\.git(\/|\\|$)/i,
  /tasks\.json$/i,
  /users\.json$/i,
  /sessions\.json$/i,
];

const ALLOWED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.md', '.svg', '.txt'
]);

function isPathSafe(targetPath, baseDir = projectRoot) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);

  // Must strictly start with base directory
  if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
    return false;
  }

  // Check forbidden patterns against relative path
  const rel = path.relative(resolvedBase, resolvedTarget);
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(rel)) {
      return false;
    }
  }

  return true;
}

function resolveSafePath(relativePath, baseDir = projectRoot) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    const error = new Error('File path is required.');
    error.status = 400;
    throw error;
  }

  const normalized = relativePath.trim();
  if (path.isAbsolute(normalized)) {
    // If absolute, ensure it starts with projectRoot
    const resolved = path.resolve(normalized);
    if (!isPathSafe(resolved, baseDir)) {
      const error = new Error('Path traversal or unauthorized path detected.');
      error.status = 403;
      throw error;
    }
    return resolved;
  }

  const resolved = path.resolve(baseDir, normalized);
  if (!isPathSafe(resolved, baseDir)) {
    const error = new Error('Path traversal or unauthorized path detected.');
    error.status = 403;
    throw error;
  }

  return resolved;
}

function getFileHash(content) {
  return createHash('sha256').update(content || '', 'utf8').digest('hex');
}

function readFile(relativePath) {
  const safePath = resolveSafePath(relativePath);

  if (!fs.existsSync(safePath)) {
    const error = new Error(`File not found: ${relativePath}`);
    error.status = 404;
    throw error;
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    const error = new Error(`Specified path is a directory: ${relativePath}`);
    error.status = 400;
    throw error;
  }

  if (stat.size > 1024 * 1024) { // Max 1MB
    const error = new Error(`File exceeds maximum readable size limit of 1MB.`);
    error.status = 413;
    throw error;
  }

  const content = fs.readFileSync(safePath, 'utf8');
  return {
    path: path.relative(projectRoot, safePath).replace(/\\/g, '/'),
    content,
    hash: getFileHash(content),
    size: stat.size,
  };
}

function scanProjectTree(dir = projectRoot, maxDepth = 4, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];

  const entries = [];
  let items = [];
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');

    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'dist' || item.name === '.vite-temp') {
      continue;
    }

    if (item.isDirectory()) {
      entries.push({
        name: item.name,
        path: relPath,
        type: 'directory',
        children: scanProjectTree(fullPath, maxDepth, currentDepth + 1),
      });
    } else {
      const ext = path.extname(item.name).toLowerCase();
      if (ALLOWED_EXTENSIONS.has(ext)) {
        entries.push({
          name: item.name,
          path: relPath,
          type: 'file',
          extension: ext,
        });
      }
    }
  }

  return entries;
}

function createUnifiedDiff(relativePath, proposedContent) {
  const safePath = resolveSafePath(relativePath);
  let originalContent = '';
  let exists = false;

  if (fs.existsSync(safePath)) {
    originalContent = fs.readFileSync(safePath, 'utf8');
    exists = true;
  }

  const fileName = path.relative(projectRoot, safePath).replace(/\\/g, '/');
  const patch = diff.createTwoFilesPatch(
    `a/${fileName}`,
    `b/${fileName}`,
    originalContent,
    proposedContent,
    exists ? 'Current' : 'New File',
    'Proposed'
  );

  return {
    path: fileName,
    isNew: !exists,
    patch,
    originalContent,
    proposedContent,
    originalHash: getFileHash(originalContent),
    proposedHash: getFileHash(proposedContent),
  };
}

function applyFileChange(relativePath, newContent) {
  const safePath = resolveSafePath(relativePath);
  const dir = path.dirname(safePath);
  fs.mkdirSync(dir, { recursive: true });

  const exists = fs.existsSync(safePath);
  let backupPath = null;

  // Create temporary backup if modifying existing file
  if (exists) {
    backupPath = `${safePath}.cpbackup`;
    fs.copyFileSync(safePath, backupPath);
  }

  try {
    // Atomic write via temp file
    const tempFile = `${safePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, newContent, 'utf8');
    fs.renameSync(tempFile, safePath);

    // Clean up backup after successful write
    if (backupPath && fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    return {
      success: true,
      path: path.relative(projectRoot, safePath).replace(/\\/g, '/'),
      isNew: !exists,
      hash: getFileHash(newContent),
    };
  } catch (error) {
    // Restore backup if write failed
    if (backupPath && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, safePath);
      fs.unlinkSync(backupPath);
    }
    throw error;
  }
}

module.exports = {
  isPathSafe,
  resolveSafePath,
  readFile,
  scanProjectTree,
  createUnifiedDiff,
  applyFileChange,
  getFileHash,
};
