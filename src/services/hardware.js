'use strict';

const crypto = require('node:crypto');
const { validate } = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { round2, isoDate, dateToMs, pad } = require('../lib/util');
const { renderLabelSvg } = require('./barcode');

const CATEGORIES = ['LAPTOP', 'DESKTOP', 'SERVER', 'NETWORK', 'PERIPHERAL', 'MOBILE', 'OTHER'];
const STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  IN_USE: 'IN_USE',
  UNDER_REPAIR: 'UNDER_REPAIR',
  DECOMMISSIONED: 'DECOMMISSIONED'
});
const DEFAULT_LIFESPAN_YEARS = { LAPTOP: 4, DESKTOP: 5, SERVER: 6, NETWORK: 7, PERIPHERAL: 3, MOBILE: 3, OTHER: 5 };
const MAINTENANCE_TYPES = ['REPAIR', 'UPGRADE', 'PREVENTIVE', 'INSPECTION'];
const SANITIZATION_METHODS = ['CLEAR', 'PURGE', 'DESTROY'];

const TAG_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9-]{2,39}$/;
const MAC_RE = /^[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}$/i;

const ASSET_SCHEMA = {
  assetTag: { type: 'string', maxLength: 32 },
  serialNumber: { type: 'string', required: true, pattern: SERIAL_RE, maxLength: 40 },
  manufacturer: { type: 'string', maxLength: 80 },
  model: { type: 'string', maxLength: 120 },
  category: { type: 'string', enum: CATEGORIES, default: 'OTHER' },
  purchaseDate: { type: 'date' },
  purchaseCost: { type: 'number', min: 0, max: 100000000, default: 0 },
  warrantyExpiry: { type: 'date' },
  macAddress: { type: 'string', pattern: MAC_RE, maxLength: 17 },
  location: { type: 'string', maxLength: 120 },
  specifications: { type: 'map', maxKeys: 20 }
};

const CHECKOUT_SCHEMA = {
  employeeId: { type: 'string', required: true, maxLength: 32 },
  notes: { type: 'string', maxLength: 500 }
};
const CHECKIN_SCHEMA = { notes: { type: 'string', maxLength: 500 } };

const MAINTENANCE_SCHEMA = {
  type: { type: 'string', required: true, enum: MAINTENANCE_TYPES },
  description: { type: 'string', required: true, minLength: 5, maxLength: 1000 },
  technician: { type: 'string', required: true, maxLength: 120 },
  vendor: { type: 'string', maxLength: 120 },
  cost: { type: 'number', min: 0, max: 10000000, default: 0 },
  partsReplaced: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 } },
  serviceDate: { type: 'date' },
  outOfService: { type: 'boolean', default: false }
};
const MAINTENANCE_COMPLETE_SCHEMA = {
  resolutionNotes: { type: 'string', required: true, minLength: 3, maxLength: 1000 },
  additionalCost: { type: 'number', min: 0, max: 10000000, default: 0 }
};

const DECOMMISSION_SCHEMA = {
  sanitizationMethod: { type: 'string', required: true, enum: SANITIZATION_METHODS },
  certificateId: { type: 'string', required: true, maxLength: 64 },
  performedBy: { type: 'string', required: true, maxLength: 120 },
  disposalVendor: { type: 'string', maxLength: 120 },
  notes: { type: 'string', maxLength: 1000 }
};

/**
 * Straight-line (SL) or written-down-value (WDV) depreciation (IT-F-004).
 * Pure function so it can be unit tested in isolation.
 */
