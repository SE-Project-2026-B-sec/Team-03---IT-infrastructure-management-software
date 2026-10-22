'use strict';

const crypto = require('node:crypto');
const { sha256, canonicalJson } = require('../lib/util');
const { STATUS } = require('./hardware');

/** Escapes a CSV cell and neutralises spreadsheet formula injection. */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One-click compliance and audit report in JSON or CSV (IT-F-014). */
function createReportService({ store, audit, config, services }) {
  function buildComplianceReport(actor) {
    const reconciliation = services.compliance.computeReconciliation();
    const assets = store.all('assets');
    const licenses = store.all('licenses');
    const byStatus = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
    for (const a of assets) byStatus[a.status] += 1;
    const totalSeats = licenses.reduce((n, l) => n + l.totalSeats, 0);
    const allocatedSeats = licenses.reduce((n, l) => n + l.usedSeats, 0);
    const openIncidents = services.compliance.listIncidents({ status: 'OPEN' });

    const report = {
      reportId: crypto.randomUUID(),
      reportType: 'SOFTWARE_LICENSE_COMPLIANCE_AND_AUDIT',
      generatedAt: new Date(config.now()).toISOString(),
      generatedBy: actor.username,
      summary: {
        totalAssets: assets.length,
        assetsByStatus: byStatus,
        licensePools: licenses.length,
        totalSeats,
        allocatedSeats,
        unallocatedSeats: totalSeats - allocatedSeats,
        complianceRate: reconciliation.complianceRate,
        totalDeficit: reconciliation.totalDeficit,
        openSecurityIncidents: openIncidents.length
      },
      licenses: reconciliation.results.map(({ licenseIds, normalizedName, ...r }) => r),
      unlicensedSoftware: reconciliation.unlicensedSoftware,
      openSecurityIncidents: openIncidents.map((i) => ({
        assetTag: i.assetTag,
        softwareName: i.softwareName,
        severity: i.severity,
        detectedAt: i.detectedAt
      })),
      decommissionedAssets: assets
        .filter((a) => a.status === STATUS.DECOMMISSIONED)
        .map((a) => ({
          assetTag: a.assetTag,
          serialNumber: a.serialNumber,
          sanitizationMethod: a.decommission.sanitizationMethod,
          certificateId: a.decommission.certificateId,
          decommissionedAt: a.decommission.decommissionedAt
        })),
      auditTrail: audit.verify()
    };
    report.contentSha256 = sha256(canonicalJson(report));
    audit.append({ actor, action: 'REPORT_GENERATED', entityType: 'Report', entityId: report.reportId, details: { sha256: report.contentSha256 } });
    return report;
  }

  function toCsv(report) {
    const header = ['softwareName', 'purchasedSeats', 'allocatedSeats', 'installedCount', 'unallocatedInstalls', 'deficit', 'status'];
    const rows = report.licenses.map((r) => header.map((h) => csvCell(r[h])).join(','));
    return `${[header.join(','), ...rows].join('\r\n')}\r\n`;
  }

  return { buildComplianceReport, toCsv };
}

module.exports = { createReportService, csvCell };
