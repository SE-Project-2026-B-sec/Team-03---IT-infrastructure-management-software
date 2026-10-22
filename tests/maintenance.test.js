'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

test('TC-MAINT-01 logs maintenance with costs and tracks out-of-service repairs', async () => {
  const asset = await s.createAsset();
  const url = `/api/v1/assets/${asset.id}/maintenance`;

  const upgrade = await s.as('technician', 'POST', url, {
    type: 'UPGRADE',
    description: 'RAM upgrade from 16 GB to 32 GB',
    technician: 'Tara Technician',
    vendor: 'Crucial',
    cost: 85.5,
    partsReplaced: ['16GB DDR5 SODIMM']
  });
  assert.equal(upgrade.status, 201);
  assert.equal(upgrade.body.status, 'COMPLETED', 'in-place work is completed immediately');

  await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0101' });
  const blocked = await s.as('technician', 'POST', url, { type: 'REPAIR', description: 'Screen flicker', technician: 'Tara', outOfService: true });
  assert.equal(blocked.status, 409, 'must be checked in before going out of service');
  await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkin`);

  const repair = await s.as('technician', 'POST', url, { type: 'REPAIR', description: 'Replace failing SSD', technician: 'Tara', cost: 120, outOfService: true });
  assert.equal(repair.body.status, 'OPEN');
  assert.equal((await s.as('technician', 'GET', `/api/v1/assets/${asset.id}`)).body.status, 'UNDER_REPAIR');
  const checkoutDuringRepair = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0101' });
  assert.equal(checkoutDuringRepair.status, 409);

  const done = await s.as('technician', 'POST', `${url}/${repair.body.id}/complete`, { resolutionNotes: 'SSD replaced, image restored', additionalCost: 30 });
  assert.equal(done.status, 200);
  assert.equal(done.body.cost, 150);
  const after = (await s.as('technician', 'GET', `/api/v1/assets/${asset.id}`)).body;
  assert.equal(after.status, 'AVAILABLE');
  assert.equal(after.totalMaintenanceCost, 235.5);

  const history = await s.as('auditor', 'GET', url);
  assert.equal(history.body.length, 2);
  const invalid = await s.as('technician', 'POST', url, { type: 'PAINTING', description: 'x', technician: 'T', cost: -1 });
  assert.equal(invalid.status, 400);
});

test('TC-MAINT-02 decommissions with a NIST 800-88 certificate and reclaims license seats', async () => {
  const asset = await s.createAsset();
  const office = await s.createLicense({ softwareName: 'Office', totalSeats: 1 });
  const vpn = await s.createLicense({ softwareName: 'GlobalProtect VPN', totalSeats: 1 });
  await s.as('technician', 'POST', `/api/v1/licenses/${office.id}/allocations`, { assetId: asset.id });
  await s.as('technician', 'POST', `/api/v1/licenses/${vpn.id}/allocations`, { assetId: asset.id });

  const certificate = { sanitizationMethod: 'PURGE', certificateId: 'WIPE-2026-0042', performedBy: 'SecureShred Ltd', disposalVendor: 'E-Waste Recyclers' };
  await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0102' });
  const inUse = await s.as('itadmin', 'POST', `/api/v1/assets/${asset.id}/decommission`, certificate);
  assert.equal(inUse.status, 409, 'in-use assets must be checked in first');
  await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkin`);

  const noCert = await s.as('itadmin', 'POST', `/api/v1/assets/${asset.id}/decommission`, { sanitizationMethod: 'WIPE' });
  assert.equal(noCert.status, 400);
  const tech = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/decommission`, certificate);
  assert.equal(tech.status, 403);

  const res = await s.as('itadmin', 'POST', `/api/v1/assets/${asset.id}/decommission`, certificate);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'DECOMMISSIONED');
  assert.equal(res.body.decommission.certificateId, 'WIPE-2026-0042');
  assert.equal(res.body.decommission.sanitizationStandard, 'NIST SP 800-88 Rev. 1');
  assert.equal(res.body.decommission.reclaimedLicenseIds.length, 2);

  for (const l of [office, vpn]) {
    const lic = await s.as('itadmin', 'GET', `/api/v1/licenses/${l.id}`);
    assert.equal(lic.body.availableSeats, 1, `${l.softwareName} seat reclaimed`);
  }
  // Terminal state: no further lifecycle actions.
  assert.equal((await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0101' })).status, 409);
  assert.equal((await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkin`)).status, 409);
  assert.equal((await s.as('itadmin', 'POST', `/api/v1/assets/${asset.id}/decommission`, certificate)).status, 409);
  assert.equal((await s.as('technician', 'POST', `/api/v1/licenses/${office.id}/allocations`, { assetId: asset.id })).status, 409);
  assert.equal((await s.agent({ serialNumber: asset.serialNumber, installedSoftware: [] })).status, 409);
});
