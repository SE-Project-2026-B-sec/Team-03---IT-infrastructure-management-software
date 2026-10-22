'use strict';

/* eslint-disable security/detect-non-literal-fs-filename --
   File paths come from operator configuration (DATA_FILE, BACKUP_DIR, CLI
   arguments), never from HTTP request data. */

const fs = require('node:fs');
const path = require('node:path');
const { deepFreeze } = require('../lib/util');

const COLLECTIONS = [
  'users',
  'assets',
  'licenses',
  'allocations',
  'manifests',
  'incidents',
  'requisitions',
  'purchaseOrders',
  'maintenance',
  'notifications'
];

/** Unique, case-insensitive secondary indexes. */
const INDEXES = {
  users: ['username', 'employeeId'],
  assets: ['assetTag', 'serialNumber', 'macAddress']
};

const SCHEMA_VERSION = 1;

const indexKey = (value) => String(value).toLowerCase();

/**
 * In-memory data store with secondary indexes and atomic JSON snapshot
 * persistence (IT-NF-003, IT-NF-006). Node.js runs request handlers on one
 * thread, so each synchronous read-check-write sequence in a service is
 * atomic; this is what prevents concurrent seat over-allocation.
 */
class Store {
  constructor({ file = null, persistDelayMs = 200, logger = null } = {}) {
    this.file = file ? path.resolve(file) : null;
    this.persistDelayMs = persistDelayMs;
    this.logger = logger;
    this.saveTimer = null;
    this.lastSaveError = null;
    this.lastSavedAt = null;
    this.reset();
  }

  reset() {
    this.collections = new Map(COLLECTIONS.map((name) => [name, new Map()]));
    this.indexes = new Map();
    for (const [collection, fields] of Object.entries(INDEXES)) {
      for (const field of fields) this.indexes.set(`${collection}.${field}`, new Map());
    }
    this.meta = { schemaVersion: SCHEMA_VERSION, counters: {}, flags: {} };
    this.blacklist = new Set();
    this.alertLog = new Set();
    this.audit = [];
  }

  collection(name) {
    const c = this.collections.get(name);
    if (!c) throw new Error(`Unknown collection: ${name}`);
    return c;
  }

  get(name, id) {
    return this.collection(name).get(id) || null;
  }

  all(name) {
    return Array.from(this.collection(name).values());
  }

  count(name) {
    return this.collection(name).size;
  }

  findBy(name, field, value) {
    if (value === undefined || value === null) return null;
    const index = this.indexes.get(`${name}.${field}`);
    if (!index) throw new Error(`No index on ${name}.${field}`);
    const id = index.get(indexKey(value));
    return id ? this.get(name, id) : null;
  }

  insert(name, record) {
    const c = this.collection(name);
    if (c.has(record.id)) throw new Error(`Duplicate id ${record.id} in ${name}`);
    this.addToIndexes(name, record);
    c.set(record.id, record);
    this.markDirty();
    return record;
  }

  update(name, record) {
    const c = this.collection(name);
    const previous = c.get(record.id);
    if (!previous) throw new Error(`Cannot update missing ${name}/${record.id}`);
    this.removeFromIndexes(name, previous);
    this.addToIndexes(name, record);
    c.set(record.id, record);
    this.markDirty();
    return record;
  }

  remove(name, id) {
    const c = this.collection(name);
    const previous = c.get(id);
    if (!previous) return false;
    this.removeFromIndexes(name, previous);
    c.delete(id);
    this.markDirty();
    return true;
  }

  addToIndexes(name, record) {
    for (const field of INDEXES[name] || []) {
      const value = record[field];
      if (value === undefined || value === null || value === '') continue;
      const index = this.indexes.get(`${name}.${field}`);
      const existing = index.get(indexKey(value));
      if (existing && existing !== record.id) throw new Error(`Unique index violation on ${name}.${field}`);
      index.set(indexKey(value), record.id);
    }
  }

  removeFromIndexes(name, record) {
    for (const field of INDEXES[name] || []) {
      const value = record[field];
      if (value === undefined || value === null || value === '') continue;
      this.indexes.get(`${name}.${field}`).delete(indexKey(value));
    }
  }

  nextNumber(counter) {
    this.meta.counters[counter] = (this.meta.counters[counter] || 0) + 1;
    this.markDirty();
    return this.meta.counters[counter];
  }

  /** Records a de-duplication key; returns false if it was already present. */
  claimAlertKey(key) {
    if (this.alertLog.has(key)) return false;
    this.alertLog.add(key);
    this.markDirty();
    return true;
  }

  appendAudit(entry) {
    this.audit.push(entry);
    this.markDirty();
  }

  toJSON() {
    const data = { meta: this.meta, blacklist: [...this.blacklist], alertLog: [...this.alertLog], audit: this.audit };
    for (const [name, c] of this.collections) data[name] = Array.from(c.values());
    return data;
  }

  loadFromObject(data) {
    if (!data || data.meta?.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('Unsupported or corrupt data file (schema version mismatch)');
    }
    this.reset();
    this.meta = data.meta;
    this.blacklist = new Set(data.blacklist || []);
    this.alertLog = new Set(data.alertLog || []);
    this.audit = (data.audit || []).map((e) => deepFreeze(e));
    for (const name of COLLECTIONS) {
      for (const record of data[name] || []) {
        this.addToIndexes(name, record);
        this.collection(name).set(record.id, record);
      }
    }
  }

  /** Loads the snapshot from disk if a data file is configured and exists. */
  load() {
    if (!this.file || !fs.existsSync(this.file)) return false;
    this.loadFromObject(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    return true;
  }

  markDirty() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushSync();
    }, this.persistDelayMs);
    this.saveTimer.unref();
  }

  /** Atomically writes the snapshot: write a temp file, fsync, then rename. */
  flushSync() {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      const fd = fs.openSync(tmp, 'w', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(this.toJSON()));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, this.file);
      this.lastSaveError = null;
      this.lastSavedAt = new Date().toISOString();
    } catch (err) {
      this.lastSaveError = err.message;
      if (this.logger) this.logger.error('Failed to persist data snapshot', { error: err.message });
    }
  }
}

module.exports = { Store, COLLECTIONS, SCHEMA_VERSION };
