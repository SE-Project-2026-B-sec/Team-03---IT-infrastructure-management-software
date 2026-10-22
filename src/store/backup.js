'use strict';

/* eslint-disable security/detect-non-literal-fs-filename --
   File paths come from operator configuration (DATA_FILE, BACKUP_DIR, CLI
   arguments), never from HTTP request data. */

const fs = require('node:fs');
const path = require('node:path');
const { createVault } = require('../security/vault');
const { sha256 } = require('../lib/util');

/**
 * Creates an encrypted backup of a data snapshot (IT-NF-006). The file holds
 * the AES-256-GCM ciphertext plus a SHA-256 checksum of the plaintext so a
 * restore can prove the data is intact.
 */
function createBackup(dataFile, backupDir, secret, now = new Date()) {
  if (!fs.existsSync(dataFile)) throw new Error(`Data file not found: ${dataFile}`);
  const plaintext = fs.readFileSync(dataFile, 'utf8');
  JSON.parse(plaintext);
  const vault = createVault(secret);
  const backup = {
    format: 'itim-backup',
    version: 1,
    createdAt: now.toISOString(),
    sha256: sha256(plaintext),
    ciphertext: vault.encrypt(plaintext)
  };
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `itim-backup-${stamp}.json`);
  fs.writeFileSync(target, JSON.stringify(backup), { mode: 0o600 });
  return { file: target, sha256: backup.sha256, bytes: Buffer.byteLength(plaintext) };
}

/** Decrypts and verifies a backup, then atomically replaces the data file. */
function restoreBackup(backupFile, dataFile, secret) {
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  if (backup.format !== 'itim-backup' || backup.version !== 1) throw new Error('Not an ITIM backup file');
  const plaintext = createVault(secret).decrypt(backup.ciphertext);
  if (sha256(plaintext) !== backup.sha256) throw new Error('Backup checksum mismatch: data is corrupt');
  JSON.parse(plaintext);
  fs.mkdirSync(path.dirname(path.resolve(dataFile)), { recursive: true });
  const tmp = `${dataFile}.restore.tmp`;
  fs.writeFileSync(tmp, plaintext, { mode: 0o600 });
  fs.renameSync(tmp, dataFile);
  return { file: dataFile, sha256: backup.sha256, createdAt: backup.createdAt };
}

module.exports = { createBackup, restoreBackup };
