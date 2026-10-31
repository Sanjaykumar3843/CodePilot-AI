const userRepo = require('../db/userRepository');
const sessionRepo = require('../db/sessionRepository');

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function validateRegistrationInput({ email, password, name }) {
  if (typeof email !== 'string' || !email.trim()) {
    const error = new Error('Email is required.');
    error.status = 400;
    throw error;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 255) {
    const error = new Error('A valid email address is required.');
    error.status = 400;
    throw error;
  }

  if (typeof password !== 'string' || password.length < 8) {
    const error = new Error('Password must be at least 8 characters long.');
    error.status = 400;
    throw error;
  }

  if (password.length > 128) {
    const error = new Error('Password must not exceed 128 characters.');
    error.status = 400;
    throw error;
  }

  return {
    email: normalizedEmail,
    password,
    name: typeof name === 'string' ? name.trim().slice(0, 100) : '',
  };
}

function validateLoginInput({ email, password }) {
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    const error = new Error('Email and password are required.');
    error.status = 400;
    throw error;
  }

  return {
    email: email.trim().toLowerCase(),
    password,
  };
}

async function register({ email, password, name }) {
  const validated = validateRegistrationInput({ email, password, name });

  const existing = await userRepo.findByEmail(validated.email);
  if (existing) {
    const error = new Error('An account with this email already exists.');
    error.status = 409;
    throw error;
  }

  const user = await userRepo.createUser(validated);
  const session = await sessionRepo.createSession(user.id);

  return {
    user,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

async function login({ email, password }) {
  const validated = validateLoginInput({ email, password });

  const userWithHash = await userRepo.findByEmail(validated.email);
  if (!userWithHash) {
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  const isValid = await userRepo.verifyPassword(validated.password, userWithHash.password_hash);
  if (!isValid) {
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  // Session regeneration after login (OWASP recommendation)
  const session = await sessionRepo.createSession(userWithHash.id);
  const user = userRepo.sanitizeUser(userWithHash);

  return {
    user,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

async function logout(token) {
  if (!token) return;
  await sessionRepo.deleteSession(token);
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await sessionRepo.getSession(token);
  return session ? session.user : null;
}

module.exports = {
  validateRegistrationInput,
  validateLoginInput,
  register,
  login,
  logout,
  getSessionUser,
};
