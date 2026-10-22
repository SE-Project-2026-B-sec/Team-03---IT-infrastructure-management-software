'use strict';

// Starts an in-memory demo instance filled with realistic data:  npm run demo
// Everything is created through the real services (so every audit entry and
// validation rule applies) while a virtual clock steps forward through the
// past 14 months, giving records natural dates.

const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/security/passwords');

const DAY = 24 * 60 * 60 * 1000;

const PEOPLE = [
  ['Aarav Mehta', 'Engineering'], ['Diya Sharma', 'Design'], ['Kabir Rao', 'Engineering'], ['Ananya Iyer', 'Finance'],
  ['Rohan Gupta', 'Sales'], ['Meera Nair', 'Design'], ['Vikram Singh', 'Operations'], ['Isha Kapoor', 'Marketing'],
  ['Arjun Reddy', 'Engineering'], ['Sara Thomas', 'People']
];

// model, manufacturer, category, unit cost, quantity, warranty years, serial prefix
const FLEET = [
  ['Latitude 7440', 'Dell', 'LAPTOP', 1649, 7, 3, 'DL'],
  ['MacBook Pro 14 (M3)', 'Apple', 'LAPTOP', 1999, 6, 1, 'C02'],
  ['ThinkPad X1 Carbon Gen 11', 'Lenovo', 'LAPTOP', 1789, 5, 3, 'PF'],
  ['EliteBook 840 G10', 'HP', 'LAPTOP', 1399, 3, 3, '5CG'],
  ['OptiPlex 7010', 'Dell', 'DESKTOP', 949, 4, 3, 'DT'],
  ['PowerEdge R750', 'Dell', 'SERVER', 8900, 2, 5, 'SV'],
  ['ProLiant DL380 Gen11', 'HPE', 'SERVER', 9650, 1, 5, 'CZ'],
  ['Catalyst 9300-48P', 'Cisco', 'NETWORK', 6120, 2, 5, 'FOC'],
  ['FortiGate 100F', 'Fortinet', 'NETWORK', 2890, 1, 3, 'FG'],
  ['UltraSharp U2723QE', 'Dell', 'PERIPHERAL', 579, 4, 3, 'CN'],
  ['iPhone 15', 'Apple', 'MOBILE', 799, 3, 1, 'F2L'],
  ['Galaxy S24', 'Samsung', 'MOBILE', 859, 2, 1, 'R5C']
];

