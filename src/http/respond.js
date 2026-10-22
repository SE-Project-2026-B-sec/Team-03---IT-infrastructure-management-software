'use strict';

/** Headers sent on every response (PRJ-SR-004, STRIDE: information disclosure / tampering). */
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
});

const HSTS = 'max-age=31536000; includeSubDomains';

function applySecurityHeaders(res, { tls }) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (tls) res.setHeader('Strict-Transport-Security', HSTS);
}

function send(res, status, body, contentType, extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', payload.length);
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(res.req && res.req.method === 'HEAD' ? undefined : payload);
}

function sendJson(res, status, body, headers) {
  if (status === 204) {
    res.statusCode = 204;
    res.end();
    return;
  }
  send(res, status, JSON.stringify(body), 'application/json; charset=utf-8', headers);
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** RFC 7807 problem details. Never includes stack traces. */
function sendProblem(res, { status, title, detail, extra = {} }, instance, requestId) {
  const headers = {};
  if (extra.retryAfterSeconds) headers['Retry-After'] = String(extra.retryAfterSeconds);
  const { retryAfterSeconds, ...rest } = extra;
  const body = { type: `/problems/${slug(title)}`, title, status, detail, instance, requestId, ...rest };
  if (retryAfterSeconds) body.retryAfterSeconds = retryAfterSeconds;
  send(res, status, JSON.stringify(body), 'application/problem+json; charset=utf-8', headers);
}

module.exports = { applySecurityHeaders, send, sendJson, sendProblem, SECURITY_HEADERS };
