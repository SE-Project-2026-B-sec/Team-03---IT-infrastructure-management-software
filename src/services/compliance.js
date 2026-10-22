'use strict';

const crypto = require('node:crypto');
const { validate } = require('../lib/validate');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { round2, normalizeSoftwareName } = require('../lib/util');
const { STATUS } = require('./hardware');

const DEFAULT_BLACKLIST = ['bittorrent', 'utorrent', 'qbittorrent', 'xmrig', 'cryptominer', 'kmspico', 'crack_patcher'];

const MANIFEST_SCHEMA = {
  serialNumber: { type: 'string', maxLength: 40 },
  macAddress: { type: 'string', maxLength: 17 },
  hostname: { type: 'string', maxLength: 120 },
  agentVersion: { type: 'string', maxLength: 40 },
  installedSoftware: {
    type: 'array',
    required: true,
    maxItems: 5000,
    items: {
      type: 'object',
      schema: {
        name: { type: 'string', required: true, maxLength: 200 },
        version: { type: 'string', maxLength: 60 },
        publisher: { type: 'string', maxLength: 120 }
      }
    }
  }
};

const BLACKLIST_SCHEMA = { name: { type: 'string', required: true, minLength: 2, maxLength: 120 } };
const INCIDENT_RESOLVE_SCHEMA = { resolution: { type: 'string', required: true, minLength: 5, maxLength: 1000 } };

