'use strict';

const crypto = require('node:crypto');

const ISSUER = 'itim-api';
const AUDIENCE = 'itim-clients';

const b64url = (value) => Buffer.from(value).toString('base64url');

/** Signs an HS256 JSON Web Token (PRJ-SR-002). */
function signToken(claims, secret, { expiresInSeconds, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    ...claims,
    iat,
    exp: iat + expiresInSeconds,
    iss: ISSUER,
    aud: AUDIENCE,
    jti: crypto.randomUUID()
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verifies signature, algorithm, expiry, issuer and audience. Throws an Error
 * with a short reason on any failure; never trusts the token's own "alg".
 */
function verifyToken(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string') throw new Error('Malformed token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Malformed token');
  }
  if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported token algorithm');
  }

  const expected = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedPayload}`).digest();
  const given = Buffer.from(encodedSignature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('Invalid token signature');
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= Math.floor(now / 1000)) {
    throw new Error('Token expired');
  }
  if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) {
    throw new Error('Invalid token claims');
  }
  return payload;
}

module.exports = { signToken, verifyToken, ISSUER, AUDIENCE };