function computeDepreciation({ cost, salvageValue, lifespanYears, ageYears, method = 'SL', rate }) {
  if (!(Number.isFinite(cost) && cost >= 0)) throw badRequest('cost must be a non-negative number');
  if (!(Number.isFinite(lifespanYears) && lifespanYears > 0)) throw badRequest('lifespanYears must be greater than zero');
  if (!(Number.isFinite(salvageValue) && salvageValue >= 0 && salvageValue <= cost)) {
    throw badRequest('salvageValue must be between 0 and the purchase cost');
  }
  if (!(Number.isFinite(ageYears) && ageYears >= 0)) throw badRequest('ageYears must be a non-negative number');

  if (method === 'SL') {
    const annual = (cost - salvageValue) / lifespanYears;
    const accumulated = Math.min(cost - salvageValue, annual * ageYears);
    const bookValue = cost - accumulated;
    return {
      method,
      cost,
      salvageValue,
      lifespanYears,
      ageYears: round2(ageYears),
      annualDepreciation: round2(annual),
      accumulatedDepreciation: round2(accumulated),
      bookValue: round2(bookValue),
      fullyDepreciated: ageYears >= lifespanYears
    };
  }
  if (method === 'WDV') {
    let r = rate;
    if (r === undefined) {
      r = cost > 0 && salvageValue > 0 ? 1 - (salvageValue / cost) ** (1 / lifespanYears) : Math.min(1, 2 / lifespanYears);
    }
    if (!(r > 0 && r <= 1)) throw badRequest('rate must be greater than 0 and at most 1');
    const bookValue = Math.max(salvageValue, cost * (1 - r) ** ageYears);
    return {
      method,
      cost,
      salvageValue,
      lifespanYears,
      ageYears: round2(ageYears),
      rate: Math.round(r * 10000) / 10000,
      accumulatedDepreciation: round2(cost - bookValue),
      bookValue: round2(bookValue),
      fullyDepreciated: bookValue <= salvageValue
    };
  }
  throw badRequest('method must be SL or WDV');
}

/**
 * Age in years between two YYYY-MM-DD dates: whole calendar years up to the
 * last anniversary plus the fraction of the following year.
 */
function yearsBetween(from, to) {
  const start = dateToMs(from);
  const end = dateToMs(to);
  if (end < start) return -1;
  const anniversary = (years) => {
    const d = new Date(start);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    return d.getTime();
  };
  let years = 0;
  while (anniversary(years + 1) <= end) years += 1;
  const last = anniversary(years);
  return years + (end - last) / (anniversary(years + 1) - last);
}

