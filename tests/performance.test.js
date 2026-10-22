'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, percentile } = require('./helpers');

const CLIENTS = 50;
const REQUESTS_PER_CLIENT = 20;
const P95_BUDGET_MS = 300;

test('TC-PERF-01 keeps p95 API latency within budget under 50 concurrent clients', async (t) => {
  const s = await startServer();
  try {
    const token = await s.login('itadmin');
    const ids = [];
    for (let i = 0; i < 500; i += 1) {
      ids.push(s.app.services.hardware.insertAsset({ serialNumber: `PERF-SEED-${i}`, model: `Model ${i % 20}`, category: 'LAPTOP' }, { username: 'seed' }).id);
    }

    let writes = 0;
    const latencies = [];
    const failures = [];
    const client = async (c) => {
      for (let i = 0; i < REQUESTS_PER_CLIENT; i += 1) {
        const kind = i % 10;
        let res;
        if (kind < 5) res = await s.request('GET', `/api/v1/assets/${ids[(c * 31 + i) % ids.length]}`, { token });
        else if (kind < 7) res = await s.request('GET', '/api/v1/assets?category=LAPTOP&q=model%201&pageSize=25', { token });
        else {
          writes += 1;
          res = await s.request('POST', '/api/v1/assets', { token, body: { serialNumber: `PERF-${c}-${i}`, category: 'DESKTOP' } });
        }
        latencies.push(res.ms);
        if (res.status >= 400) failures.push(res.status);
      }
    };
    const started = Date.now();
    await Promise.all(Array.from({ length: CLIENTS }, (_, c) => client(c)));
    const elapsed = (Date.now() - started) / 1000;

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    t.diagnostic(`requests=${latencies.length} writes=${writes} throughput=${Math.round(latencies.length / elapsed)} req/s`);
    t.diagnostic(`latency p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms budget p95<=${P95_BUDGET_MS}ms`);

    assert.equal(latencies.length, CLIENTS * REQUESTS_PER_CLIENT);
    assert.deepEqual(failures, [], 'no request failed under load');
    assert.ok(p95 <= P95_BUDGET_MS, `p95 ${p95.toFixed(1)}ms exceeds ${P95_BUDGET_MS}ms`);
  } finally {
    await s.stop();
  }
});
