'use strict';

const crypto = require('node:crypto');

const COST = 16384;
const KEY_LENGTH = 64;

/** Hashes a password with scrypt and a random 16-byte salt. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH, { N: COST, r: 8, p: 1 });
  return `scrypt$${COST}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Constant-time comparison of a password against a stored scrypt hash. */
function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.scryptSync(String(password), salt, expected.length, { N: cost, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
