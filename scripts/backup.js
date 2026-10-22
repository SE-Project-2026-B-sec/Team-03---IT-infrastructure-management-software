'use strict';

// Creates an encrypted, checksummed backup of the data file (IT-NF-006).
// Usage: DATA_FILE=data/itim.json BACKUP_DIR=backups BACKUP_SECRET=... node scripts/backup.js

const { createBackup } = require('../src/store/backup');

const dataFile = process.env.DATA_FILE;
const backupDir = process.env.BACKUP_DIR;
const secret = process.env.BACKUP_SECRET;

if (!dataFile || !backupDir || !secret) {
  process.stderr.write('DATA_FILE, BACKUP_DIR and BACKUP_SECRET must be set\n');
  process.exit(2);
}

try {
  const result = createBackup(dataFile, backupDir, secret);
  process.stdout.write(`Backup written to ${result.file} (${result.bytes} bytes, sha256 ${result.sha256})\n`);
} catch (err) {
  process.stderr.write(`Backup failed: ${err.message}\n`);
  process.exit(1);
}
