'use strict';

const { DAY_MS, isoDate, dateToMs } = require('../lib/util');
const { STATUS } = require('./hardware');

const THRESHOLDS = [7, 30, 60];
const SEVERITY = { EXPIRED: 'HIGH', 7: 'HIGH', 30: 'MEDIUM', 60: 'LOW' };

/** Smallest threshold bucket the expiry falls into, "EXPIRED", or null. */
function bucketFor(daysLeft) {
  if (daysLeft < 0) return 'EXPIRED';
  return THRESHOLDS.find((t) => daysLeft <= t) || null;
}

/**
 * Scans license and warranty expiry dates and raises one notification per
 * item per threshold (60, 30 and 7 days, then on expiry) (IT-F-013).
 */
function createAlertService({ store, audit, config, services }) {
  let timer = null;

  function runExpiryCheck(asOf, actor) {
    const asOfDate = asOf || isoDate(config.now());
    const asOfMs = dateToMs(asOfDate);
    const items = [
      ...store
        .all('licenses')
        .filter((l) => l.validUntil)
        .map((l) => ({ kind: 'LICENSE', id: l.id, name: `${l.softwareName} license`, date: l.validUntil, entityType: 'SoftwareLicense' })),
      ...store
        .all('assets')
        .filter((a) => a.warrantyExpiry && a.status !== STATUS.DECOMMISSIONED)
        .map((a) => ({ kind: 'WARRANTY', id: a.id, name: `Warranty for ${a.assetTag}`, date: a.warrantyExpiry, entityType: 'HardwareAsset' }))
    ];

    const created = [];
    for (const item of items) {
      const daysLeft = Math.round((dateToMs(item.date) - asOfMs) / DAY_MS);
      const bucket = bucketFor(daysLeft);
      if (bucket === null) continue;
      const expired = bucket === 'EXPIRED';
      const n = services.notifications.raise({
        dedupeKey: `EXPIRY:${item.kind}:${item.id}:${bucket}`,
        type: expired ? `${item.kind}_EXPIRED` : `${item.kind}_EXPIRING`,
        severity: SEVERITY[bucket],
        title: expired ? `${item.name} has expired` : `${item.name} expires in ${daysLeft} day(s)`,
        message: `${item.name} ${expired ? 'expired' : 'expires'} on ${item.date}.`,
        entityType: item.entityType,
        entityId: item.id,
        data: { expiresOn: item.date, daysLeft, threshold: bucket }
      });
      if (n) created.push(n);
    }
    audit.append({ actor, action: 'EXPIRY_CHECK_RUN', entityType: 'System', details: { asOf: asOfDate, checked: items.length, created: created.length } });
    return { asOf: asOfDate, checked: items.length, created };
  }

  /** Runs the check now and then once a day while the server is up. */
  function startScheduler(logger) {
    const systemActor = { id: null, username: 'scheduler', role: 'SYSTEM' };
    const run = () => {
      try {
        const result = runExpiryCheck(undefined, systemActor);
        logger.info('Scheduled expiry check completed', { checked: result.checked, created: result.created.length });
      } catch (err) {
        logger.error('Scheduled expiry check failed', { error: err.message });
      }
    };
    run();
    timer = setInterval(run, DAY_MS);
    timer.unref();
  }

  function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runExpiryCheck, startScheduler, stopScheduler };
}

module.exports = { createAlertService, bucketFor };