function createComplianceService(ctx) {
  const { store, audit, config, services } = ctx;
  const nowIso = () => new Date(config.now()).toISOString();

  function seedBlacklist() {
    if (store.meta.flags.blacklistSeeded) return;
    for (const name of DEFAULT_BLACKLIST) store.blacklist.add(name);
    store.meta.flags.blacklistSeeded = true;
    store.markDirty();
  }

  const listBlacklist = () => [...store.blacklist].sort();

  function addToBlacklist(body, actor) {
    const { name } = validate(body, BLACKLIST_SCHEMA);
    const normalized = normalizeSoftwareName(name);
    if (store.blacklist.has(normalized)) throw conflict(`${normalized} is already blacklisted`);
    store.blacklist.add(normalized);
    store.markDirty();
    audit.append({ actor, action: 'BLACKLIST_ADDED', entityType: 'Blacklist', entityId: normalized });
    return { name: normalized, blacklist: listBlacklist() };
  }

  function raiseIncident(asset, software, actor) {
    const open = store
      .all('incidents')
      .find((i) => i.assetId === asset.id && i.normalizedName === software.normalizedName && i.status === 'OPEN');
    if (open) return null;
    const incident = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      assetTag: asset.assetTag,
      assignedTo: asset.assignedTo,
      softwareName: software.name,
      normalizedName: software.normalizedName,
      classification: 'PROHIBITED_SOFTWARE',
      severity: 'HIGH',
      status: 'OPEN',
      recommendedAction: 'Quarantine the endpoint and uninstall the prohibited software',
      detectedAt: nowIso(),
      resolvedAt: null,
      resolution: null
    };
    store.insert('incidents', incident);
    services.notifications.raise({
      type: 'SECURITY_INCIDENT',
      severity: 'HIGH',
      title: `Prohibited software on ${asset.assetTag}`,
      message: `${software.name} was detected on asset ${asset.assetTag}.`,
      entityType: 'SecurityIncident',
      entityId: incident.id
    });
    audit.append({ actor, action: 'SECURITY_INCIDENT_RAISED', entityType: 'SecurityIncident', entityId: incident.id, details: { assetTag: asset.assetTag, software: software.name } });
    return incident;
  }

  /** Ingests an endpoint agent's installed-software manifest (IT-F-007, IT-F-008). */
  function ingestManifest(body, actor) {
    const data = validate(body, MANIFEST_SCHEMA);
    if (!data.serialNumber && !data.macAddress) {
      throw badRequest('Validation failed', { errors: ['serialNumber or macAddress is required'] });
    }
    const asset =
      (data.serialNumber && store.findBy('assets', 'serialNumber', data.serialNumber)) ||
      (data.macAddress && store.findBy('assets', 'macAddress', data.macAddress));
    if (!asset) throw notFound('Unknown endpoint: register the hardware asset before its agent reports');
    if (asset.status === STATUS.DECOMMISSIONED) throw conflict('Endpoint belongs to a decommissioned asset');

    const seen = new Map();
    for (const item of data.installedSoftware) {
      const normalizedName = normalizeSoftwareName(item.name);
      if (!seen.has(normalizedName)) {
        seen.set(normalizedName, { name: item.name, normalizedName, version: item.version || null, publisher: item.publisher || null });
      }
    }
    const software = [...seen.values()];
    store.insert('manifests', {
      id: crypto.randomUUID(),
      assetId: asset.id,
      hostname: data.hostname || null,
      agentVersion: data.agentVersion || null,
      software,
      receivedAt: nowIso()
    });
    // Keep only the latest manifest per asset.
    for (const m of store.all('manifests')) {
      if (m.assetId === asset.id && m.software !== software) store.remove('manifests', m.id);
    }

    const incidents = software
      .filter((s) => store.blacklist.has(s.normalizedName))
      .map((s) => raiseIncident(asset, s, actor))
      .filter(Boolean);

    audit.append({ actor, action: 'MANIFEST_INGESTED', entityType: 'HardwareAsset', entityId: asset.id, details: { softwareCount: software.length, newIncidents: incidents.length } });
    const reconciliation = reconcile(actor);
    return {
      assetId: asset.id,
      assetTag: asset.assetTag,
      softwareCount: software.length,
      newIncidents: incidents,
      complianceRate: reconciliation.complianceRate,
      breaches: reconciliation.results.filter((r) => r.status === 'NON_COMPLIANT').map((r) => r.softwareName)
    };
  }

  /**
   * Compares installations reported by agents with purchased entitlements.
   * Side-effect free; see reconcile() for the version that raises alerts.
   */
  function computeReconciliation() {
    const activeAssets = new Set(store.all('assets').filter((a) => a.status !== STATUS.DECOMMISSIONED).map((a) => a.id));
    const installs = new Map();
    for (const m of store.all('manifests')) {
      if (!activeAssets.has(m.assetId)) continue;
      for (const s of m.software) {
        if (!installs.has(s.normalizedName)) installs.set(s.normalizedName, { name: s.name, assets: new Set() });
        installs.get(s.normalizedName).assets.add(m.assetId);
      }
    }

    const pools = new Map();
    for (const l of store.all('licenses')) {
      const pool = pools.get(l.normalizedName) || { softwareName: l.softwareName, licenseIds: [], purchasedSeats: 0, allocatedSeats: 0 };
      pool.licenseIds.push(l.id);
      pool.purchasedSeats += l.totalSeats;
      pool.allocatedSeats += l.usedSeats;
      pools.set(l.normalizedName, pool);
    }
    const allocatedAssets = new Map();
    for (const a of store.all('allocations')) {
      const license = store.get('licenses', a.licenseId);
      if (!license) continue;
      if (!allocatedAssets.has(license.normalizedName)) allocatedAssets.set(license.normalizedName, new Set());
      allocatedAssets.get(license.normalizedName).add(a.assetId);
    }

    let totalInstalls = 0;
    let compliantInstalls = 0;
    let totalDeficit = 0;
    const results = [];
    for (const [name, pool] of pools) {
      const installedAssets = installs.get(name)?.assets || new Set();
      const installedCount = installedAssets.size;
      const deficit = Math.max(0, installedCount - pool.purchasedSeats);
      const allocated = allocatedAssets.get(name) || new Set();
      const unallocatedInstalls = [...installedAssets].filter((id) => !allocated.has(id)).length;
      let status = 'UNDER_UTILIZED';
      if (deficit > 0) status = 'NON_COMPLIANT';
      else if (installedCount === pool.purchasedSeats) status = 'FULLY_UTILIZED';
      totalInstalls += installedCount;
      compliantInstalls += Math.min(installedCount, pool.purchasedSeats);
      totalDeficit += deficit;
      results.push({
        softwareName: pool.softwareName,
        normalizedName: name,
        licenseIds: pool.licenseIds,
        purchasedSeats: pool.purchasedSeats,
        allocatedSeats: pool.allocatedSeats,
        installedCount,
        unallocatedInstalls,
        deficit,
        status,
        actionRequired: deficit > 0 ? `Procure ${deficit} additional seat(s) or remove ${deficit} installation(s)` : null
      });
    }
    results.sort((a, b) => b.deficit - a.deficit || a.softwareName.localeCompare(b.softwareName));

    const unlicensedSoftware = [...installs.entries()]
      .filter(([name]) => !pools.has(name) && !store.blacklist.has(name))
      .map(([normalizedName, v]) => ({ softwareName: v.name, normalizedName, installedCount: v.assets.size }))
      .sort((a, b) => b.installedCount - a.installedCount);

    return {
      generatedAt: nowIso(),
      complianceRate: totalInstalls === 0 ? 100 : round2((compliantInstalls / totalInstalls) * 100),
      hasBreaches: totalDeficit > 0,
      totalDeficit,
      totalInstalls,
      results,
      unlicensedSoftware
    };
  }

  /**
   * Runs reconciliation and raises a HIGH-severity notification whenever a
   * pool's deficit appears or grows (IT-F-012). A recovered pool is reset so
   * a later breach is reported again.
   */
  function reconcile(actor) {
    const report = computeReconciliation();
    const raised = [];
    const breachState = store.meta.flags.breaches || {};
    for (const r of report.results) {
      const previous = breachState[r.normalizedName] || 0;
      if (r.deficit > previous) {
        const n = services.notifications.raise({
          type: 'LICENSE_BREACH',
          severity: 'HIGH',
          title: `License breach: ${r.softwareName}`,
          message: `${r.installedCount} installations against ${r.purchasedSeats} purchased seats (deficit ${r.deficit}).`,
          entityType: 'SoftwareLicense',
          entityId: r.licenseIds[0],
          data: { softwareName: r.softwareName, deficit: r.deficit, installedCount: r.installedCount, purchasedSeats: r.purchasedSeats }
        });
        raised.push(n);
        audit.append({ actor, action: 'LICENSE_BREACH_DETECTED', entityType: 'SoftwareLicense', entityId: r.licenseIds[0], details: { softwareName: r.softwareName, deficit: r.deficit } });
      }
      if (r.deficit === 0) delete breachState[r.normalizedName];
      else breachState[r.normalizedName] = r.deficit;
    }
    store.meta.flags.breaches = breachState;
    store.markDirty();
    return { ...report, notificationsRaised: raised };
  }

  function listIncidents({ status } = {}) {
    let items = store.all('incidents');
    if (status) items = items.filter((i) => i.status === status);
    return items.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  function resolveIncident(id, body, actor) {
    const { resolution } = validate(body, INCIDENT_RESOLVE_SCHEMA);
    const incident = store.get('incidents', id);
    if (!incident) throw notFound('Incident not found');
    if (incident.status !== 'OPEN') throw conflict('Incident is already resolved');
    const updated = { ...incident, status: 'RESOLVED', resolution, resolvedAt: nowIso(), resolvedBy: actor.username };
    store.update('incidents', updated);
    audit.append({ actor, action: 'SECURITY_INCIDENT_RESOLVED', entityType: 'SecurityIncident', entityId: id });
    return updated;
  }

  return { seedBlacklist, listBlacklist, addToBlacklist, ingestManifest, computeReconciliation, reconcile, listIncidents, resolveIncident };
}

module.exports = { createComplianceService, DEFAULT_BLACKLIST };
