'use strict';

const crypto = require('node:crypto');
const { validate } = require('../lib/validate');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');
const { round2, pad, isoDate, normalizeSoftwareName } = require('../lib/util');
const { can } = require('../security/rbac');
const { CATEGORIES, SERIAL_RE } = require('./hardware');

const ITEM_TYPES = ['HARDWARE', 'SOFTWARE_LICENSE'];
const STATE = Object.freeze({
  PENDING_MANAGER_APPROVAL: 'PENDING_MANAGER_APPROVAL',
  PENDING_DIRECTOR_APPROVAL: 'PENDING_DIRECTOR_APPROVAL',
  PENDING_FINANCE_APPROVAL: 'PENDING_FINANCE_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PO_ISSUED: 'PO_ISSUED',
  DELIVERED: 'DELIVERED'
});

/** Approval chain (IT-F-010): the role required at each stage and the next state. */
const STAGES = Object.freeze({
  [STATE.PENDING_MANAGER_APPROVAL]: { role: 'MANAGER', next: STATE.PENDING_DIRECTOR_APPROVAL },
  [STATE.PENDING_DIRECTOR_APPROVAL]: { role: 'IT_DIRECTOR', next: STATE.PENDING_FINANCE_APPROVAL },
  [STATE.PENDING_FINANCE_APPROVAL]: { role: 'FINANCE_OFFICER', next: STATE.APPROVED }
});

const REQUISITION_SCHEMA = {
  itemType: { type: 'string', required: true, enum: ITEM_TYPES },
  itemDescription: { type: 'string', required: true, minLength: 3, maxLength: 300 },
  category: { type: 'string', enum: CATEGORIES },
  softwareName: { type: 'string', maxLength: 120 },
  quantity: { type: 'number', required: true, integer: true, min: 1, max: 1000 },
  estimatedUnitCost: { type: 'number', required: true, min: 0.01, max: 10000000 },
  businessJustification: { type: 'string', required: true, minLength: 10, maxLength: 1000 },
  department: { type: 'string', maxLength: 80 }
};
const APPROVE_SCHEMA = { comment: { type: 'string', maxLength: 500 } };
const REJECT_SCHEMA = { reason: { type: 'string', required: true, minLength: 5, maxLength: 500 } };
const PO_SCHEMA = {
  vendorName: { type: 'string', required: true, maxLength: 120 },
  expectedDeliveryDate: { type: 'date' }
};
const DELIVERY_SCHEMA = {
  serialNumbers: { type: 'array', maxItems: 1000, items: { type: 'string', pattern: SERIAL_RE, maxLength: 40 } },
  licenseKey: { type: 'string', maxLength: 200 },
  validUntil: { type: 'date' },
  warrantyExpiry: { type: 'date' },
  location: { type: 'string', maxLength: 120 }
};

