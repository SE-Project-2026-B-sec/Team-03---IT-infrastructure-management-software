'use strict';

const { badRequest, payloadTooLarge, unsupportedMediaType } = require('../lib/errors');

/**
 * Reads a JSON request body with a size limit (PRJ-SR-004). An empty body is
 * returned as {}; a non-empty body must be declared as application/json.
 */
function readJsonBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limitBytes) {
      reject(payloadTooLarge(`Request body exceeds ${limitBytes} bytes`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        reject(payloadTooLarge(`Request body exceeds ${limitBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => {
      if (!failed) reject(err);
    });
    req.on('end', () => {
      if (failed) return;
      if (size === 0) {
        resolve({});
        return;
      }
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        reject(unsupportedMediaType());
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(badRequest('Malformed JSON body'));
      }
    });
  });
}

module.exports = { readJsonBody };
