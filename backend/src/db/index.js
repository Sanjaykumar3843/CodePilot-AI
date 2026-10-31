const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { databaseUrl } = require('../config');

let pool = null;
let isPostgresAvailable = false;
let connectionError = null;

if (databaseUrl) {
  try {
    pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      max: 10,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle PostgreSQL client:', err.message);
    });
  } catch (error) {
    connectionError = error.message;
    pool = null;
  }
} else {
  connectionError = 'DATABASE_URL environment variable is not configured.';
}

async function testConnection() {
  if (!pool) {
    return {
      connected: false,
      driver: 'file-fallback',
      message: connectionError || 'PostgreSQL pool not initialized.',
    };
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1 AS healthcheck');
      isPostgresAvailable = true;
      connectionError = null;
      return { connected: true, driver: 'postgresql' };
    } finally {
      client.release();
    }
  } catch (error) {
    isPostgresAvailable = false;
    connectionError = error.message;
    return {
      connected: false,
      driver: 'file-fallback',
      message: error.message,
    };
  }
}

async function runMigrations() {
  if (!pool || !isPostgresAvailable) return false;

  const schemaPath = path.join(__dirname, 'schema.sql');
  const ddl = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(ddl);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DB] Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function query(text, params = []) {
  if (!pool || !isPostgresAvailable) {
    throw new Error('PostgreSQL is not currently available.');
  }
  return pool.query(text, params);
}

module.exports = {
  pool,
  testConnection,
  runMigrations,
  query,
  getIsPostgresAvailable: () => isPostgresAvailable,
};
