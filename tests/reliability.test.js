'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer } = require('./helpers');
const { createBackup, restoreBackup } = require('../src/store/backup');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLine(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}: ${buffer}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const line = buffer.split('\n').find((l) => pattern.test(l));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      }
    });
  });
}

test('TC-REL-01 exposes health probes, isolates handler failures and shuts down gracefully', async () => {
  let release;
  const s = await startServer({
    configureRouter(router) {
      router.add('GET', '/api/v1/test/crash', () => {
        throw new TypeError('simulated defect with secret detail');
      }, { auth: 'public' });
      router.add('GET', '/api/v1/test/slow', () => new Promise((resolve) => {
        release = () => resolve({ body: { finished: true } });
      }), { auth: 'public' });
    }
  });
  try {
    const live = await s.request('GET', '/health/live');
    const ready = await s.request('GET', '/health/ready');
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, 'READY');
    assert.ok(live.ms < 100 && ready.ms < 100, `probes answered in ${live.ms.toFixed(1)} / ${ready.ms.toFixed(1)} ms`);

    const crash = await s.request('GET', '/api/v1/test/crash');
    assert.equal(crash.status, 500);
    assert.equal(crash.body.title, 'Internal Server Error');
    assert.ok(!crash.text.includes('secret detail') && !crash.text.includes('at '), 'no internals leak to the client');
    assert.equal((await s.request('GET', '/health/live')).status, 200, 'server keeps serving after a handler fault');

    // In-flight requests complete during graceful shutdown.
    const inFlight = s.request('GET', '/api/v1/test/slow');
    await sleep(50);
    const stopping = s.stop();
    await sleep(50);
    release();
    const result = await inFlight;
    await stopping;
    assert.equal(result.status, 200);
    assert.equal(result.body.finished, true);
  } finally {
    await s.stop();
  }
});

test('TC-REL-01 the server process exits cleanly on SIGTERM and persists its data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itim-rel-'));
  const dataFile = path.join(dir, 'data.json');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_FILE: dataFile, LOG_LEVEL: 'info', SCHEDULE_JOBS: 'false', JWT_SECRET: 'a'.repeat(40), LICENSE_KEY_SECRET: 'b'.repeat(40), AGENT_API_KEY: 'c'.repeat(40) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const started = await waitForLine(child, /"msg":"IT Infrastructure Management Software started"/, 15000);
    const res = await fetch(`http://127.0.0.1:${started.port}/health/ready`);
    assert.equal(res.status, 200);
    const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
    const t0 = Date.now();
    child.kill('SIGTERM');
    const { code } = await exited;
    assert.equal(code, 0, 'exit code 0 after SIGTERM');
    assert.ok(Date.now() - t0 < 5000, 'shutdown completes within 5 seconds');
    const persisted = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(persisted.users.length, 9, 'state was flushed to disk on shutdown');
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TC-DR-01 recovers from a crash and restores an encrypted backup within the RTO', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itim-dr-'));
  const dataFile = path.join(dir, 'itim.json');
  const backupDir = path.join(dir, 'backups');
  const secret = 'backup-secret-for-tests-0123456789';
  const servers = [];
  const start = async (overrides) => {
    const server = await startServer(overrides);
    servers.push(server);
    return server;
  };
  try {
    // 1. Write data, wait past the persistence interval, then "crash" without a clean shutdown.
    const first = await start({ dataFile, persistDelayMs: 50 });
    const asset = await first.createAsset({ assetTag: 'HW-DR-0001' });
    const license = await first.createLicense({ softwareName: 'DR License', totalSeats: 3, licenseKey: 'DRDR-1111-2222-3333' });
    await sleep(300);
    first.app.store.flushSync = () => {};
    first.app.server.closeAllConnections();
    await new Promise((r) => first.app.server.close(r));

    // 2. RPO: a new instance sees every acknowledged write older than the persistence interval.
    const second = await start({ dataFile });
    assert.equal((await second.as('itadmin', 'GET', `/api/v1/assets/${asset.id}`)).body.assetTag, 'HW-DR-0001');
    await second.stop();

    // 3. Backup, lose the data file, restore, and measure recovery time.
    const backup = createBackup(dataFile, backupDir, secret);
    assert.ok(!fs.readFileSync(backup.file, 'utf8').includes('HW-DR-0001'), 'backup content is encrypted');
    fs.rmSync(dataFile);
    const t0 = Date.now();
    restoreBackup(backup.file, dataFile, secret);
    const third = await start({ dataFile });
    const rtoMs = Date.now() - t0;
    assert.equal((await third.as('itadmin', 'GET', '/api/v1/assets/by-tag/HW-DR-0001')).status, 200);
    const key = await third.as('superadmin', 'GET', `/api/v1/licenses/${license.id}/key`);
    assert.equal(key.body.licenseKey, 'DRDR-1111-2222-3333', 'encrypted keys survive restore');
    assert.equal((await third.as('auditor', 'GET', '/api/v1/audit/verify')).body.valid, true, 'audit chain intact after restore');
    assert.ok(rtoMs < 2 * 60 * 60 * 1000, `restored and serving in ${rtoMs} ms`);
    await third.stop();

    // 4. Corrupt or wrongly keyed backups are refused rather than silently restored.
    const tampered = JSON.parse(fs.readFileSync(backup.file, 'utf8'));
    tampered.sha256 = '0'.repeat(64);
    const tamperedFile = path.join(dir, 'tampered.json');
    fs.writeFileSync(tamperedFile, JSON.stringify(tampered));
    assert.throws(() => restoreBackup(tamperedFile, path.join(dir, 'x.json'), secret), /checksum mismatch/);
    assert.throws(() => restoreBackup(backup.file, path.join(dir, 'y.json'), 'wrong-secret'));
  } finally {
    await Promise.all(servers.map((server) => server.stop()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
