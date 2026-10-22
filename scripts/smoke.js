'use strict';

// Post-deployment smoke test used by the CI staging stage.
// Usage: BASE_URL=http://127.0.0.1:8080 DEMO_PASSWORD=... node scripts/smoke.js
// Waits for readiness, then exercises login, asset creation and read-back.
// Exits non-zero on the first failed check.

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const PASSWORD = process.env.DEMO_PASSWORD || 'ChangeMe!2026';
const WAIT_SECONDS = Number(process.env.SMOKE_WAIT_SECONDS || 30);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(condition, message) {
  if (!condition) throw new Error(`Smoke check failed: ${message}`);
  process.stdout.write(`  ok - ${message}\n`);
}

async function call(method, path, { token, body } = {}) {
  const started = Date.now();
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, body: json, ms: Date.now() - started };
}

async function waitForReady() {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await call('GET', '/health/ready');
      if (res.status === 200) return res;
    } catch {
      // server not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Service did not become ready within ${WAIT_SECONDS}s`);
}

async function main() {
  process.stdout.write(`Smoke testing ${BASE_URL}\n`);
  const ready = await waitForReady();
  check(ready.body.status === 'READY', '/health/ready reports READY');

  const live = await call('GET', '/health/live');
  check(live.status === 200 && live.body.status === 'UP', '/health/live reports UP');
  check(live.headers.get('content-security-policy') !== null, 'security headers are present');

  const anon = await call('GET', '/api/v1/assets');
  check(anon.status === 401, 'unauthenticated API access is rejected with 401');

  const login = await call('POST', '/api/v1/auth/login', { body: { username: 'itadmin', password: PASSWORD } });
  check(login.status === 200 && typeof login.body.accessToken === 'string', 'IT admin can log in');
  const token = login.body.accessToken;

  const serial = `SMOKE-${Date.now()}`;
  const created = await call('POST', '/api/v1/assets', { token, body: { serialNumber: serial, model: 'Smoke Test Unit', category: 'OTHER' } });
  check(created.status === 201 && created.body.status === 'AVAILABLE', 'asset can be registered');

  const fetched = await call('GET', `/api/v1/assets/by-tag/${created.body.assetTag}`, { token });
  check(fetched.status === 200 && fetched.body.serialNumber === serial, 'asset can be read back by tag');
  check(fetched.ms < 500, `asset lookup answered in ${fetched.ms} ms (< 500 ms)`);

  const page = await call('GET', '/');
  check(page.status === 200, 'dashboard page is served');

  process.stdout.write('Smoke test passed.\n');
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