function seedDemo(app, clock) {
  const { store, services } = app;
  const { hardware, licenses, compliance, procurement, alerts } = services;
  const real = Date.now();
  const at = (daysAgo) => {
    clock.now = real - daysAgo * DAY;
  };
  const date = (daysFromNow) => new Date(real + daysFromNow * DAY).toISOString().slice(0, 10);
  const actor = (username) => {
    const u = store.findBy('users', 'username', username);
    return { id: u.id, username: u.username, role: u.role, employeeId: u.employeeId, ip: '127.0.0.1' };
  };
  const agent = { id: null, username: 'endpoint-agent', role: 'AGENT', ip: '10.0.8.21' };

  // --- People (directory only; their passwords are random and unknown) ------
  at(430);
  PEOPLE.forEach(([fullName, department], i) => {
    const username = fullName.toLowerCase().replace(/\s+/g, '.');
    store.insert('users', {
      id: crypto.randomUUID(),
      username,
      role: 'EMPLOYEE',
      employeeId: `EMP-${String(110 + i).padStart(4, '0')}`,
      fullName,
      department,
      email: `${username}@itim.local`,
      active: true,
      passwordHash: hashPassword(crypto.randomBytes(24).toString('hex')),
      createdAt: new Date(clock.now).toISOString()
    });
  });
  const admin = actor('itadmin');
  const tech = actor('technician');
  const staff = store.all('users').filter((u) => u.role === 'EMPLOYEE' || u.role === 'MANAGER');

  // --- Licenses ------------------------------------------------------------
  const L = {};
  const pool = (key, body) => {
    L[key] = licenses.createLicense(body, admin);
  };
  pool('m365', { softwareName: 'Microsoft 365 E3', publisher: 'Microsoft', licenseType: 'SUBSCRIPTION', totalSeats: 40, licenseKey: 'M365-E3EN-7731-QX9K', validFrom: date(-320), validUntil: date(245), costPerSeat: 432 });
  pool('slack', { softwareName: 'Slack Business+', publisher: 'Salesforce', licenseType: 'SAAS', totalSeats: 45, validFrom: date(-300), validUntil: date(190), costPerSeat: 150 });
  pool('jetbrains', { softwareName: 'JetBrains All Products', publisher: 'JetBrains', licenseType: 'SUBSCRIPTION', totalSeats: 12, licenseKey: 'JB-ALLP-2026-4F7A-90QD', validFrom: date(-200), validUntil: date(160), costPerSeat: 779 });
  pool('adobe', { softwareName: 'Adobe Creative Cloud', publisher: 'Adobe', licenseType: 'SUBSCRIPTION', totalSeats: 3, licenseKey: 'ADBE-CCAP-5521-ZK3M', validFrom: date(-330), validUntil: date(38), costPerSeat: 1019 });
  pool('autocad', { softwareName: 'AutoCAD 2026', publisher: 'Autodesk', licenseType: 'SUBSCRIPTION', totalSeats: 3, licenseKey: 'ACAD-2026-11XQ-7HTR', validFrom: date(-340), validUntil: date(24), costPerSeat: 2030 });
  pool('zoom', { softwareName: 'Zoom Workplace', publisher: 'Zoom', licenseType: 'SAAS', totalSeats: 30, validFrom: date(-250), validUntil: date(115), costPerSeat: 160 });
  pool('figma', { softwareName: 'Figma Professional', publisher: 'Figma', licenseType: 'SAAS', totalSeats: 8, validFrom: date(-150), validUntil: date(215), costPerSeat: 180 });
  pool('winsrv', { softwareName: 'Windows Server 2022 Datacenter', publisher: 'Microsoft', licenseType: 'PERPETUAL', totalSeats: 4, licenseKey: 'WS22-DCEN-88KP-2MVB-QQ31', costPerSeat: 6155 });
  pool('tableau', { softwareName: 'Tableau Creator', publisher: 'Salesforce', licenseType: 'SUBSCRIPTION', totalSeats: 3, validFrom: date(-375), validUntil: date(-9), costPerSeat: 900 });

  // --- Hardware, registered in three waves over the year --------------------
  const assets = [];
  let serial = 0;
  const waves = [[400, 0.45], [210, 0.75], [75, 1]];
  let index = 0;
  const total = FLEET.reduce((n, f) => n + f[4], 0);
  for (const [daysAgo, upTo] of waves) {
    at(daysAgo);
    while (index < Math.round(total * upTo)) {
      let k = index;
      const spec = FLEET.find((f) => {
        if (k < f[4]) return true;
        k -= f[4];
        return false;
      });
      const [model, manufacturer, category, cost, , warrantyYears, prefix] = spec;
      serial += 1;
      const bought = new Date(clock.now - 6 * DAY).toISOString().slice(0, 10);
      const warranty = new Date(Date.parse(`${bought}T00:00:00Z`) + warrantyYears * 365 * DAY).toISOString().slice(0, 10);
      assets.push(hardware.createAsset({
        serialNumber: `${prefix}${crypto.randomBytes(3).toString('hex').toUpperCase()}${String(serial).padStart(2, '0')}`,
        manufacturer,
        model,
        category,
        purchaseCost: cost,
        purchaseDate: bought,
        warrantyExpiry: warranty,
        location: category === 'SERVER' || category === 'NETWORK' ? 'Data centre, rack B' : 'Bengaluru HQ'
      }, admin));
      index += 1;
    }
  }

  // --- Assignments and seats ----------------------------------------------
  at(60);
  const computers = assets.filter((a) => ['LAPTOP', 'DESKTOP'].includes(a.category));
  const mobiles = assets.filter((a) => a.category === 'MOBILE');
  const assigned = [];
  computers.slice(0, staff.length + 4).forEach((a, i) => {
    const person = staff[i % staff.length];
    if (assigned.some((x) => x.person === person && x.asset.category === a.category)) return;
    hardware.checkOut(a.id, { employeeId: person.employeeId, notes: 'Standard issue' }, tech);
    assigned.push({ asset: a, person });
  });
  mobiles.slice(0, 3).forEach((a, i) => hardware.checkOut(a.id, { employeeId: staff[i].employeeId }, tech));

  const seat = (key, asset) => licenses.allocate(L[key].id, { assetId: asset.id }, tech);
  for (const { asset, person } of assigned) {
    seat('m365', asset);
    seat('slack', asset);
    if (person.department === 'Engineering') seat('jetbrains', asset);
  }
  const creative = assigned.filter(({ person }) => ['Design', 'Marketing'].includes(person.department));
  creative.slice(0, 3).forEach(({ asset }) => seat('adobe', asset));
  creative.forEach(({ asset }) => seat('figma', asset));
  assigned.slice(0, 2).forEach(({ asset }) => seat('autocad', asset));
  assets.filter((a) => a.category === 'SERVER').slice(0, 3).forEach((a) => seat('winsrv', a));

  // --- Maintenance and retirement ------------------------------------------
  at(40);
  const spare = () => assets.find((a) => store.get('assets', a.id).status === 'AVAILABLE' && ['LAPTOP', 'DESKTOP'].includes(a.category));
  const repairA = spare();
  hardware.addMaintenance(repairA.id, { type: 'REPAIR', description: 'Battery swelling, replacing battery pack', technician: 'Tara Technician', vendor: 'Dell ProSupport', cost: 189, outOfService: true }, tech);
  const repairB = spare();
  hardware.addMaintenance(repairB.id, { type: 'REPAIR', description: 'Cracked display after drop', technician: 'Tara Technician', vendor: 'Lenovo Depot', cost: 312, outOfService: true }, tech);
  const upgraded = assigned[1].asset;
  hardware.addMaintenance(upgraded.id, { type: 'UPGRADE', description: 'RAM upgrade from 16 GB to 32 GB', technician: 'Tara Technician', vendor: 'Crucial', cost: 96, partsReplaced: ['32GB DDR5 SODIMM kit'] }, tech);
  const serviced = assets.find((a) => a.category === 'SERVER');
  hardware.addMaintenance(serviced.id, { type: 'PREVENTIVE', description: 'Quarterly firmware and iDRAC update', technician: 'Tara Technician', cost: 0 }, tech);

  at(25);
  for (const [certificateId, method] of [['NIST-WIPE-2026-0141', 'PURGE'], ['NIST-WIPE-2026-0142', 'DESTROY']]) {
    const old = spare();
    hardware.decommission(old.id, { sanitizationMethod: method, certificateId, performedBy: 'SecureShred Ltd', disposalVendor: 'E-Parisaraa Recyclers' }, admin);
  }

  // --- Endpoint scans ---------------------------------------------------------
  at(3);
  const extras = ['Google Chrome', 'VLC media player', 'Notepad++', '7-Zip'];
  assigned.forEach(({ asset, person }, i) => {
    const software = [{ name: 'Microsoft 365 E3' }, { name: 'Slack Business+' }, { name: 'Zoom Workplace' }, { name: extras[i % extras.length] }];
    if (person.department === 'Engineering') software.push({ name: 'JetBrains All Products' });
    if (['Design', 'Marketing', 'Sales'].includes(person.department)) software.push({ name: 'Adobe Creative Cloud' });
    if (i === 4) software.push({ name: 'uTorrent.exe' });
    compliance.ingestManifest({ serialNumber: asset.serialNumber, hostname: `bh-${person.username.split('.')[0]}-${i + 1}`, agentVersion: '1.4.2', installedSoftware: software }, agent);
  });

  // --- Procurement at every stage -------------------------------------------
  const manager = actor('manager');
  const director = actor('director');
  const finance = actor('finance');
  const request = (who, daysAgo, body) => {
    at(daysAgo);
    return procurement.createRequisition(body, actor(who));
  };
  const approve = (pr, who, daysAgo, comment) => {
    at(daysAgo);
    return procurement.approve(pr.id, { comment }, who);
  };

  const monitors = request('employee', 48, { itemType: 'HARDWARE', category: 'PERIPHERAL', itemDescription: 'Dell UltraSharp U2723QE 27" 4K monitor', quantity: 3, estimatedUnitCost: 579, businessJustification: 'Dual-monitor setup for the new data visualisation pod', department: 'Engineering' });
  approve(monitors, manager, 47, 'Within the team budget');
  approve(monitors, director, 46, 'Standard model, approved');
  approve(monitors, finance, 45, 'Budget code ENG-HW-26');
  at(44);
  const monitorPo = procurement.issuePurchaseOrder(monitors.id, { vendorName: 'Dell Technologies', expectedDeliveryDate: date(-35) }, finance);
  at(34);
  procurement.receiveDelivery(monitorPo.id, { serialNumbers: ['CN0X8M4T01', 'CN0X8M4T02', 'CN0X8M4T03'], warrantyExpiry: date(1060), location: 'Bengaluru HQ' }, tech);

  const macbooks = request('employee2', 20, { itemType: 'HARDWARE', category: 'LAPTOP', itemDescription: 'MacBook Pro 14 (M3 Pro, 36 GB)', quantity: 2, estimatedUnitCost: 2399, businessJustification: 'Replacement for two 2021 laptops failing battery health checks', department: 'Engineering' });
  approve(macbooks, manager, 19, 'Replacements are overdue');
  approve(macbooks, director, 18, 'Approved, align with the refresh cycle');
  approve(macbooks, finance, 16, 'Approved');
  at(15);
  procurement.issuePurchaseOrder(macbooks.id, { vendorName: 'Apple India (Business)', expectedDeliveryDate: date(4) }, finance);

  const figma = request('employee', 9, { itemType: 'SOFTWARE_LICENSE', softwareName: 'Figma Professional', itemDescription: 'Figma Professional, 5 additional editor seats', quantity: 5, estimatedUnitCost: 180, businessJustification: 'Two new designers join next month and the pool is nearly full', department: 'Design' });
  approve(figma, manager, 8, 'Needed for onboarding');
  approve(figma, director, 7, 'OK');
  approve(figma, finance, 6, 'Approved from the design tools budget');

  const mice = request('employee2', 6, { itemType: 'HARDWARE', category: 'PERIPHERAL', itemDescription: 'Logitech MX Master 3S mouse', quantity: 10, estimatedUnitCost: 99, businessJustification: 'Ergonomic peripherals recommended by the workplace assessment', department: 'Operations' });
  approve(mice, manager, 5, 'Supported by the ergonomics review');
  approve(mice, director, 4, 'Approved');

  const aps = request('technician', 4, { itemType: 'HARDWARE', category: 'NETWORK', itemDescription: 'Cisco Meraki MR46 Wi-Fi 6 access point', quantity: 4, estimatedUnitCost: 899, businessJustification: 'Coverage gaps on floor 3 reported in the last two network surveys', department: 'IT' });
  approve(aps, manager, 3, 'Survey results attached to the ticket');

  request('employee', 1, { itemType: 'HARDWARE', category: 'LAPTOP', itemDescription: 'ThinkPad X1 Carbon Gen 12', quantity: 1, estimatedUnitCost: 1899, businessJustification: 'Current laptop is out of warranty and below the minimum spec for local builds', department: 'Engineering' });

  const chairs = request('employee2', 12, { itemType: 'HARDWARE', category: 'OTHER', itemDescription: 'Herman Miller Aeron chair', quantity: 6, estimatedUnitCost: 1450, businessJustification: 'Requested by the team after moving to the new floor', department: 'Operations' });
  approve(chairs, manager, 11, 'Forwarding for review');
  at(10);
  procurement.reject(chairs.id, { reason: 'Furniture is outside the IT budget. Please raise this with Facilities.' }, director);

  // --- Alerts as of today -----------------------------------------------------
  clock.now = null;
  compliance.reconcile(admin);
  alerts.runExpiryCheck(undefined, admin);
  return { assets: store.count('assets'), licenses: store.count('licenses'), requisitions: store.count('requisitions') };
}

async function main() {
  const clock = { now: null };
  const app = createApp({ dataFile: null, now: () => clock.now ?? Date.now() });
  const counts = seedDemo(app, clock);
  const { port } = await app.start();
  process.stdout.write(`\nDemo ready: http://localhost:${port}\n`);
  process.stdout.write(`Seeded ${counts.assets} assets, ${counts.licenses} license pools and ${counts.requisitions} requisitions.\n`);
  process.stdout.write(`Sign in as itadmin, manager, finance, auditor or employee with password: ${app.config.demoPassword}\n`);
  process.stdout.write('Data is in memory only and resets when you stop the server (Ctrl+C).\n\n');
  const stop = () => app.stop().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`Demo failed to start: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { seedDemo };
