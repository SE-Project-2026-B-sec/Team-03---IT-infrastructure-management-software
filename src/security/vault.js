'use strict';

const crypto = require('node:crypto');

const VERSION = 'v1';

/**
 * AES-256-GCM encryption for secrets at rest (license product keys, backups).
 * The 256-bit key is derived from the configured secret with SHA-256.
 */
function createVault(secret) {
  if (!secret) throw new Error('Vault secret is required');
  const key = crypto.createHash('sha256').update(String(secret)).digest();

  return {
    encrypt(plaintext) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
    },
    decrypt(blob) {
      const [version, iv, tag, data] = String(blob).split(':');
      if (version !== VERSION || !iv || !tag || !data) throw new Error('Unsupported ciphertext format');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    }
  };
}

/** Masks a product key so only its last four characters remain visible (PRJ-SR-003). */
function maskKey(key) {
  if (!key) return null;
  const clean = String(key).replace(/[^A-Za-z0-9]/g, '');
  if (clean.length <= 4) return '****';
  return `XXXX-XXXX-XXXX-${clean.slice(-4)}`;
}

module.exports = { createVault, maskKey };
