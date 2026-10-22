'use strict';

const crypto = require('node:crypto');
const { validate } = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { isoDate, normalizeSoftwareName } = require('../lib/util');
const { maskKey } = require('../security/vault');
const { STATUS } = require('./hardware');

const LICENSE_TYPES = ['PERPETUAL', 'SUBSCRIPTION', 'SAAS', 'VOLUME', 'OEM'];

const LICENSE_SCHEMA = {
  softwareName: { type: 'string', required: true, maxLength: 120 },
  publisher: { type: 'string', maxLength: 120 },
  version: { type: 'string', maxLength: 40 },
  licenseType: { type: 'string', enum: LICENSE_TYPES, default: 'SUBSCRIPTION' },
  totalSeats: { type: 'number', required: true, integer: true, min: 1, max: 1000000 },
  licenseKey: { type: 'string', maxLength: 200 },
  validFrom: { type: 'date' },
  validUntil: { type: 'date' },
  costPerSeat: { type: 'number', min: 0, max: 10000000, default: 0 }
};

const ALLOCATION_SCHEMA = {
  assetId: { type: 'string', required: true, maxLength: 64 },
  userId: { type: 'string', maxLength: 32 }
};

const allocationKey = (licenseId, assetId) => `${licenseId}:${assetId}`;

function createLicenseService(ctx) {
  const { store, audit, config, vault, services } = ctx;
  const nowIso = () => new Date(config.now()).toISOString();

  /** Public representation: never includes the encrypted or raw key. */
  function view(license) {
    const { licenseKeyEncrypted, ...rest } = license;
    return { ...rest, availableSeats: license.totalSeats - license.usedSeats, hasKey: Boolean(licenseKeyEncrypted) };
  }

  function getRecord(id) {
    const license = store.get('licenses', id);
    if (!license) throw notFound('License not found');
    return license;
  }

  function createLicense(body, actor) {
    const data = validate(body, LICENSE_SCHEMA);
    if (data.validFrom && data.validUntil && data.validUntil < data.validFrom) {
      throw badRequest('Validation failed', { errors: ['validUntil must not be before validFrom'] });
    }
    const now = nowIso();
    const license = {
      id: crypto.randomUUID(),
      softwareName: data.softwareName,
      normalizedName: normalizeSoftwareName(data.softwareName),
      publisher: data.publisher || null,
      version: data.version || null,
      licenseType: data.licenseType,
      totalSeats: data.totalSeats,
      usedSeats: 0,
      // Not defaulted: an invented start date could fall after validUntil.
      validFrom: data.validFrom || null,
      validUntil: data.validUntil || null,
      costPerSeat: data.costPerSeat,
      licenseKeyEncrypted: data.licenseKey ? vault.encrypt(data.licenseKey) : null,
      licenseKeyMasked: maskKey(data.licenseKey),
      createdAt: now,
      updatedAt: now
    };
    store.insert('licenses', license);
    audit.append({
      actor,
      action: 'LICENSE_CREATED',
      entityType: 'SoftwareLicense',
      entityId: license.id,
      details: { softwareName: license.softwareName, totalSeats: license.totalSeats }
    });
    return view(license);
  }

  const getLicense = (id) => view(getRecord(id));

  function listLicenses() {
    return store.all('licenses').map(view);
  }

  function revealKey(id, actor) {
    const license = getRecord(id);
    if (!license.licenseKeyEncrypted) throw notFound('This license has no stored product key');
    const licenseKey = vault.decrypt(license.licenseKeyEncrypted);
    audit.append({ actor, action: 'LICENSE_KEY_REVEALED', entityType: 'SoftwareLicense', entityId: id });
    return { licenseId: id, licenseKey };
  }

  /**
   * Allocates one seat. Runs synchronously between the availability check and
   * the decrement, so two concurrent requests can never take the same seat.
   */
  function allocate(licenseId, body, actor) {
    const { assetId, userId } = validate(body, ALLOCATION_SCHEMA);
    const license = getRecord(licenseId);
    const asset = services.hardware.getAsset(assetId);
    if (asset.status === STATUS.DECOMMISSIONED) throw conflict('Cannot allocate a license to a decommissioned asset');
    if (license.validUntil && license.validUntil < isoDate(config.now())) {
      throw conflict(`License expired on ${license.validUntil}`);
    }
    const key = allocationKey(licenseId, assetId);
    if (store.get('allocations', key)) throw conflict('This asset already holds a seat of this license');
    if (license.usedSeats >= license.totalSeats) {
      throw conflict(`No available seats: all ${license.totalSeats} seats of ${license.softwareName} are allocated`);
    }

    const now = nowIso();
    const allocation = {
      id: key,
      allocationId: crypto.randomUUID(),
      licenseId,
      assetId,
      assetTag: asset.assetTag,
      userId: userId || asset.assignedTo || null,
      allocatedAt: now,
      allocatedBy: actor.username
    };
    store.insert('allocations', allocation);
    const updated = { ...license, usedSeats: license.usedSeats + 1, updatedAt: now };
    store.update('licenses', updated);
    audit.append({ actor, action: 'LICENSE_SEAT_ALLOCATED', entityType: 'SoftwareLicense', entityId: licenseId, details: { assetId } });
    return { allocation, license: view(updated) };
  }

  function reclaim(licenseId, assetId, actor, reason = 'Manual reclaim') {
    const license = getRecord(licenseId);
    const key = allocationKey(licenseId, assetId);
    const allocation = store.get('allocations', key);
    if (!allocation) throw notFound('No allocation of this license exists for the asset');
    store.remove('allocations', key);
    const updated = { ...license, usedSeats: Math.max(0, license.usedSeats - 1), updatedAt: nowIso() };
    store.update('licenses', updated);
    audit.append({ actor, action: 'LICENSE_SEAT_RECLAIMED', entityType: 'SoftwareLicense', entityId: licenseId, details: { assetId, reason } });
    return { reclaimed: allocation, license: view(updated) };
  }

  function reclaimAllForAsset(assetId, actor, reason) {
    const held = store.all('allocations').filter((a) => a.assetId === assetId);
    return held.map((a) => {
      reclaim(a.licenseId, assetId, actor, reason);
      return a;
    });
  }

  function listAllocations(licenseId) {
    getRecord(licenseId);
    return store.all('allocations').filter((a) => a.licenseId === licenseId);
  }

  return { createLicense, getLicense, listLicenses, revealKey, allocate, reclaim, reclaimAllForAsset, listAllocations, view };
}

module.exports = { createLicenseService, LICENSE_TYPES };
