'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { startServer, TEST_CONFIG, DEMO_PASSWORD } = require('./helpers');
const { signToken } = require('../src/security/jwt');
const { createVault } = require('../src/security/vault');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itim-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  } catch {
    return null;
  }
  return { dir, key, cert };
}

function tlsGet(port, ca, tlsOptions) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host: '127.0.0.1', port, path: '/health/live', ca, servername: 'localhost', checkServerIdentity: () => undefined, ...tlsOptions },
      (res) => {
        const protocol = res.socket.getProtocol();
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, protocol, headers: res.headers }));
      }
    );
    req.on('error', reject);
  });
}

function httpGet(port, pathName) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location });
    }).on('error', reject);
  });
}

test('TC-SEC-01 serves only TLS 1.3 with HSTS and redirects plain HTTP', async (t) => {
  const cert = makeCertificate();
  if (!cert) {
    t.skip('openssl is not available to generate a test certificate');
    return;
  }
  const tls = await startServer({ tlsCertFile: cert.cert, tlsKeyFile: cert.key, httpRedirectPort: 0 });
  try {
    const ca = fs.readFileSync(cert.cert);
    const ok = await tlsGet(tls.port, ca, { minVersion: 'TLSv1.3' });
    assert.equal(ok.status, 200);
    assert.equal(ok.protocol, 'TLSv1.3');
    assert.match(ok.headers['strict-transport-security'], /max-age=31536000/);

    await assert.rejects(tlsGet(tls.port, ca, { maxVersion: 'TLSv1.2' }), 'TLS 1.2 handshakes are refused');

    const redirect = await httpGet(tls.redirectPort, '/api/v1/assets?x=1');
    assert.equal(redirect.status, 301);
    assert.equal(redirect.location, `https://127.0.0.1:${tls.port}/api/v1/assets?x=1`);
  } finally {
    await tls.stop();
    fs.rmSync(cert.dir, { recursive: true, force: true });
  }
});

test('TC-SEC-02 requires a valid, unexpired JWT and enforces role permissions', async () => {
  const anon = await s.request('GET', '/api/v1/assets');
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('content-type'), /application\/problem\+json/);

  const login = await s.request('POST', '/api/v1/auth/login', { body: { username: 'employee', password: DEMO_PASSWORD } });
  const token = login.body.accessToken;
  const [, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.exp - claims.iat, 900, 'access tokens live for 15 minutes');

  const forged = Buffer.from(JSON.stringify({ ...claims, role: 'SUPER_ADMIN' })).toString('base64url');
  const tampered = `${token.split('.')[0]}.${forged}.${signature}`;
  assert.equal((await s.request('GET', '/api/v1/admin/users', { token: tampered })).status, 401, 'tampered payload rejected');

  const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
  assert.equal((await s.request('GET', '/api/v1/auth/me', { token: noneAlg })).status, 401, 'alg=none rejected');

  const expired = signToken({ sub: claims.sub, role: 'EMPLOYEE' }, TEST_CONFIG.jwtSecret, { expiresInSeconds: 900, now: Date.now() - 16 * 60 * 1000 });
  assert.equal((await s.request('GET', '/api/v1/auth/me', { token: expired })).status, 401, 'expired token rejected');

  const wrongKey = signToken({ sub: claims.sub, role: 'SUPER_ADMIN' }, 'another-secret', { expiresInSeconds: 900 });
  assert.equal((await s.request('GET', '/api/v1/auth/me', { token: wrongKey })).status, 401);

  assert.equal((await s.request('GET', '/api/v1/admin/users', { token })).status, 403, 'employee cannot reach admin endpoints');
  assert.equal((await s.request('GET', '/api/v1/assets', { token })).status, 403);
  assert.equal((await s.request('GET', '/api/v1/audit', { token: await s.login('itadmin') })).status, 403);
  assert.equal((await s.as('superadmin', 'GET', '/api/v1/admin/users')).status, 200);

  // Disabling the account invalidates outstanding tokens immediately.
  const user = s.app.store.get('users', claims.sub);
  s.app.store.update('users', { ...user, active: false });
  assert.equal((await s.request('GET', '/api/v1/auth/me', { token })).status, 401);
  s.app.store.update('users', { ...user, active: true });
});

