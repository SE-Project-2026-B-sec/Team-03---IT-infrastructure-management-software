'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { seedDemo } = require('../scripts/demo');

test('demo dataset (npm run demo) seeds every workflow state through the real services', async () => {
  const clock = { now: null };
  const s = await startServer({ now: () => clock.now ?? Date.now() });
  try {
    const counts = seedDemo(s.app, clock);
    assert.equal(clock.now, null, 'virtual clock is released after seeding');
    assert.ok(counts.assets >= 40);
    assert.equal(counts.licenses, 9);

    const summary = await s.as('itadmin', 'GET', '/api/v1/dashboard/summary');
    for (const status of ['AVAILABLE', 'IN_USE', 'UNDER_REPAIR', 'DECOMMISSIONED']) {
      assert.ok(summary.body.assets.byStatus[status] > 0, `has ${status} assets`);
    }
    const reqs = await s.as('auditor', 'GET', '/api/v1/procurement/requisitions');
    const states = new Set(reqs.body.map((r) => r.state));
    for (const st of ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL', 'PENDING_FINANCE_APPROVAL', 'APPROVED', 'PO_ISSUED', 'DELIVERED', 'REJECTED']) {
      assert.ok(states.has(st), `has a ${st} requisition`);
    }
    const recon = await s.as('auditor', 'GET', '/api/v1/compliance/reconciliation');
    assert.ok(recon.body.hasBreaches, 'includes a license breach to investigate');
    const incidents = await s.as('auditor', 'GET', '/api/v1/compliance/incidents?status=OPEN');
    assert.ok(incidents.body.length >= 1, 'includes a prohibited-software incident');
    const notes = await s.as('itadmin', 'GET', '/api/v1/notifications');
    assert.ok(notes.body.some((n) => /_EXPIR(ING|ED)$/.test(n.type)), 'includes expiry alerts');
    assert.equal((await s.as('auditor', 'GET', '/api/v1/audit/verify')).body.valid, true, 'audit chain stays valid');
  } finally {
    await s.stop();
  }
});
