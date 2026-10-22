'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');
const { sha256, canonicalJson } = require('../src/lib/util');

test('TC-AUDIT-01 keeps an append-only, hash-chained audit trail that detects tampering', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itim-audit-'));
  const dataFile = path.join(dir, 'data.json');
  const servers = [];
  const start = async (overrides) => {
    const server = await startServer(overrides);
    servers.push(server);
    return server;
  };
  try {
    const s = await start({ dataFile });
    const asset = await s.createAsset();
    await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0101' });
    const pr = await s.as('employee', 'POST', '/api/v1/procurement/requisitions', {
      itemType: 'HARDWARE',
      itemDescription: 'Docking station',
      quantity: 1,
      estimatedUnitCost: 250,
      businessJustification: 'Hot-desking setup for the new office'
    });
    await s.as('manager', 'POST', `/api/v1/procurement/requisitions/${pr.body.id}/approve`);

    const trail = await s.as('auditor', 'GET', `/api/v1/audit?entityId=${asset.id}`);
    assert.deepEqual(trail.body.map((e) => e.action), ['ASSET_CHECKED_OUT', 'ASSET_CREATED']);
    const checkout = trail.body[0];
    assert.equal(checkout.actorName, 'technician');
    assert.equal(checkout.actorRole, 'IT_TECHNICIAN');
    assert.ok(checkout.ip && checkout.timestamp && /^[0-9a-f]{64}$/.test(checkout.hash));

    const verify = await s.as('auditor', 'GET', '/api/v1/audit/verify');
    assert.equal(verify.body.valid, true);
    assert.ok(verify.body.entries >= 6);

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const res = await s.as('superadmin', method, '/api/v1/audit');
      assert.equal(res.status, 405, `${method} on the audit log is not supported`);
    }
    assert.equal((await s.as('itadmin', 'GET', '/api/v1/audit')).status, 403, 'only auditors and super admins read the trail');
    assert.throws(() => {
      s.app.store.audit[0].action = 'EDITED';
    }, TypeError, 'in-memory entries are frozen');
    await s.stop();

    // Tamper with the persisted file: first edit one entry, then delete one.
    const original = fs.readFileSync(dataFile, 'utf8');
    const edited = JSON.parse(original);
    edited.audit[2].details = { employeeId: 'EMP-9999' };
    fs.writeFileSync(dataFile, JSON.stringify(edited));
    const afterEdit = await start({ dataFile });
    const editedResult = await afterEdit.as('auditor', 'GET', '/api/v1/audit/verify');
    assert.equal(editedResult.body.valid, false);
    assert.equal(editedResult.body.brokenAtSeq, 3, 'verification pinpoints the altered entry');
    await afterEdit.stop();

    // A smarter attacker also recomputes the edited entry's own hash; the
    // next entry's prevHash link still exposes the change.
    const rehashed = JSON.parse(original);
    rehashed.audit[2].details = { employeeId: 'EMP-9999' };
    const { hash, ...rest } = rehashed.audit[2];
    rehashed.audit[2].hash = sha256(canonicalJson(rest));
    assert.notEqual(rehashed.audit[2].hash, hash);
    fs.writeFileSync(dataFile, JSON.stringify(rehashed));
    const afterRehash = await start({ dataFile });
    const rehashResult = await afterRehash.as('auditor', 'GET', '/api/v1/audit/verify');
    assert.equal(rehashResult.body.valid, false);
    assert.equal(rehashResult.body.brokenAtSeq, 4, 'the following entry no longer links to it');
    await afterRehash.stop();

    const removed = JSON.parse(original);
    removed.audit.splice(1, 1);
    fs.writeFileSync(dataFile, JSON.stringify(removed));
    const deleted = await start({ dataFile });
    assert.equal((await deleted.as('auditor', 'GET', '/api/v1/audit/verify')).body.valid, false, 'deleting an entry is detected');
    await deleted.stop();
  } finally {
    await Promise.all(servers.map((server) => server.stop()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