test('TC-SEC-03 masks product keys and reveals them only to super admins', async () => {
  const lic = await s.createLicense({ softwareName: 'Windows Server Datacenter', totalSeats: 1, licenseKey: 'MSFT-PROD-9874-5512-WXYZ' });

  const technician = await s.as('technician', 'GET', `/api/v1/licenses/${lic.id}`);
  assert.equal(technician.body.licenseKeyMasked, 'XXXX-XXXX-XXXX-WXYZ');
  assert.ok(!technician.text.includes('MSFT-PROD'), 'raw key absent from non-admin responses');
  const list = await s.as('auditor', 'GET', '/api/v1/licenses');
  assert.ok(!list.text.includes('MSFT-PROD') && !list.text.includes('licenseKeyEncrypted'));

  assert.equal((await s.as('employee', 'GET', `/api/v1/licenses/${lic.id}`)).status, 403);
  assert.equal((await s.as('itadmin', 'GET', `/api/v1/licenses/${lic.id}/key`)).status, 403);
  const reveal = await s.as('superadmin', 'GET', `/api/v1/licenses/${lic.id}/key`);
  assert.equal(reveal.status, 200);
  assert.equal(reveal.body.licenseKey, 'MSFT-PROD-9874-5512-WXYZ');

  const audit = await s.as('auditor', 'GET', `/api/v1/audit?action=LICENSE_KEY_REVEALED&entityId=${lic.id}`);
  assert.equal(audit.body.length, 1, 'key disclosure is audited');
  assert.ok(!JSON.stringify(s.app.store.toJSON()).includes('MSFT-PROD-9874'), 'not stored in plaintext');

  const vault = createVault('k1');
  const blob = vault.encrypt('secret');
  // Flip one bit of the ciphertext bytes so the change is guaranteed.
  const parts = blob.split(':');
  const bytes = Buffer.from(parts[3], 'base64');
  bytes[0] ^= 0x01;
  const tamperedBlob = [...parts.slice(0, 3), bytes.toString('base64')].join(':');
  assert.notEqual(tamperedBlob, blob);
  assert.throws(() => vault.decrypt(tamperedBlob), 'GCM authentication rejects modified ciphertext');
  assert.throws(() => createVault('k2').decrypt(blob), 'wrong key cannot decrypt');
});

test('TC-SEC-04 validates input strictly and sends hardening headers', async () => {
  const token = await s.login('itadmin');
  const unknown = await s.request('POST', '/api/v1/assets', { token, body: { serialNumber: 'SN-SEC-1', isAdmin: true } });
  assert.equal(unknown.status, 400);
  assert.ok(unknown.body.errors.includes('Unknown field: isAdmin'));

  const proto = await s.request('POST', '/api/v1/assets', { token, body: '{"serialNumber":"SN-SEC-2","__proto__":{"polluted":true}}' });
  assert.equal(proto.status, 400);
  assert.equal({}.polluted, undefined, 'no prototype pollution');

  const scriptTag = await s.request('POST', '/api/v1/assets', { token, body: { assetTag: '<script>x</script>', serialNumber: 'SN-SEC-3' } });
  assert.equal(scriptTag.status, 400);

  const xss = '<img src=x onerror=alert(1)>';
  const stored = await s.request('POST', '/api/v1/assets', { token, body: { serialNumber: 'SN-SEC-4', model: xss } });
  assert.equal(stored.status, 201);
  assert.match(stored.headers.get('content-type'), /^application\/json/);
  assert.equal(stored.headers.get('x-content-type-options'), 'nosniff');
  assert.match(stored.headers.get('content-security-policy'), /default-src 'self'.*script-src 'self'/);
  assert.equal(stored.headers.get('x-frame-options'), 'DENY');

  const sqlish = await s.request('GET', `/api/v1/assets?q=${encodeURIComponent("' OR 1=1 --")}`, { token });
  assert.equal(sqlish.status, 200);
  assert.equal(sqlish.body.total, 0, 'injection strings are matched literally');

  const plain = await s.request('POST', '/api/v1/assets', { token, body: 'serialNumber=SN', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 415);
  const malformed = await s.request('POST', '/api/v1/assets', { token, body: '{"serialNumber":', headers: { 'Content-Type': 'application/json' } });
  assert.equal(malformed.status, 400);
  const huge = await s.request('POST', '/api/v1/assets', { token, body: { serialNumber: 'SN-BIG', model: 'x'.repeat(200 * 1024) } });
  assert.equal(huge.status, 413);

  for (const p of ['/..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/../src/config.js']) {
    assert.equal((await s.request('GET', p)).status, 404, `traversal blocked: ${p}`);
  }

  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(client), 'dashboard never injects HTML');
});

test('TC-SEC-05 locks out brute-force logins with HTTP 429', async () => {
  let offset = 0;
  const clock = await startServer({ now: () => Date.now() + offset });
  try {
    const attempt = (username, password) => clock.request('POST', '/api/v1/auth/login', { body: { username, password } });
    for (let i = 1; i <= 5; i += 1) assert.equal((await attempt('finance', 'wrong-password')).status, 401, `attempt ${i}`);
    const sixth = await attempt('finance', 'wrong-password');
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get('retry-after')) > 800 && Number(sixth.headers.get('retry-after')) <= 900);
    assert.equal((await attempt('finance', DEMO_PASSWORD)).status, 429, 'correct password is refused during lockout');
    assert.equal((await attempt('manager', DEMO_PASSWORD)).status, 200, 'other accounts are unaffected');

    const auditTrail = clock.app.audit.list({ action: 'LOGIN_LOCKOUT' });
    assert.equal(auditTrail.length, 1, 'lockout is recorded for security review');

    offset = 15 * 60 * 1000 + 1000;
    assert.equal((await attempt('finance', DEMO_PASSWORD)).status, 200, 'lockout expires after 15 minutes');
  } finally {
    await clock.stop();
  }

  const limited = await startServer({ rateLimitPerMinute: 5 });
  try {
    const token = await limited.login('itadmin');
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await limited.request('GET', '/api/v1/licenses', { token })).status);
    assert.equal(statuses.at(-1), 429, 'general per-client API rate limit applies');
  } finally {
    await limited.stop();
  }
});
