'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer } = require('./helpers');
const { canonicalJson } = require('../src/lib/util');
const { bucketFor } = require('../src/services/alerts');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

const runCheck = (asOf) => s.as('itadmin', 'POST', '/api/v1/alerts/expiry/run', { asOf });

test('TC-AUD-02 raises expiry alerts at 60, 30 and 7 days, once each', async () => {
  const license = await s.createLicense({ softwareName: 'Adobe Acrobat Pro', totalSeats: 3, validFrom: '2026-01-01', validUntil: '2026-12-31' });
  const asset = await s.createAsset({ purchaseDate: '2024-01-01', warrantyExpiry: '2026-12-31' });

  const far = await runCheck('2026-09-01');
  assert.equal(far.status, 200);
  assert.equal(far.body.created.length, 0, '121 days out: nothing yet');

  const at60 = await runCheck('2026-11-01');
  assert.deepEqual(at60.body.created.map((n) => [n.type, n.data.threshold]).sort(), [['LICENSE_EXPIRING', 60], ['WARRANTY_EXPIRING', 60]]);
  assert.equal(at60.body.created.find((n) => n.entityId === license.id).severity, 'LOW');

  const repeat = await runCheck('2026-11-05');
  assert.equal(repeat.body.created.length, 0, 'same threshold is not repeated');

  const at30 = await runCheck('2026-12-05');
  assert.ok(at30.body.created.every((n) => n.data.threshold === 30 && n.severity === 'MEDIUM'));
  assert.equal(at30.body.created.length, 2);

  const at7 = await runCheck('2026-12-26');
  assert.ok(at7.body.created.every((n) => n.data.threshold === 7 && n.severity === 'HIGH'));

  const expired = await runCheck('2027-01-02');
  assert.deepEqual(expired.body.created.map((n) => n.type).sort(), ['LICENSE_EXPIRED', 'WARRANTY_EXPIRED']);
  assert.ok(expired.body.created.some((n) => n.entityId === asset.id));

  const forbidden = await s.as('employee', 'POST', '/api/v1/alerts/expiry/run', {});
  assert.equal(forbidden.status, 403);
  assert.equal(bucketFor(61), null);
  assert.equal(bucketFor(0), 7);
});

test('TC-AUD-03 generates a one-click compliance report in JSON and CSV with an integrity hash', async () => {
  const license = await s.createLicense({ softwareName: 'Tableau Creator', totalSeats: 1 });
  const a1 = await s.createAsset();
  const a2 = await s.createAsset();
  await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: a1.id });
  await s.agent({ serialNumber: a1.serialNumber, installedSoftware: [{ name: 'Tableau Creator' }] });
  await s.agent({ serialNumber: a2.serialNumber, installedSoftware: [{ name: 'Tableau Creator' }, { name: 'uTorrent' }] });

  const res = await s.as('auditor', 'GET', '/api/v1/compliance/report?format=json');
  assert.equal(res.status, 200);
  const report = res.body;
  const tableau = report.licenses.find((l) => l.softwareName === 'Tableau Creator');
  assert.equal(tableau.deficit, 1);
  assert.equal(tableau.unallocatedInstalls, 1);
  assert.equal(report.summary.openSecurityIncidents, 1);
  assert.equal(report.summary.unallocatedSeats, report.summary.totalSeats - report.summary.allocatedSeats);
  assert.equal(report.auditTrail.valid, true);

  const { contentSha256, ...content } = report;
  assert.equal(contentSha256, crypto.createHash('sha256').update(canonicalJson(content)).digest('hex'), 'hash covers the report content');

  const csv = await s.as('auditor', 'GET', '/api/v1/compliance/report?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /^text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="compliance-report-/);
  assert.match(csv.headers.get('x-report-sha256'), /^[0-9a-f]{64}$/);
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines[0], 'softwareName,purchasedSeats,allocatedSeats,installedCount,unallocatedInstalls,deficit,status');
  assert.ok(lines.some((l) => l.startsWith('Tableau Creator,1,1,2,1,1,NON_COMPLIANT')));

  // CSV formula injection is neutralised.
  await s.createLicense({ softwareName: '=HYPERLINK("http://evil")', totalSeats: 1 });
  const csv2 = await s.as('auditor', 'GET', '/api/v1/compliance/report?format=csv');
  assert.ok(csv2.text.includes('"\'=HYPERLINK(""http://evil"")"'));

  const employee = await s.as('employee', 'GET', '/api/v1/compliance/report');
  assert.equal(employee.status, 403);
});
