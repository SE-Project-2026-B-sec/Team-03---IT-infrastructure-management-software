'use strict';

// Restores a backup created by scripts/backup.js after verifying its checksum.
// Stop the server first. Usage:
//   DATA_FILE=data/itim.json BACKUP_SECRET=... node scripts/restore.js backups/itim-backup-....json

const { restoreBackup } = require('../src/store/backup');

const backupFile = process.argv[2];
const dataFile = process.env.DATA_FILE;
const secret = process.env.BACKUP_SECRET;

if (!backupFile || !dataFile || !secret) {
  process.stderr.write('Usage: DATA_FILE=... BACKUP_SECRET=... node scripts/restore.js <backup-file>\n');
  process.exit(2);
}

try {
  const started = Date.now();
  const result = restoreBackup(backupFile, dataFile, secret);
  process.stdout.write(`Restored backup from ${result.createdAt} into ${result.file} in ${Date.now() - started} ms (sha256 ${result.sha256})\n`);
} catch (err) {
  process.stderr.write(`Restore failed: ${err.message}\n`);
  process.exit(1);
}
