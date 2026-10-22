'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const ASSETS = 50000;
const SEATS = 100000;

test('TC-SCALE-01 handles 50,000 assets and 100,000 license seats within query budgets', async (t) => {
  const s = await startServer();
  try {
    const { hardware, licenses } = s.app.services;
    const actor = { id: null, username: 'seed', role: 'SYSTEM' };
    const categories = ['LAPTOP', 'DESKTOP', 'SERVER', 'NETWORK', 'PERIPHERAL'];
    const seedStart = Date.now();
    const ids = [];
    for (let i = 0; i < ASSETS; i += 1) {
      ids.push(hardware.insertAsset({ serialNumber: `SCALE-${i}`, model: `Model ${i % 500}`, category: categories[i % 5] }, actor).id);
    }
    const pools = [];
    for (let p = 0; p < 10; p += 1) pools.push(licenses.createLicense({ softwareName: `Suite ${p}`, totalSeats: SEATS / 10 }, actor));
    // Fill every seat: each pool gets 10,000 allocations spread over the asset base.
    for (let p = 0; p < pools.length; p += 1) {
      for (let i = 0; i < SEATS / 10; i += 1) licenses.allocate(pools[p].id, { assetId: ids[(p * 5000 + i) % ASSETS] }, actor);
    }
    t.diagnostic(`seeded ${ASSETS} assets and ${SEATS} allocated seats in ${Date.now() - seedStart} ms`);

    const token = await s.login('itadmin');
    const lookup = await s.request('GET', `/api/v1/assets/by-tag/HW-${new Date().getUTCFullYear()}-049999`, { token });
    assert.equal(lookup.status, 200);
    const byId = await s.request('GET', `/api/v1/assets/${ids[42424]}`, { token });
    assert.equal(byId.status, 200);

    const search = await s.request('GET', '/api/v1/assets?category=SERVER&q=model%2042&page=3&pageSize=50', { token });
    assert.equal(search.status, 200);
    assert.ok(search.body.total > 0);

    const full = await s.request('GET', '/api/v1/licenses', { token });
    assert.equal(full.body.reduce((n, l) => n + l.usedSeats, 0), SEATS);

    const report = await s.as('auditor', 'GET', '/api/v1/compliance/report');
    assert.equal(report.status, 200);
    assert.equal(report.body.summary.totalAssets, ASSETS);

    t.diagnostic(`tag lookup ${lookup.ms.toFixed(1)} ms, id lookup ${byId.ms.toFixed(1)} ms, filtered search ${search.ms.toFixed(1)} ms, compliance report ${report.ms.toFixed(1)} ms`);
    assert.ok(lookup.ms < 100, `indexed tag lookup took ${lookup.ms} ms (budget 100 ms)`);
    assert.ok(byId.ms < 100, `id lookup took ${byId.ms} ms (budget 100 ms)`);
    assert.ok(search.ms < 1000, `filtered search took ${search.ms} ms (budget 1 s)`);
    assert.ok(report.ms < 5000, `compliance report took ${report.ms} ms (budget 5 s)`);
  } finally {
    await s.stop();
  }
});
