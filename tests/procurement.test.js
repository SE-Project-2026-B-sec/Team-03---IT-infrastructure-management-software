'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let s;
test.before(async () => {
  s = await startServer();
});
test.after(() => s.stop());

const hardwareRequest = {
  itemType: 'HARDWARE',
  itemDescription: 'Dell UltraSharp 27 Monitor',
  category: 'PERIPHERAL',
  quantity: 2,
  estimatedUnitCost: 450,
  businessJustification: 'Replacement monitors for the design team'
};

async function approveAll(id) {
  for (const user of ['manager', 'director', 'finance']) {
    const res = await s.as(user, 'POST', `/api/v1/procurement/requisitions/${id}/approve`, { comment: `Approved by ${user}` });
    assert.equal(res.status, 200, `${user} approval`);
  }
}

test('TC-PROC-01 submits a purchase requisition in the pending-manager state', async () => {
  const res = await s.as('employee', 'POST', '/api/v1/procurement/requisitions', hardwareRequest);
  assert.equal(res.status, 201);
  assert.match(res.body.prNumber, /^PR-\d{4}-\d{4}$/);
  assert.equal(res.body.state, 'PENDING_MANAGER_APPROVAL');
  assert.equal(res.body.estimatedTotal, 900);

  const own = await s.as('employee', 'GET', `/api/v1/procurement/requisitions/${res.body.id}`);
  assert.equal(own.status, 200);
  const other = await s.as('employee2', 'GET', `/api/v1/procurement/requisitions/${res.body.id}`);
  assert.equal(other.status, 403, 'employees cannot read other people\'s requisitions');

  for (const bad of [{ quantity: 0 }, { estimatedUnitCost: -100 }, { businessJustification: 'short' }, { itemType: 'SOFTWARE_LICENSE' }]) {
    const r = await s.as('employee', 'POST', '/api/v1/procurement/requisitions', { ...hardwareRequest, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const auditor = await s.as('auditor', 'POST', '/api/v1/procurement/requisitions', hardwareRequest);
  assert.equal(auditor.status, 403, 'auditors are read-only');
});

test('TC-PROC-02 enforces the Manager -> IT Director -> Finance approval chain', async () => {
  const pr = (await s.as('employee', 'POST', '/api/v1/procurement/requisitions', hardwareRequest)).body;
  const url = `/api/v1/procurement/requisitions/${pr.id}`;

  const financeTooEarly = await s.as('finance', 'POST', `${url}/approve`);
  assert.equal(financeTooEarly.status, 403, 'stages cannot be skipped');
  const noPo = await s.as('finance', 'POST', `${url}/purchase-order`, { vendorName: 'Dell' });
  assert.equal(noPo.status, 409, 'no purchase order before approval');

  assert.equal((await s.as('manager', 'POST', `${url}/approve`)).body.state, 'PENDING_DIRECTOR_APPROVAL');
  const managerAgain = await s.as('manager', 'POST', `${url}/approve`);
  assert.equal(managerAgain.status, 403);
  assert.equal((await s.as('director', 'POST', `${url}/approve`)).body.state, 'PENDING_FINANCE_APPROVAL');
  const done = await s.as('finance', 'POST', `${url}/approve`);
  assert.equal(done.body.state, 'APPROVED');
  assert.deepEqual(done.body.approvals.map((a) => a.role), ['MANAGER', 'IT_DIRECTOR', 'FINANCE_OFFICER']);

  const late = await s.as('manager', 'POST', `${url}/approve`);
  assert.equal(late.status, 409);
});

test('TC-PROC-02 supports rejection and separation of duties', async () => {
  const own = (await s.as('manager', 'POST', '/api/v1/procurement/requisitions', hardwareRequest)).body;
  const selfApprove = await s.as('manager', 'POST', `/api/v1/procurement/requisitions/${own.id}/approve`);
  assert.equal(selfApprove.status, 403, 'requesters cannot approve their own requisition');

  const pr = (await s.as('employee', 'POST', '/api/v1/procurement/requisitions', hardwareRequest)).body;
  await s.as('manager', 'POST', `/api/v1/procurement/requisitions/${pr.id}/approve`);
  const noReason = await s.as('director', 'POST', `/api/v1/procurement/requisitions/${pr.id}/reject`, {});
  assert.equal(noReason.status, 400);
  const rejected = await s.as('director', 'POST', `/api/v1/procurement/requisitions/${pr.id}/reject`, { reason: 'Budget frozen this quarter' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.state, 'REJECTED');
  assert.equal(rejected.body.rejection.role, 'IT_DIRECTOR');
  const afterReject = await s.as('finance', 'POST', `/api/v1/procurement/requisitions/${pr.id}/approve`);
  assert.equal(afterReject.status, 409);
});

test('TC-PROC-03 issues a purchase order and onboards delivered hardware', async () => {
  const pr = (await s.as('employee', 'POST', '/api/v1/procurement/requisitions', hardwareRequest)).body;
  await approveAll(pr.id);

  const po = await s.as('finance', 'POST', `/api/v1/procurement/requisitions/${pr.id}/purchase-order`, { vendorName: 'Dell Technologies', expectedDeliveryDate: '2026-11-15' });
  assert.equal(po.status, 201);
  assert.match(po.body.poNumber, /^PO-\d{4}-\d{4}$/);
  assert.equal(po.body.totalAmount, 900);
  const second = await s.as('finance', 'POST', `/api/v1/procurement/requisitions/${pr.id}/purchase-order`, { vendorName: 'Dell Technologies' });
  assert.equal(second.status, 409, 'only one PO per requisition');

  const wrongCount = await s.as('technician', 'POST', `/api/v1/procurement/purchase-orders/${po.body.id}/deliver`, { serialNumbers: ['MON-0001'] });
  assert.equal(wrongCount.status, 400);

  const delivered = await s.as('technician', 'POST', `/api/v1/procurement/purchase-orders/${po.body.id}/deliver`, {
    serialNumbers: ['MON-0001', 'MON-0002'],
    warrantyExpiry: '2029-11-15'
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.status, 'DELIVERED');
  assert.equal(delivered.body.createdAssetIds.length, 2);

  for (const id of delivered.body.createdAssetIds) {
    const asset = await s.as('itadmin', 'GET', `/api/v1/assets/${id}`);
    assert.equal(asset.body.status, 'AVAILABLE', 'onboarded into stock');
    assert.equal(asset.body.source, 'PROCUREMENT');
    assert.equal(asset.body.purchaseOrderId, po.body.id);
    assert.equal(asset.body.category, 'PERIPHERAL');
  }
  const prAfter = await s.as('employee', 'GET', `/api/v1/procurement/requisitions/${pr.id}`);
  assert.equal(prAfter.body.state, 'DELIVERED');
  const redeliver = await s.as('technician', 'POST', `/api/v1/procurement/purchase-orders/${po.body.id}/deliver`, { serialNumbers: ['MON-0003', 'MON-0004'] });
  assert.equal(redeliver.status, 409);
});

test('TC-PROC-03 onboards a delivered software purchase as a license pool', async () => {
  const pr = (
    await s.as('employee', 'POST', '/api/v1/procurement/requisitions', {
      itemType: 'SOFTWARE_LICENSE',
      itemDescription: 'Figma Professional seats',
      softwareName: 'Figma',
      quantity: 5,
      estimatedUnitCost: 180,
      businessJustification: 'Design tooling for the new UX squad'
    })
  ).body;
  await approveAll(pr.id);
  const po = (await s.as('finance', 'POST', `/api/v1/procurement/requisitions/${pr.id}/purchase-order`, { vendorName: 'Figma Inc' })).body;
  const delivered = await s.as('itadmin', 'POST', `/api/v1/procurement/purchase-orders/${po.id}/deliver`, { licenseKey: 'FIGMA-PRO-0000-ABCD', validUntil: '2099-11-01' });
  assert.equal(delivered.status, 200);
  const license = await s.as('itadmin', 'GET', `/api/v1/licenses/${delivered.body.createdLicenseId}`);
  assert.equal(license.body.softwareName, 'Figma');
  assert.equal(license.body.totalSeats, 5);
  assert.equal(license.body.licenseKeyMasked, 'XXXX-XXXX-XXXX-ABCD');
});
