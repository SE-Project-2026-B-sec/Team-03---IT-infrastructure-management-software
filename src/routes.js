'use strict';

const { Router } = require('./http/router');
const { intQuery, numberQuery, dateQuery, enumQuery } = require('./lib/validate');
const { forbidden } = require('./lib/errors');
const { can } = require('./security/rbac');
const { CATEGORIES, STATUS } = require('./services/hardware');
const { STATE } = require('./services/procurement');

const MANIFEST_BODY_LIMIT = 1024 * 1024;

/**
 * REST API (SAD section 4.3). Options:
 *   perm  - RBAC permission required (PRJ-SR-002)
 *   auth  - 'public' (no token) or 'agent' (X-Agent-Key) instead of a JWT
 *   bodyLimit - maximum JSON body size in bytes
 */
function buildRoutes(services, { audit }) {
  const r = new Router();
  const { users, hardware, licenses, compliance, alerts, procurement, reports, notifications } = services;

  // --- Authentication -----------------------------------------------------
  r.add('POST', '/api/v1/auth/login', ({ body, ip }) => ({ body: users.login(body, ip) }), { auth: 'public', bodyLimit: 4096 });
  r.add('GET', '/api/v1/auth/me', ({ user }) => ({ body: user }), { perm: 'dashboard:read' });

  // --- Dashboard ----------------------------------------------------------
  r.add('GET', '/api/v1/dashboard/summary', ({ user }) => {
    const mine = hardware.listAssets({ assignedTo: user.employeeId, pageSize: 1000 });
    const summary = { role: user.role, myAssets: mine.items.map((a) => ({ id: a.id, assetTag: a.assetTag, model: a.model, category: a.category })) };
    if (can(user.role, 'asset:read')) {
      const byStatus = Object.fromEntries(Object.values(STATUS).map((s) => [s, hardware.listAssets({ status: s, pageSize: 1 }).total]));
      const pools = licenses.listLicenses();
      summary.assets = { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
      summary.licenses = {
        pools: pools.length,
        totalSeats: pools.reduce((n, l) => n + l.totalSeats, 0),
        usedSeats: pools.reduce((n, l) => n + l.usedSeats, 0)
      };
    }
    if (can(user.role, 'compliance:read')) {
      summary.complianceRate = compliance.computeReconciliation().complianceRate;
      summary.openIncidents = compliance.listIncidents({ status: 'OPEN' }).length;
    }
    summary.pendingRequisitions = procurement
      .listRequisitions(user)
      .filter((p) => p.state.startsWith('PENDING')).length;
    return { body: summary };
  }, { perm: 'dashboard:read' });
  r.add('GET', '/api/v1/directory/employees', () => ({ body: users.directory() }), { perm: 'asset:assign' });
  r.add('GET', '/api/v1/me/assets', ({ user }) => ({ body: hardware.listAssets({ assignedTo: user.employeeId, pageSize: 1000 }).items }), { perm: 'dashboard:read' });

  // --- Hardware assets (IT-F-001..004, 015, 016) -------------------------
  r.add('POST', '/api/v1/assets', ({ body, actor }) => ({ status: 201, body: hardware.createAsset(body, actor) }), { perm: 'asset:create' });
  r.add('GET', '/api/v1/assets', ({ query }) => ({
    body: hardware.listAssets({
      status: enumQuery(query, 'status', Object.values(STATUS)),
      category: enumQuery(query, 'category', CATEGORIES),
      q: query.get('q') ? query.get('q').slice(0, 100) : undefined,
      page: intQuery(query, 'page', { min: 1, max: 100000, defaultValue: 1 }),
      pageSize: intQuery(query, 'pageSize', { min: 1, max: 200, defaultValue: 25 })
    })
  }), { perm: 'asset:read' });
  r.add('GET', '/api/v1/assets/by-tag/:tag', ({ params }) => ({ body: hardware.findByTag(params.tag) }), { perm: 'asset:read' });
  r.add('GET', '/api/v1/assets/:id', ({ params }) => ({ body: hardware.getAsset(params.id) }), { perm: 'asset:read' });
  r.add('GET', '/api/v1/assets/:id/label.svg', ({ params }) => ({ raw: hardware.label(params.id), contentType: 'image/svg+xml' }), { perm: 'asset:read' });
  r.add('POST', '/api/v1/assets/:id/checkout', ({ params, body, actor }) => ({ body: hardware.checkOut(params.id, body, actor) }), { perm: 'asset:assign' });
  r.add('POST', '/api/v1/assets/:id/checkin', ({ params, body, actor }) => ({ body: hardware.checkIn(params.id, body, actor) }), { perm: 'asset:assign' });
  r.add('GET', '/api/v1/assets/:id/depreciation', ({ params, query }) => ({
    body: hardware.depreciation(params.id, {
      method: enumQuery(query, 'method', ['SL', 'WDV']),
      salvageValue: numberQuery(query, 'salvageValue', { min: 0, max: 100000000 }),
      lifespanYears: numberQuery(query, 'lifespanYears', { min: 0.1, max: 50 }),
      rate: numberQuery(query, 'rate', { min: 0.0001, max: 1 }),
      asOf: dateQuery(query, 'asOf')
    })
  }), { perm: 'asset:read' });
  r.add('GET', '/api/v1/assets/:id/maintenance', ({ params }) => ({ body: hardware.listMaintenance(params.id) }), { perm: 'asset:read' });
  r.add('POST', '/api/v1/assets/:id/maintenance', ({ params, body, actor }) => ({ status: 201, body: hardware.addMaintenance(params.id, body, actor) }), { perm: 'asset:maintain' });
  r.add('POST', '/api/v1/assets/:id/maintenance/:maintenanceId/complete', ({ params, body, actor }) => ({
    body: hardware.completeMaintenance(params.id, params.maintenanceId, body, actor)
  }), { perm: 'asset:maintain' });
  r.add('POST', '/api/v1/assets/:id/decommission', ({ params, body, actor }) => ({ body: hardware.decommission(params.id, body, actor) }), { perm: 'asset:decommission' });

  // --- Software licenses (IT-F-005, 006, PRJ-SR-003) ---------------------
  r.add('POST', '/api/v1/licenses', ({ body, actor }) => ({ status: 201, body: licenses.createLicense(body, actor) }), { perm: 'license:manage' });
  r.add('GET', '/api/v1/licenses', () => ({ body: licenses.listLicenses() }), { perm: 'license:read' });
  r.add('GET', '/api/v1/licenses/:id', ({ params }) => ({ body: licenses.getLicense(params.id) }), { perm: 'license:read' });
  r.add('GET', '/api/v1/licenses/:id/key', ({ params, actor }) => ({ body: licenses.revealKey(params.id, actor) }), { perm: 'license:reveal-key' });
  r.add('GET', '/api/v1/licenses/:id/allocations', ({ params }) => ({ body: licenses.listAllocations(params.id) }), { perm: 'license:read' });
  r.add('POST', '/api/v1/licenses/:id/allocations', ({ params, body, actor }) => ({ status: 201, body: licenses.allocate(params.id, body, actor) }), { perm: 'license:allocate' });
  r.add('DELETE', '/api/v1/licenses/:id/allocations/:assetId', ({ params, actor }) => ({ body: licenses.reclaim(params.id, params.assetId, actor) }), { perm: 'license:allocate' });

  // --- Endpoint telemetry and compliance (IT-F-007, 008, 012) ------------
  r.add('POST', '/api/v1/telemetry/manifest', ({ body, actor }) => ({ body: compliance.ingestManifest(body, actor) }), { auth: 'agent', bodyLimit: MANIFEST_BODY_LIMIT });
  r.add('GET', '/api/v1/compliance/blacklist', () => ({ body: compliance.listBlacklist() }), { perm: 'compliance:read' });
  r.add('POST', '/api/v1/compliance/blacklist', ({ body, actor }) => ({ status: 201, body: compliance.addToBlacklist(body, actor) }), { perm: 'compliance:manage' });
  r.add('GET', '/api/v1/compliance/incidents', ({ query }) => ({ body: compliance.listIncidents({ status: enumQuery(query, 'status', ['OPEN', 'RESOLVED']) }) }), { perm: 'compliance:read' });
  r.add('POST', '/api/v1/compliance/incidents/:id/resolve', ({ params, body, actor }) => ({ body: compliance.resolveIncident(params.id, body, actor) }), { perm: 'compliance:manage' });
  r.add('GET', '/api/v1/compliance/reconciliation', () => ({ body: compliance.computeReconciliation() }), { perm: 'compliance:read' });
  r.add('POST', '/api/v1/compliance/reconcile', ({ actor }) => ({ body: compliance.reconcile(actor) }), { perm: 'compliance:manage' });
  r.add('GET', '/api/v1/compliance/report', ({ query, actor }) => {
    const format = enumQuery(query, 'format', ['json', 'csv']) || 'json';
    const report = reports.buildComplianceReport(actor);
    if (format === 'csv') {
      return {
        raw: reports.toCsv(report),
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': `attachment; filename="compliance-report-${report.generatedAt.slice(0, 10)}.csv"`,
          'X-Report-SHA256': report.contentSha256
        }
      };
    }
    return { body: report };
  }, { perm: 'compliance:read' });

  // --- Alerts and notifications (IT-F-012, 013) ---------------------------
  r.add('POST', '/api/v1/alerts/expiry/run', ({ body, actor }) => {
    const asOf = body && body.asOf !== undefined ? dateQuery(new URLSearchParams({ asOf: String(body.asOf) }), 'asOf') : undefined;
    return { body: alerts.runExpiryCheck(asOf, actor) };
  }, { perm: 'alerts:run', bodyLimit: 1024 });
  r.add('GET', '/api/v1/notifications', ({ query }) => ({
    body: notifications.list({ type: query.get('type') || undefined, limit: intQuery(query, 'limit', { min: 1, max: 500, defaultValue: 100 }) })
  }), { perm: 'notifications:read' });

  // --- Procurement (IT-F-009, 010, 011) -----------------------------------
  r.add('POST', '/api/v1/procurement/requisitions', ({ body, actor }) => ({ status: 201, body: procurement.createRequisition(body, actor) }), { perm: 'procurement:request' });
  r.add('GET', '/api/v1/procurement/requisitions', ({ query, actor }) => ({
    body: procurement.listRequisitions(actor, { state: enumQuery(query, 'state', Object.values(STATE)) })
  }), { perm: 'dashboard:read' });
  r.add('GET', '/api/v1/procurement/requisitions/:id', ({ params, actor }) => ({ body: procurement.getRequisition(params.id, actor) }), { perm: 'dashboard:read' });
  r.add('POST', '/api/v1/procurement/requisitions/:id/approve', ({ params, body, actor }) => ({ body: procurement.approve(params.id, body, actor) }), { perm: 'procurement:approve' });
  r.add('POST', '/api/v1/procurement/requisitions/:id/reject', ({ params, body, actor }) => ({ body: procurement.reject(params.id, body, actor) }), { perm: 'procurement:approve' });
  r.add('POST', '/api/v1/procurement/requisitions/:id/purchase-order', ({ params, body, actor }) => ({
    status: 201,
    body: procurement.issuePurchaseOrder(params.id, body, actor)
  }), { perm: 'procurement:order' });
  r.add('GET', '/api/v1/procurement/purchase-orders', () => ({ body: procurement.listPurchaseOrders() }), { perm: 'procurement:read-all' });
  r.add('GET', '/api/v1/procurement/purchase-orders/:id', ({ params }) => ({ body: procurement.getPurchaseOrder(params.id) }), { perm: 'procurement:read-all' });
  r.add('POST', '/api/v1/procurement/purchase-orders/:id/deliver', ({ params, body, actor }) => ({ body: procurement.receiveDelivery(params.id, body, actor) }), { perm: 'procurement:receive' });

  // --- Audit trail (IT-NF-004) and administration -------------------------
  r.add('GET', '/api/v1/audit', ({ query }) => ({
    body: audit.list({
      limit: intQuery(query, 'limit', { min: 1, max: 1000, defaultValue: 100 }),
      entityId: query.get('entityId') || undefined,
      action: query.get('action') || undefined
    })
  }), { perm: 'audit:read' });
  r.add('GET', '/api/v1/audit/verify', () => ({ body: audit.verify() }), { perm: 'audit:read' });
  r.add('GET', '/api/v1/admin/users', () => ({ body: users.listUsers() }), { perm: 'admin:users' });

  return r;
}

/** Throws 403 unless the role holds the route's permission. */
function authorize(route, user) {
  if (route.options.perm && !can(user.role, route.options.perm)) {
    throw forbidden(`Role ${user.role} is not allowed to access this resource`);
  }
}

module.exports = { buildRoutes, authorize };
