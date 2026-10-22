'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

test('TC-SAM-03 ingests an endpoint manifest and reconciles it against entitlements', async () => {
  const license = await s.createLicense({ softwareName: 'Slack', totalSeats: 5 });
  const asset = await s.createAsset({ macAddress: 'aa:bb:cc:00:00:01' });
  await s.as('technician', 'POST', `/api/v1/licenses/${license.id}/allocations`, { assetId: asset.id });

  const res = await s.agent({
    macAddress: 'AA:BB:CC:00:00:01',
    hostname: 'eng-laptop-01',
    installedSoftware: [{ name: 'slack', version: '4.41' }, { name: 'Visual Studio Code' }, { name: 'Slack' }]
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.assetId, asset.id, 'endpoint matched by MAC address (case-insensitive)');
  assert.equal(res.body.softwareCount, 2, 'duplicate entries are collapsed');
  assert.ok(res.ms < 60000, 'reconciled well within 60 seconds of ingestion');

  const report = await s.as('itadmin', 'POST', '/api/v1/compliance/reconcile');
  const slack = report.body.results.find((r) => r.softwareName === 'Slack');
  assert.equal(slack.installedCount, 1);
  assert.equal(slack.allocatedSeats, 1);
  assert.equal(slack.unallocatedInstalls, 0);
  assert.equal(slack.status, 'UNDER_UTILIZED');
  assert.ok(report.body.unlicensedSoftware.some((u) => u.normalizedName === 'visual studio code'));

  await s.login('auditor'); // logging in is itself audited, so do it before measuring
  const auditBefore = s.app.store.audit.length;
  const status = await s.as('auditor', 'GET', '/api/v1/compliance/reconciliation');
  assert.equal(status.status, 200);
  assert.equal(status.body.results.find((r) => r.softwareName === 'Slack').installedCount, 1);
  assert.equal(s.app.store.audit.length, auditBefore, 'reading reconciliation status has no side effects');

  const unknown = await s.agent({ serialNumber: 'NOT-REGISTERED', installedSoftware: [] });
  assert.equal(unknown.status, 404, 'unregistered endpoints are rejected');
  const noKey = await s.request('POST', '/api/v1/telemetry/manifest', { body: { serialNumber: asset.serialNumber, installedSoftware: [] } });
  assert.equal(noKey.status, 401, 'agents must present the API key');
  const badKey = await s.request('POST', '/api/v1/telemetry/manifest', {
    body: { serialNumber: asset.serialNumber, installedSoftware: [] },
    headers: { 'X-Agent-Key': 'wrong' }
  });
  assert.equal(badKey.status, 401);
});

test('TC-SAM-04 flags blacklisted software as a high-severity security incident', async () => {
  const asset = await s.createAsset();
  const res = await s.agent({
    serialNumber: asset.serialNumber,
    installedSoftware: [{ name: 'Google Chrome' }, { name: 'BitTorrent.exe' }, { name: 'XMRig' }]
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.newIncidents.map((i) => i.normalizedName).sort(), ['bittorrent', 'xmrig']);
  assert.ok(res.body.newIncidents.every((i) => i.severity === 'HIGH' && i.status === 'OPEN'));

  const repeat = await s.agent({ serialNumber: asset.serialNumber, installedSoftware: [{ name: 'bittorrent' }] });
  assert.equal(repeat.body.newIncidents.length, 0, 'an open incident is not duplicated');

  const alerts = await s.as('auditor', 'GET', '/api/v1/notifications?type=SECURITY_INCIDENT');
  assert.equal(alerts.body.filter((n) => n.entityType === 'SecurityIncident').length, 2);

  const added = await s.as('itadmin', 'POST', '/api/v1/compliance/blacklist', { name: 'TeamViewer.exe' });
  assert.equal(added.status, 201);
  const later = await s.agent({ serialNumber: asset.serialNumber, installedSoftware: [{ name: 'teamviewer' }] });
  assert.equal(later.body.newIncidents.length, 1, 'newly blacklisted software is detected');

  const incidents = await s.as('auditor', 'GET', '/api/v1/compliance/incidents?status=OPEN');
  const resolved = await s.as('itadmin', 'POST', `/api/v1/compliance/incidents/${incidents.body[0].id}/resolve`, { resolution: 'Uninstalled and user briefed' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.status, 'RESOLVED');
});

test('TC-AUD-01 detects under-licensing and raises a breach notification', async () => {
  const license = await s.createLicense({ softwareName: 'Photoshop CC', totalSeats: 2 });
  const assets = [await s.createAsset(), await s.createAsset(), await s.createAsset()];
  let last;
  for (const a of assets) last = await s.agent({ serialNumber: a.serialNumber, installedSoftware: [{ name: 'photoshop cc' }] });

  assert.deepEqual(last.body.breaches, ['Photoshop CC']);
  assert.ok(last.body.complianceRate < 100);

  const breaches = await s.as('itadmin', 'GET', '/api/v1/notifications?type=LICENSE_BREACH');
  const ps = breaches.body.filter((n) => n.data.softwareName === 'Photoshop CC');
  assert.equal(ps.length, 1, 'exactly one alert for the breach');
  assert.equal(ps[0].severity, 'HIGH');
  assert.equal(ps[0].data.deficit, 1);
  assert.equal(ps[0].entityId, license.id);

  const again = await s.as('itadmin', 'POST', '/api/v1/compliance/reconcile');
  assert.equal(again.body.notificationsRaised.length, 0, 'an unchanged breach is not re-alerted');

  const audit = await s.as('auditor', 'GET', '/api/v1/audit?action=LICENSE_BREACH_DETECTED');
  assert.equal(audit.body.length, 1);
});