function createProcurementService(ctx) {
  const { store, audit, config, services } = ctx;
  const nowIso = () => new Date(config.now()).toISOString();
  const year = () => new Date(config.now()).getUTCFullYear();

  /** Display name for people in the workflow (falls back to the username). */
  const displayName = (actor) => (store.get('users', actor.id) || {}).fullName || actor.username;

  function getRecord(id) {
    const pr = store.get('requisitions', id);
    if (!pr) throw notFound('Purchase requisition not found');
    return pr;
  }

  function assertCanView(pr, actor) {
    if (pr.requesterId !== actor.id && !can(actor.role, 'procurement:read-all')) {
      throw forbidden('You can only view your own requisitions');
    }
  }

  function createRequisition(body, actor) {
    const data = validate(body, REQUISITION_SCHEMA);
    if (data.itemType === 'SOFTWARE_LICENSE' && !data.softwareName) {
      throw badRequest('Validation failed', { errors: ['softwareName is required for SOFTWARE_LICENSE requisitions'] });
    }
    const now = nowIso();
    const pr = {
      id: crypto.randomUUID(),
      prNumber: `PR-${year()}-${pad(store.nextNumber(`pr-${year()}`), 4)}`,
      requesterId: actor.id,
      requesterName: displayName(actor),
      requesterUsername: actor.username,
      itemType: data.itemType,
      itemDescription: data.itemDescription,
      category: data.itemType === 'HARDWARE' ? data.category || 'OTHER' : null,
      softwareName: data.softwareName || null,
      quantity: data.quantity,
      estimatedUnitCost: data.estimatedUnitCost,
      estimatedTotal: round2(data.quantity * data.estimatedUnitCost),
      businessJustification: data.businessJustification,
      department: data.department || null,
      state: STATE.PENDING_MANAGER_APPROVAL,
      approvals: [],
      rejection: null,
      purchaseOrderId: null,
      history: [{ state: STATE.PENDING_MANAGER_APPROVAL, at: now, by: actor.username }],
      createdAt: now,
      updatedAt: now
    };
    store.insert('requisitions', pr);
    audit.append({ actor, action: 'PR_SUBMITTED', entityType: 'ProcurementRequisition', entityId: pr.id, details: { prNumber: pr.prNumber, estimatedTotal: pr.estimatedTotal } });
    return pr;
  }

  /** Enforces stage role and separation of duties for approve/reject. */
  function assertCanDecide(pr, actor) {
    const stage = STAGES[pr.state];
    if (!stage) throw conflict(`Requisition is not awaiting approval (state ${pr.state})`);
    if (actor.role !== stage.role) throw forbidden(`This stage requires the ${stage.role} role`);
    if (pr.requesterId === actor.id) throw forbidden('You cannot approve or reject your own requisition');
    if (pr.approvals.some((a) => a.approverId === actor.id)) {
      throw forbidden('You already approved this requisition at an earlier stage');
    }
    return stage;
  }

  function approve(id, body, actor) {
    const { comment } = validate(body || {}, APPROVE_SCHEMA);
    const pr = getRecord(id);
    const stage = assertCanDecide(pr, actor);
    const now = nowIso();
    const updated = {
      ...pr,
      state: stage.next,
      approvals: [...pr.approvals, { stage: pr.state, role: actor.role, approverId: actor.id, approverName: displayName(actor), comment: comment || null, at: now }],
      history: [...pr.history, { state: stage.next, at: now, by: actor.username }],
      updatedAt: now
    };
    store.update('requisitions', updated);
    audit.append({ actor, action: 'PR_APPROVED', entityType: 'ProcurementRequisition', entityId: id, details: { stage: pr.state, newState: stage.next } });
    return updated;
  }

  function reject(id, body, actor) {
    const { reason } = validate(body, REJECT_SCHEMA);
    const pr = getRecord(id);
    assertCanDecide(pr, actor);
    const now = nowIso();
    const updated = {
      ...pr,
      state: STATE.REJECTED,
      rejection: { stage: pr.state, role: actor.role, rejectedBy: displayName(actor), reason, at: now },
      history: [...pr.history, { state: STATE.REJECTED, at: now, by: actor.username }],
      updatedAt: now
    };
    store.update('requisitions', updated);
    audit.append({ actor, action: 'PR_REJECTED', entityType: 'ProcurementRequisition', entityId: id, details: { stage: pr.state, reason } });
    return updated;
  }

  function getRequisition(id, actor) {
    const pr = getRecord(id);
    assertCanView(pr, actor);
    return pr;
  }

  function listRequisitions(actor, { state } = {}) {
    let items = store.all('requisitions');
    if (!can(actor.role, 'procurement:read-all')) items = items.filter((p) => p.requesterId === actor.id);
    if (state) items = items.filter((p) => p.state === state);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function issuePurchaseOrder(id, body, actor) {
    const data = validate(body, PO_SCHEMA);
    const pr = getRecord(id);
    if (pr.state === STATE.PO_ISSUED || pr.state === STATE.DELIVERED) throw conflict('A purchase order was already issued for this requisition');
    if (pr.state !== STATE.APPROVED) throw conflict('A purchase order can only be issued for a fully approved requisition');
    const now = nowIso();
    const po = {
      id: crypto.randomUUID(),
      poNumber: `PO-${year()}-${pad(store.nextNumber(`po-${year()}`), 4)}`,
      requisitionId: pr.id,
      prNumber: pr.prNumber,
      vendorName: data.vendorName,
      expectedDeliveryDate: data.expectedDeliveryDate || null,
      items: [{ itemType: pr.itemType, description: pr.itemDescription, quantity: pr.quantity, unitCost: pr.estimatedUnitCost }],
      totalAmount: pr.estimatedTotal,
      status: 'ISSUED',
      issuedAt: now,
      issuedBy: actor.username,
      deliveredAt: null,
      createdAssetIds: [],
      createdLicenseId: null
    };
    store.insert('purchaseOrders', po);
    store.update('requisitions', {
      ...pr,
      state: STATE.PO_ISSUED,
      purchaseOrderId: po.id,
      history: [...pr.history, { state: STATE.PO_ISSUED, at: now, by: actor.username }],
      updatedAt: now
    });
    audit.append({ actor, action: 'PO_ISSUED', entityType: 'PurchaseOrder', entityId: po.id, details: { poNumber: po.poNumber, totalAmount: po.totalAmount } });
    return po;
  }

  function getPurchaseOrder(id) {
    const po = store.get('purchaseOrders', id);
    if (!po) throw notFound('Purchase order not found');
    return po;
  }

  const listPurchaseOrders = () => store.all('purchaseOrders').sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

  /**
   * Confirms delivery and onboards what was bought (IT-F-011): one hardware
   * asset per serial number, or a license pool with the purchased seats.
   * All input is validated before anything is created.
   */
  function receiveDelivery(poId, body, actor) {
    const data = validate(body, DELIVERY_SCHEMA);
    const po = getPurchaseOrder(poId);
    if (po.status !== 'ISSUED') throw conflict('This purchase order was already delivered');
    const pr = getRecord(po.requisitionId);
    const now = nowIso();
    let createdAssetIds = [];
    let createdLicenseId = null;

    if (pr.itemType === 'HARDWARE') {
      const serials = data.serialNumbers || [];
      if (serials.length !== pr.quantity) {
        throw badRequest('Validation failed', { errors: [`serialNumbers must contain exactly ${pr.quantity} entries`] });
      }
      if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) {
        throw badRequest('Validation failed', { errors: ['serialNumbers must be unique'] });
      }
      serials.forEach((serialNumber) => services.hardware.assertUnique({ serialNumber }));
      createdAssetIds = serials.map(
        (serialNumber) =>
          services.hardware.insertAsset(
            {
              serialNumber,
              model: pr.itemDescription,
              category: pr.category,
              purchaseCost: pr.estimatedUnitCost,
              purchaseDate: isoDate(config.now()),
              warrantyExpiry: data.warrantyExpiry,
              location: data.location,
              purchaseOrderId: po.id
            },
            actor,
            'PROCUREMENT'
          ).id
      );
    } else {
      const license = services.licenses.createLicense(
        {
          softwareName: pr.softwareName || normalizeSoftwareName(pr.itemDescription),
          totalSeats: pr.quantity,
          licenseKey: data.licenseKey,
          validUntil: data.validUntil,
          costPerSeat: pr.estimatedUnitCost
        },
        actor
      );
      createdLicenseId = license.id;
    }

    const updatedPo = { ...po, status: 'DELIVERED', deliveredAt: now, receivedBy: actor.username, createdAssetIds, createdLicenseId };
    store.update('purchaseOrders', updatedPo);
    store.update('requisitions', {
      ...pr,
      state: STATE.DELIVERED,
      history: [...pr.history, { state: STATE.DELIVERED, at: now, by: actor.username }],
      updatedAt: now
    });
    audit.append({ actor, action: 'PO_DELIVERED', entityType: 'PurchaseOrder', entityId: po.id, details: { assetsCreated: createdAssetIds.length, licenseCreated: Boolean(createdLicenseId) } });
    return updatedPo;
  }

  return {
    createRequisition,
    approve,
    reject,
    getRequisition,
    listRequisitions,
    issuePurchaseOrder,
    getPurchaseOrder,
    listPurchaseOrders,
    receiveDelivery
  };
}

module.exports = { createProcurementService, STATE, STAGES, ITEM_TYPES };
