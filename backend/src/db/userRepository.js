const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('./index');

const FALLBACK_USERS_PATH = path.join(__dirname, '..', '..', 'data', 'users.json');

function readFallbackUsers() {
  try {
    const raw = fs.readFileSync(FALLBACK_USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeFallbackUsers(users) {
  fs.mkdirSync(path.dirname(FALLBACK_USERS_PATH), { recursive: true });
  const tmp = `${FALLBACK_USERS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmp, FALLBACK_USERS_PATH);
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

async function findByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  if (db.getIsPostgresAvailable()) {
    const res = await db.query(
      'SELECT id, email, password_hash, name, created_at, updated_at FROM users WHERE email = $1 LIMIT 1',
      [normalized]
    );
    return res.rows[0] || null;
  }

  const users = readFallbackUsers();
  const found = users.find((u) => u.email === normalized);
  return found || null;
}

async function findById(id) {
  if (!id) return null;

  if (db.getIsPostgresAvailable()) {
    const res = await db.query(
      'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
      [id]
    );
    return res.rows[0] || null;
  }

  const users = readFallbackUsers();
  const found = users.find((u) => u.id === id);
  return sanitizeUser(found);
}

async function createUser({ email, password, name }) {
  const normalized = normalizeEmail(email);
  const trimmedName = typeof name === 'string' && name.trim() ? name.trim() : normalized.split('@')[0];
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const id = randomUUID();
  const now = new Date().toISOString();

  if (db.getIsPostgresAvailable()) {
    try {
      const res = await db.query(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, email, name, created_at, updated_at`,
        [id, normalized, passwordHash, trimmedName, now]
      );
      return res.rows[0];
    } catch (pgErr) {
      if (pgErr.code === '23505') {
        const err = new Error('An account with this email already exists.');
        err.status = 409;
        throw err;
      }
      throw pgErr;
    }
  }

  const users = readFallbackUsers();
  if (users.some((u) => u.email === normalized)) {
    const err = new Error('An account with this email already exists.');
    err.status = 409;
    throw err;
  }

  const newUser = {
    id,
    email: normalized,
    password_hash: passwordHash,
    name: trimmedName,
    created_at: now,
    updated_at: now,
  };

  users.push(newUser);
  writeFallbackUsers(users);
  return sanitizeUser(newUser);
}

async function verifyPassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  verifyPassword,
  normalizeEmail,
  sanitizeUser,
};
