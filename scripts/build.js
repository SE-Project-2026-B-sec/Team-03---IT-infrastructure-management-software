'use strict';

/* eslint-disable security/detect-non-literal-fs-filename -- Paths are derived from the repository root and a fixed list of build inputs. */

// Assembles the deployable release in dist/ with a BUILD_INFO.json manifest
// listing a SHA-256 checksum for every packaged file.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const INCLUDE = ['src', 'public', 'scripts', 'docs', 'package.json', 'package-lock.json', 'README.md'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
for (const item of INCLUDE) {
  const source = path.join(root, item);
  if (!fs.existsSync(source)) throw new Error(`Build input missing: ${item}`);
  fs.cpSync(source, path.join(dist, item), { recursive: true });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const files = {};
for (const file of walk(dist).sort()) {
  files[path.relative(dist, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
const info = {
  name: pkg.name,
  version: pkg.version,
  commit: process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString(),
  node: process.version,
  fileCount: Object.keys(files).length,
  files
};
fs.writeFileSync(path.join(dist, 'BUILD_INFO.json'), `${JSON.stringify(info, null, 2)}\n`);
process.stdout.write(`Built ${pkg.name}@${pkg.version} into dist/ (${info.fileCount} files)\n`);
