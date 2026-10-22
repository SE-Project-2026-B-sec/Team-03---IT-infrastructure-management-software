'use strict';

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** JSON.stringify with recursively sorted object keys, for stable hashing. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Midnight UTC of a YYYY-MM-DD string, in ms. */
const dateToMs = (date) => Date.parse(`${date}T00:00:00Z`);

/** Normalises a software name for matching: lower case, single spaces, no ".exe". */
function normalizeSoftwareName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (n, width) => String(n).padStart(width, '0');

module.exports = {
  DAY_MS,
  round2,
  sha256,
  canonicalJson,
  deepFreeze,
  isoDate,
  dateToMs,
  normalizeSoftwareName,
  pad
};
