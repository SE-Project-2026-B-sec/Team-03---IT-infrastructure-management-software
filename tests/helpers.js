'use strict';

const { createApp } = require('../src/app');

const DEMO_PASSWORD = 'Test-Password-2026';
const AGENT_KEY = 'test-agent-key-0123456789';

const TEST_CONFIG = {
  port: 0,
  host: '127.0.0.1',
  logLevel: 'silent',
  jwtSecret: 'test-jwt-secret-0123456789abcdef0123456789abcdef',
  licenseKeySecret: 'test-license-secret-0123456789abcdef0123456789',
  agentApiKey: AGENT_KEY,
  demoPassword: DEMO_PASSWORD,
  dataFile: null,
  scheduleJobs: false,
  seedDemoUsers: true,
  rateLimitPerMinute: 1000000
};

/** Starts a real HTTP server on a random port and returns a small client. */
async function startServer(overrides = {}) {
  const app = createApp({ ...TEST_CONFIG, ...overrides });
  const { port, redirectPort } = await app.start();
  const base = `http://127.0.0.1:${port}`;
  const tokens = new Map();

  async function request(method, path, { token, body, headers = {} } = {}) {
    const started = process.hrtime.bigint();
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    const text = await res.text();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, body: json, text, ms };
  }

  async function login(username) {
    if (tokens.has(username)) return tokens.get(username);
    const res = await request('POST', '/api/v1/auth/login', { body: { username, password: DEMO_PASSWORD } });
    if (res.status !== 200) throw new Error(`Login failed for ${username}: ${res.status} ${res.text}`);
    tokens.set(username, res.body.accessToken);
    return res.body.accessToken;
  }

  /** Convenience wrapper: request as a named demo user. */
  async function as(username, method, path, body) {
    return request(method, path, { token: await login(username), body });
  }

  const agent = (body) => request('POST', '/api/v1/telemetry/manifest', { body, headers: { 'X-Agent-Key': AGENT_KEY } });

  let serialCounter = 0;
  async function createAsset(fields = {}) {
    serialCounter += 1;
    const res = await as('itadmin', 'POST', '/api/v1/assets', {
      serialNumber: `SN-${Date.now()}-${serialCounter}`,
      model: 'Latitude 5430',
      manufacturer: 'Dell',
      category: 'LAPTOP',
      purchaseCost: 1200,
      ...fields
    });
    if (res.status !== 201) throw new Error(`createAsset failed: ${res.status} ${res.text}`);
    return res.body;
  }

  async function createLicense(fields = {}) {
    const res = await as('itadmin', 'POST', '/api/v1/licenses', { softwareName: 'Microsoft Office 365', totalSeats: 5, ...fields });
    if (res.status !== 201) throw new Error(`createLicense failed: ${res.status} ${res.text}`);
    return res.body;
  }

  return { app, base, port, redirectPort, request, login, as, agent, createAsset, createLicense, stop: () => app.stop() };
}

/** p-th percentile of a list of numbers. */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

module.exports = { startServer, percentile, TEST_CONFIG, DEMO_PASSWORD, AGENT_KEY };
