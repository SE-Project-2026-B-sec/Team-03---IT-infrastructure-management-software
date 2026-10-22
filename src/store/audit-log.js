'use strict';

const { sha256, canonicalJson, deepFreeze } = require('../lib/util');

const GENESIS_HASH = '0'.repeat(64);

const hashEntry = (entry) => {
  const { hash, ...rest } = entry;
  return sha256(canonicalJson(rest));
};

/**
 * Append-only, hash-chained audit trail (IT-NF-004). Each entry stores the
 * SHA-256 hash of its predecessor, so altering or deleting any stored entry
 * breaks verification from that point on. No API exists to modify entries.
 */
class AuditLog {
  constructor(store, now = Date.now) {
    this.store = store;
    this.now = now;
  }

  append({ actor, action, entityType, entityId = null, details = {} }) {
    const entries = this.store.audit;
    const prev = entries.length ? entries[entries.length - 1] : null;
    const entry = {
      seq: prev ? prev.seq + 1 : 1,
      timestamp: new Date(this.now()).toISOString(),
      actorId: actor?.id || null,
      actorName: actor?.username || null,
      actorRole: actor?.role || null,
      ip: actor?.ip || null,
      action,
      entityType,
      entityId,
      details,
      prevHash: prev ? prev.hash : GENESIS_HASH
    };
    entry.hash = hashEntry(entry);
    this.store.appendAudit(deepFreeze(entry));
    return entry;
  }

  list({ limit = 100, entityId, action } = {}) {
    let entries = this.store.audit;
    if (entityId) entries = entries.filter((e) => e.entityId === entityId);
    if (action) entries = entries.filter((e) => e.action === action);
    return entries.slice(-limit).reverse();
  }

  verify() {
    let prevHash = GENESIS_HASH;
    const entries = this.store.audit;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (e.seq !== i + 1 || e.prevHash !== prevHash || hashEntry(e) !== e.hash) {
        return { valid: false, entries: entries.length, brokenAtSeq: i + 1 };
      }
      prevHash = e.hash;
    }
    return { valid: true, entries: entries.length, headHash: prevHash };
  }
}

module.exports = { AuditLog, GENESIS_HASH };
