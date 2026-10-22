'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { send } = require('./respond');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

/**
 * Serves the dashboard from public/. Paths are resolved and must stay inside
 * the public directory, which blocks "../" traversal.
 */
function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  const type = TYPES[path.extname(file)];
  // `file` is resolved and confined to PUBLIC_DIR by the check above.
  /* eslint-disable security/detect-non-literal-fs-filename */
  if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  send(res, 200, fs.readFileSync(file), type, { 'Cache-Control': 'no-cache' });
  /* eslint-enable security/detect-non-literal-fs-filename */
  return true;
}

module.exports = { serveStatic, PUBLIC_DIR };
