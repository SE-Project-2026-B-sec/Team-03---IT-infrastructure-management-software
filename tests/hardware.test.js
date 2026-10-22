'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { computeDepreciation } = require('../src/services/hardware');
const { decodeModules } = require('../src/services/barcode');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

/** Reads bar/space widths back out of a rendered SVG label. */
function modulesFromSvg(svg, moduleWidth = 2) {
  const rects = [...svg.matchAll(/<rect x="(\d+(?:\.\d+)?)" y="8" width="(\d+(?:\.\d+)?)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const modules = [];
  for (let i = 0; i < rects.length; i += 1) {
    const [x, w] = rects[i];
    modules.push(w / moduleWidth);
    if (i < rects.length - 1) modules.push((rects[i + 1][0] - (x + w)) / moduleWidth);
  }
  return modules;
}

test('TC-HAM-01 registers a hardware asset with an auto-generated unique tag', async () => {
  const res = await s.as('itadmin', 'POST', '/api/v1/assets', {
    serialNumber: '5CD1234XYZ',
    manufacturer: 'Dell',
    model: 'Latitude 5430',
    category: 'LAPTOP',
    purchaseDate: '2026-03-15',
    purchaseCost: 1250,
    warrantyExpiry: '2029-03-15',
    macAddress: '00:1a:2b:3c:4d:5e',
    specifications: { cpu: 'Intel Core i7-1265U', ramGb: 16 }
  });
  assert.equal(res.status, 201);
  assert.match(res.body.assetTag, /^HW-\d{4}-\d{6}$/);
  assert.equal(res.body.status, 'AVAILABLE');
  assert.equal(res.body.macAddress, '00:1A:2B:3C:4D:5E');
  assert.equal(res.body.specifications.ramGb, 16);

  const second = await s.createAsset();
  assert.notEqual(second.assetTag, res.body.assetTag, 'generated tags are unique');

  const stored = await s.as('auditor', 'GET', `/api/v1/assets/${res.body.id}`);
  assert.equal(stored.status, 200);
  assert.equal(stored.body.serialNumber, '5CD1234XYZ');
});

test('TC-HAM-01 accepts an explicit tag and rejects duplicates and invalid input', async () => {
  const ok = await s.as('itadmin', 'POST', '/api/v1/assets', { assetTag: 'hw-lt-0042', serialNumber: 'SN-EXPLICIT-1' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.assetTag, 'HW-LT-0042', 'tags are normalised to upper case');

  const dupTag = await s.as('itadmin', 'POST', '/api/v1/assets', { assetTag: 'HW-LT-0042', serialNumber: 'SN-EXPLICIT-2' });
  assert.equal(dupTag.status, 409);
  const dupSerial = await s.as('itadmin', 'POST', '/api/v1/assets', { serialNumber: 'sn-explicit-1' });
  assert.equal(dupSerial.status, 409, 'serial numbers are unique case-insensitively');

  const invalid = await s.as('itadmin', 'POST', '/api/v1/assets', { serialNumber: 'SN-BAD', purchaseCost: -5, category: 'TOASTER' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.errors.length, 2);
  const missing = await s.as('itadmin', 'POST', '/api/v1/assets', { model: 'No serial' });
  assert.equal(missing.status, 400);

  const asTechnician = await s.as('technician', 'POST', '/api/v1/assets', { serialNumber: 'SN-TECH-1' });
  assert.equal(asTechnician.status, 403, 'only administrators may register assets');
});

test('TC-HAM-02 checks an asset out to an employee and back in', async () => {
  const asset = await s.createAsset();
  const out = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0101', notes: 'New starter' });
  assert.equal(out.status, 200);
  assert.equal(out.body.status, 'IN_USE');
  assert.equal(out.body.assignedTo, 'EMP-0101');
  assert.ok(out.body.checkedOutAt);

  const again = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-0102' });
  assert.equal(again.status, 409, 'an in-use asset cannot be checked out twice');

  const mine = await s.as('employee', 'GET', '/api/v1/me/assets');
  assert.ok(mine.body.some((a) => a.id === asset.id), 'employee sees the device assigned to them');

  const back = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkin`);
  assert.equal(back.status, 200);
  assert.equal(back.body.status, 'AVAILABLE');
  assert.equal(back.body.assignedTo, null);
  assert.ok(back.body.assignmentHistory[0].checkedInAt);

  const twice = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkin`);
  assert.equal(twice.status, 409);
  const unknown = await s.as('technician', 'POST', `/api/v1/assets/${asset.id}/checkout`, { employeeId: 'EMP-9999' });
  assert.equal(unknown.status, 404, 'cannot assign to a non-existent employee');

  const directory = await s.as('technician', 'GET', '/api/v1/directory/employees');
  assert.equal(directory.status, 200);
  assert.ok(directory.body.some((p) => p.employeeId === 'EMP-0101' && p.fullName));
  assert.ok(directory.body.every((p) => Object.keys(p).sort().join() === 'department,employeeId,fullName'), 'directory exposes no sensitive fields');
  assert.equal((await s.as('employee', 'GET', '/api/v1/directory/employees')).status, 403);
});

test('TC-HAM-03 renders a Code 128 barcode label and resolves a scanned tag', async () => {
  const asset = await s.createAsset({ assetTag: 'HW-QR-001' });
  const label = await s.as('technician', 'GET', `/api/v1/assets/${asset.id}/label.svg`);
  assert.equal(label.status, 200);
  assert.match(label.headers.get('content-type'), /^image\/svg\+xml/);
  assert.equal(decodeModules(modulesFromSvg(label.text)), 'HW-QR-001', 'barcode bars decode to the asset tag');

  const scan = await s.as('technician', 'GET', '/api/v1/assets/by-tag/hw-qr-001');
  assert.equal(scan.status, 200);
  assert.equal(scan.body.id, asset.id);
  const missing = await s.as('technician', 'GET', '/api/v1/assets/by-tag/HW-NOPE-999');
  assert.equal(missing.status, 404);
});

test('TC-HAM-04 computes straight-line and written-down-value depreciation', async () => {
  const asset = await s.createAsset({ purchaseCost: 1200, purchaseDate: '2024-10-22' });
  const sl = await s.as('auditor', 'GET', `/api/v1/assets/${asset.id}/depreciation?method=SL&salvageValue=200&lifespanYears=5&asOf=2026-10-22`);
  assert.equal(sl.status, 200);
  assert.equal(sl.body.ageYears, 2);
  assert.equal(sl.body.annualDepreciation, 200);
  assert.equal(sl.body.accumulatedDepreciation, 400);
  assert.equal(sl.body.bookValue, 800);

  const wdv = await s.as('auditor', 'GET', `/api/v1/assets/${asset.id}/depreciation?method=WDV&rate=0.25&asOf=2026-10-22`);
  assert.equal(wdv.body.bookValue, 675, '1200 x 0.75^2');

  const beforePurchase = await s.as('auditor', 'GET', `/api/v1/assets/${asset.id}/depreciation?asOf=2020-01-01`);
  assert.equal(beforePurchase.status, 400);

  // Never depreciates below salvage, and rejects nonsensical inputs.
  assert.equal(computeDepreciation({ cost: 1000, salvageValue: 100, lifespanYears: 3, ageYears: 10 }).bookValue, 100);
  assert.throws(() => computeDepreciation({ cost: 100, salvageValue: 500, lifespanYears: 5, ageYears: 1 }), /salvageValue/);
  assert.throws(() => computeDepreciation({ cost: 100, salvageValue: 0, lifespanYears: 0, ageYears: 1 }), /lifespanYears/);
  assert.throws(() => computeDepreciation({ cost: 100, salvageValue: 0, lifespanYears: 5, ageYears: -1 }), /ageYears/);
});
