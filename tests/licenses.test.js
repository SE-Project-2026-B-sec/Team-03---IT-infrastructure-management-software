'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

test('TC-SAM-01 stores a license pool with seat counts and an encrypted product key', async () => {
  const res = await s.as('itadmin', 'POST', '/api/v1/licenses', {
    softwareName: 'IntelliJ IDEA Ultimate',
    publisher: 'JetBrains',
    licenseType: 'SUBSCRIPTION',
    totalSeats: 10,
    licenseKey: 'IJ-PRO-2026-KEY-9876',
    validFrom: '2026-01-01',
    validUntil: '2027-01-01',
    costPerSeat: 499
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.totalSeats, 10);
  assert.equal(res.body.usedSeats, 0);
  assert.equal(res.body.availableSeats, 10);
  assert.equal(res.body.licenseKeyMasked, 'XXXX-XXXX-XXXX-9876');
  assert.equal(res.body.licenseKey, undefined);
  assert.equal(res.body.licenseKeyEncrypted, undefined, 'ciphertext is never returned');

  const stored = s.app.store.get('licenses', res.body.id);
  assert.match(stored.licenseKeyEncrypted, /^v1:/);
  assert.ok(!JSON.stringify(stored).includes('IJ-PRO-2026-KEY-9876'), 'no plaintext key at rest');

  const historical = await s.as('itadmin', 'POST', '/api/v1/licenses', { softwareName: 'Legacy Suite', totalSeats: 2, validUntil: '2021-01-01' });
  assert.equal(historical.status, 201);
  assert.equal(historical.body.validFrom, null, 'no start date is invented after the expiry date');

  for (const bad of [{ totalSeats: 0 }, { totalSeats: 2.5 }, { totalSeats: 'abc' }, { totalSeats: 5, validFrom: '2027-01-01', validUntil: '2026-01-01' }]) {
    const r = await s.as('itadmin', 'POST', '/api/v1/licenses', { softwareName: 'Bad', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
});

test('TC-SAM-02 allocates seats, blocks over-allocation and reclaims seats', async () => {
  const license = await s.createLicense({ softwareName: 'Microsoft Office 365', totalSeats: 2 });
  const [a1, a2, a3] = [await s.createAsset(), await s.createAsset(), await s.createAsset()];

  const r1 = await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a1.id });
  assert.equal(r1.status, 201);
  assert.equal(r1.body.license.availableSeats, 1);
  const dup = await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a1.id });
  assert.equal(dup.status, 409, 'an asset holds at most one seat per license');
  const r2 = await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a2.id });
  assert.equal(r2.body.license.availableSeats, 0);

  const r3 = await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a3.id });
  assert.equal(r3.status, 409);
  assert.match(r3.body.detail, /No available seats/);

  const reclaimed = await s.as('technician', 'DELETE', `/api/v1/licenses/${license.id}/allocations/${a1.id}`);
  assert.equal(reclaimed.status, 200);
  assert.equal(reclaimed.body.license.availableSeats, 1);
  const r4 = await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a3.id });
  assert.equal(r4.status, 201, 'a reclaimed seat can be reused');
});

test('TC-SAM-02 never over-allocates under concurrent requests', async () => {
  const license = await s.createLicense({ softwareName: 'AutoCAD', totalSeats: 3 });
  const assets = [];
  for (let i = 0; i < 10; i += 1) assets.push(await s.createAsset());
  const token = await s.login('technician');
  const results = await Promise.all(
    assets.map((a) => s.request('POST', `/api/v1/licenses/${license.id}/allocations`, { token, body: { assetId: a.id } }))
  );
  assert.equal(results.filter((r) => r.status === 201).length, 3);
  assert.equal(results.filter((r) => r.status === 409).length, 7);
  const after = await s.as('itadmin', 'GET', `/api/v1/licenses/${license.id}`);
  assert.equal(after.body.usedSeats, 3);
});

test('TC-SAM-02 refuses seats on expired licenses', async () => {
  const expired = await s.createLicense({ softwareName: 'Old Tool', totalSeats: 5, validFrom: '2020-01-01', validUntil: '2021-01-01' });
  const asset = await s.createAsset();
  const res = await s.as('technician', 'POST', `/api/v1/licenses/${expired.id}/allocations`, { assetId: asset.id });
  assert.equal(res.status, 409);
  assert.match(res.body.detail, /expired/);
});