function createHardwareService(ctx) {
  const { store, audit, config, services } = ctx;
  const nowIso = () => new Date(config.now()).toISOString();

  function getAsset(id) {
    const asset = store.get('assets', id);
    if (!asset) throw notFound('Asset not found');
    return asset;
  }

  function generateTag() {
    const year = new Date(config.now()).getUTCFullYear();
    let tag;
    do {
      tag = `HW-${year}-${pad(store.nextNumber(`assetTag-${year}`), 6)}`;
    } while (store.findBy('assets', 'assetTag', tag));
    return tag;
  }

  function assertUnique({ assetTag, serialNumber, macAddress }) {
    if (assetTag && store.findBy('assets', 'assetTag', assetTag)) throw conflict(`Asset tag ${assetTag} already exists`);
    if (store.findBy('assets', 'serialNumber', serialNumber)) {
      throw conflict(`Serial number ${serialNumber} already exists`);
    }
    if (macAddress && store.findBy('assets', 'macAddress', macAddress)) {
      throw conflict(`MAC address ${macAddress} already exists`);
    }
  }

  /** Inserts an already-validated asset. Shared with procurement onboarding. */
  function insertAsset(data, actor, source = 'MANUAL') {
    const assetTag = data.assetTag || generateTag();
    const now = nowIso();
    const asset = {
      id: crypto.randomUUID(),
      assetTag,
      serialNumber: data.serialNumber,
      manufacturer: data.manufacturer || null,
      model: data.model || null,
      category: data.category || 'OTHER',
      purchaseDate: data.purchaseDate || isoDate(config.now()),
      purchaseCost: data.purchaseCost || 0,
      warrantyExpiry: data.warrantyExpiry || null,
      macAddress: data.macAddress ? data.macAddress.toUpperCase() : null,
      location: data.location || null,
      specifications: data.specifications || {},
      status: STATUS.AVAILABLE,
      assignedTo: null,
      assignmentHistory: [],
      totalMaintenanceCost: 0,
      source,
      purchaseOrderId: data.purchaseOrderId || null,
      decommission: null,
      createdAt: now,
      updatedAt: now
    };
    store.insert('assets', asset);
    audit.append({ actor, action: 'ASSET_CREATED', entityType: 'HardwareAsset', entityId: asset.id, details: { assetTag, source } });
    return asset;
  }

  function createAsset(body, actor) {
    const data = validate(body, ASSET_SCHEMA);
    if (data.assetTag) {
      data.assetTag = data.assetTag.toUpperCase();
      if (!TAG_RE.test(data.assetTag)) {
        throw badRequest('Validation failed', { errors: ['assetTag must be 3-32 characters: A-Z, 0-9 and hyphens'] });
      }
    }
    if (data.purchaseDate && data.warrantyExpiry && data.warrantyExpiry < data.purchaseDate) {
      throw badRequest('Validation failed', { errors: ['warrantyExpiry must not be before purchaseDate'] });
    }
    assertUnique(data);
    return insertAsset(data, actor);
  }

  function findByTag(tag) {
    const asset = store.findBy('assets', 'assetTag', String(tag).toUpperCase());
    if (!asset) throw notFound(`No asset with tag ${tag}`);
    return asset;
  }

  function listAssets({ status, category, q, assignedTo, page = 1, pageSize = 25 }) {
    const needle = q ? q.toLowerCase() : null;
    const matches = [];
    for (const a of store.collection('assets').values()) {
      if (status && a.status !== status) continue;
      if (category && a.category !== category) continue;
      if (assignedTo && a.assignedTo !== assignedTo) continue;
      if (
        needle &&
        !a.assetTag.toLowerCase().includes(needle) &&
        !a.serialNumber.toLowerCase().includes(needle) &&
        !(a.model || '').toLowerCase().includes(needle)
      ) {
        continue;
      }
      matches.push(a);
    }
    const start = (page - 1) * pageSize;
    return { items: matches.slice(start, start + pageSize), page, pageSize, total: matches.length };
  }

  function checkOut(id, body, actor) {
    const { employeeId, notes } = validate(body, CHECKOUT_SCHEMA);
    const asset = getAsset(id);
    if (asset.status !== STATUS.AVAILABLE) {
      throw conflict(`Asset cannot be checked out while ${asset.status}`);
    }
    const employee = services.users.findActiveEmployee(employeeId);
    if (!employee) throw notFound(`No active employee with ID ${employeeId}`);
    const now = nowIso();
    const updated = {
      ...asset,
      status: STATUS.IN_USE,
      assignedTo: employee.employeeId,
      checkedOutAt: now,
      assignmentHistory: [...asset.assignmentHistory, { employeeId: employee.employeeId, checkedOutAt: now, notes: notes || null }],
      updatedAt: now
    };
    store.update('assets', updated);
    audit.append({ actor, action: 'ASSET_CHECKED_OUT', entityType: 'HardwareAsset', entityId: id, details: { employeeId } });
    return updated;
  }

  function checkIn(id, body, actor) {
    const { notes } = validate(body || {}, CHECKIN_SCHEMA);
    const asset = getAsset(id);
    if (asset.status !== STATUS.IN_USE) throw conflict(`Asset is not checked out (status ${asset.status})`);
    const now = nowIso();
    const history = asset.assignmentHistory.map((h, i, arr) =>
      i === arr.length - 1 ? { ...h, checkedInAt: now, checkInNotes: notes || null } : h
    );
    const updated = { ...asset, status: STATUS.AVAILABLE, assignedTo: null, checkedOutAt: null, assignmentHistory: history, updatedAt: now };
    store.update('assets', updated);
    audit.append({ actor, action: 'ASSET_CHECKED_IN', entityType: 'HardwareAsset', entityId: id, details: { from: asset.assignedTo } });
    return updated;
  }

  function depreciation(id, { method = 'SL', salvageValue, lifespanYears, rate, asOf }) {
    const asset = getAsset(id);
    const asOfDate = asOf || isoDate(config.now());
    const ageYears = yearsBetween(asset.purchaseDate, asOfDate);
    if (ageYears < 0) throw badRequest('asOf must not be before the purchase date');
    const result = computeDepreciation({
      cost: asset.purchaseCost,
      salvageValue: salvageValue === undefined ? 0 : salvageValue,
      lifespanYears: lifespanYears === undefined ? DEFAULT_LIFESPAN_YEARS[asset.category] : lifespanYears,
      ageYears,
      method,
      rate
    });
    return { assetId: id, assetTag: asset.assetTag, purchaseDate: asset.purchaseDate, asOf: asOfDate, ...result };
  }

  function label(id) {
    const asset = getAsset(id);
    return renderLabelSvg(asset.assetTag, { caption: [asset.manufacturer, asset.model].filter(Boolean).join(' ') });
  }

  function listMaintenance(id) {
    getAsset(id);
    return store
      .all('maintenance')
      .filter((m) => m.assetId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function addMaintenance(id, body, actor) {
    const data = validate(body, MAINTENANCE_SCHEMA);
    const asset = getAsset(id);
    if (asset.status === STATUS.DECOMMISSIONED) throw conflict('Cannot log maintenance for a decommissioned asset');
    if (data.outOfService && asset.status === STATUS.IN_USE) {
      throw conflict('Check the asset in before taking it out of service');
    }
    const now = nowIso();
    const record = {
      id: crypto.randomUUID(),
      assetId: id,
      assetTag: asset.assetTag,
      type: data.type,
      description: data.description,
      technician: data.technician,
      vendor: data.vendor || null,
      cost: data.cost,
      partsReplaced: data.partsReplaced || [],
      serviceDate: data.serviceDate || isoDate(config.now()),
      outOfService: data.outOfService,
      status: data.outOfService ? 'OPEN' : 'COMPLETED',
      resolutionNotes: null,
      completedAt: data.outOfService ? null : now,
      createdAt: now,
      createdBy: actor.username
    };
    store.insert('maintenance', record);
    store.update('assets', {
      ...asset,
      status: data.outOfService ? STATUS.UNDER_REPAIR : asset.status,
      totalMaintenanceCost: round2(asset.totalMaintenanceCost + data.cost),
      updatedAt: now
    });
    audit.append({ actor, action: 'MAINTENANCE_LOGGED', entityType: 'HardwareAsset', entityId: id, details: { maintenanceId: record.id, type: data.type, cost: data.cost } });
    return record;
  }

  function completeMaintenance(id, maintenanceId, body, actor) {
    const data = validate(body, MAINTENANCE_COMPLETE_SCHEMA);
    const asset = getAsset(id);
    const record = store.get('maintenance', maintenanceId);
    if (!record || record.assetId !== id) throw notFound('Maintenance record not found');
    if (record.status !== 'OPEN') throw conflict('Maintenance record is already completed');
    const now = nowIso();
    const completed = {
      ...record,
      status: 'COMPLETED',
      resolutionNotes: data.resolutionNotes,
      cost: round2(record.cost + data.additionalCost),
      completedAt: now
    };
    store.update('maintenance', completed);
    const stillOpen = store.all('maintenance').some((m) => m.assetId === id && m.status === 'OPEN');
    store.update('assets', {
      ...asset,
      status: asset.status === STATUS.UNDER_REPAIR && !stillOpen ? STATUS.AVAILABLE : asset.status,
      totalMaintenanceCost: round2(asset.totalMaintenanceCost + data.additionalCost),
      updatedAt: now
    });
    audit.append({ actor, action: 'MAINTENANCE_COMPLETED', entityType: 'HardwareAsset', entityId: id, details: { maintenanceId } });
    return completed;
  }

  function decommission(id, body, actor) {
    const data = validate(body, DECOMMISSION_SCHEMA);
    const asset = getAsset(id);
    if (asset.status === STATUS.DECOMMISSIONED) throw conflict('Asset is already decommissioned');
    if (asset.status === STATUS.IN_USE) throw conflict('Check the asset in before decommissioning it');

    const now = nowIso();
    const reclaimed = services.licenses.reclaimAllForAsset(id, actor, 'Asset decommissioned');
    for (const m of store.all('maintenance')) {
      if (m.assetId === id && m.status === 'OPEN') {
        store.update('maintenance', { ...m, status: 'COMPLETED', resolutionNotes: 'Closed on decommissioning', completedAt: now });
      }
    }
    const updated = {
      ...asset,
      status: STATUS.DECOMMISSIONED,
      assignedTo: null,
      decommission: {
        sanitizationStandard: 'NIST SP 800-88 Rev. 1',
        sanitizationMethod: data.sanitizationMethod,
        certificateId: data.certificateId,
        performedBy: data.performedBy,
        disposalVendor: data.disposalVendor || null,
        notes: data.notes || null,
        reclaimedLicenseIds: reclaimed.map((r) => r.licenseId),
        decommissionedAt: now,
        approvedBy: actor.username
      },
      updatedAt: now
    };
    store.update('assets', updated);
    audit.append({
      actor,
      action: 'ASSET_DECOMMISSIONED',
      entityType: 'HardwareAsset',
      entityId: id,
      details: { certificateId: data.certificateId, method: data.sanitizationMethod, reclaimedSeats: reclaimed.length }
    });
    return updated;
  }

  return {
    createAsset,
    insertAsset,
    assertUnique,
    getAsset,
    findByTag,
    listAssets,
    checkOut,
    checkIn,
    depreciation,
    label,
    listMaintenance,
    addMaintenance,
    completeMaintenance,
    decommission
  };
}

module.exports = {
  createHardwareService,
  computeDepreciation,
  yearsBetween,
  CATEGORIES,
  STATUS,
  SERIAL_RE,
  DEFAULT_LIFESPAN_YEARS
};
