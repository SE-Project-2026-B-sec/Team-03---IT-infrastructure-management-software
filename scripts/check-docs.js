'use strict';

/* eslint-disable security/detect-non-literal-fs-filename -- Paths are derived from the repository root (docs/ and tests/). */

// Documentation integrity check run by CI stage 1. Verifies the template
// thresholds and that requirement, design-spec and test-case IDs trace
// consistently across the SRS, SAD, STP and the automated test suite.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Line endings are normalised so a Windows checkout (CRLF) parses identically.
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const SRS = read('docs/source/SRS_IT_Infrastructure_Management.md');
const SAD = read('docs/source/SAD_IT_Infrastructure_Management.md');
const STP = read('docs/source/Test_Plan_IT_Infrastructure_Management.md');

const problems = [];
const fail = (msg) => problems.push(msg);
const info = (msg) => process.stdout.write(`  ${msg}\n`);

/** Text from a heading line starting with `start` up to the next heading of the same or higher level. */
function section(doc, start) {
  const lines = doc.split('\n');
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) {
    fail(`Missing section "${start}"`);
    return '';
  }
  const level = start.match(/^#+/)[0].length;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i += 1) {
    const m = /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level) {
      to = i;
      break;
    }
  }
  return lines.slice(from, to).join('\n');
}

const tableRows = (text) =>
  text
    .split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*:?-/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/\*\*/g, '').replace(/`/g, '')));

const mermaidBlocks = (text) => [...text.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].trim());

// ---- SRS ------------------------------------------------------------------
const reqIds = [...SRS.matchAll(/^\| \*\*((?:IT-F|IT-NF|PRJ-SR)-\d{3})\*\* \|/gm)].map((m) => m[1]);
const fr = reqIds.filter((id) => id.startsWith('IT-F-'));
const nfr = reqIds.filter((id) => id.startsWith('IT-NF-'));
const sr = reqIds.filter((id) => id.startsWith('PRJ-SR-'));
if (new Set(reqIds).size !== reqIds.length) fail('SRS defines a requirement ID more than once');
if (fr.length < 15) fail(`SRS has ${fr.length} functional requirements (minimum 15)`);
if (nfr.length < 5) fail(`SRS has ${nfr.length} non-functional requirements (minimum 5)`);
if (sr.length < 5) fail(`SRS has ${sr.length} security requirements (minimum 5)`);
const objectives = section(SRS, '#### 5.1.1').split('\n').filter((l) => /^\d+\. /.test(l)).length;
if (objectives < 2 || objectives > 4) fail(`SRS lists ${objectives} security objectives (template asks for 2 to 4)`);
for (const row of tableRows(section(SRS, '## 4.')).filter((r) => /^IT-F-\d{3}$/.test(r[0]))) {
  if (!/AC-IT-F-\d{3}/.test(row[5] || '') || !/TC-[A-Z]+-\d{2}/.test(row[5] || '')) {
    fail(`${row[0]} is missing acceptance criteria or a test case reference`);
  }
}
const useCases = mermaidBlocks(section(SRS, '## 7.'));
if (useCases.length < 2) fail(`SRS section 7 has ${useCases.length} use-case diagrams (minimum 2)`);
info(`SRS: ${fr.length} FRs, ${nfr.length} NFRs, ${sr.length} security requirements, ${objectives} security objectives, ${useCases.length} use-case diagrams`);

// RTM
const rtm = new Map();
for (const row of tableRows(section(SRS, '## 8.'))) {
  if (!/^(IT-F|IT-NF|PRJ-SR)-\d{3}$/.test(row[0])) continue;
  if (rtm.has(row[0])) fail(`RTM lists ${row[0]} twice`);
  rtm.set(row[0], {
    designSpecs: row[2].match(/DS-[A-Z]+-\d{2}/g) || [],
    tests: row[4].match(/TC-[A-Z]+-\d{2}/g) || [],
    status: row[5]
  });
}
for (const id of reqIds) {
  const entry = rtm.get(id);
  if (!entry) fail(`RTM is missing ${id}`);
  else {
    if (!entry.designSpecs.length) fail(`RTM row ${id} has no design spec ID`);
    if (!entry.tests.length) fail(`RTM row ${id} has no test case`);
  }
}
for (const id of rtm.keys()) if (!reqIds.includes(id)) fail(`RTM references undefined requirement ${id}`);
const rtmTests = new Set([...rtm.values()].flatMap((e) => e.tests));
const designSpecs = new Set([...rtm.values()].flatMap((e) => e.designSpecs));

// ---- SAD ------------------------------------------------------------------
const sadDiagrams = mermaidBlocks(SAD);
if (!sadDiagrams.some((d) => d.startsWith('classDiagram'))) fail('SAD has no UML class diagram');
const sequences = sadDiagrams.filter((d) => d.startsWith('sequenceDiagram')).length;
if (sequences < 2) fail(`SAD has ${sequences} sequence diagrams (minimum 2)`);
const stride = section(SAD, '### 3.9');
for (const threat of ['Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege']) {
  if (!stride.includes(threat)) fail(`SAD STRIDE model is missing "${threat}"`);
}
const trace = section(SAD, '### 3.8');
for (const id of reqIds) if (!trace.includes(id)) fail(`SAD 3.8 traceability is missing ${id}`);
for (const ds of designSpecs) if (!trace.includes(ds)) fail(`Design spec ${ds} (from the RTM) is not defined in SAD 3.8`);
const api = section(SAD, '### 4.3');
const jsonBlocks = (api.match(/```json/g) || []).length;
if (jsonBlocks < 4) fail(`SAD 4.3 has ${jsonBlocks} JSON payload examples (expected request and response for at least 2 components)`);
if (!/\b(400|401|403|404|409)\b/.test(api)) fail('SAD 4.3 does not document HTTP error status codes');
info(`SAD: class diagram, ${sequences} sequence diagrams, STRIDE, ${designSpecs.size} design specs traced, ${jsonBlocks} JSON examples`);

// ---- STP ------------------------------------------------------------------
const stpCases = new Map();
for (const row of tableRows(section(STP, '## 13.'))) {
  if (!/^TC-[A-Z]+-\d{2}$/.test(row[0])) continue;
  if (stpCases.has(row[0])) fail(`STP defines ${row[0]} twice`);
  stpCases.set(row[0], row[1].match(/(IT-F|IT-NF|PRJ-SR)-\d{3}/g) || []);
}
for (const id of reqIds) {
  if (![...stpCases.values()].some((reqs) => reqs.includes(id))) fail(`STP section 13 has no test case for ${id}`);
}
for (const [tc, reqs] of stpCases) {
  if (!reqs.length) fail(`STP test case ${tc} references no requirement`);
  for (const id of reqs) {
    if (!reqIds.includes(id)) fail(`STP test case ${tc} references undefined requirement ${id}`);
    if (!rtm.get(id)?.tests.includes(tc)) fail(`STP maps ${tc} to ${id}, but the RTM does not`);
  }
}
for (const tc of rtmTests) if (!stpCases.has(tc)) fail(`RTM test case ${tc} is not defined in STP section 13`);
for (const section5 of ['### 5.1', '### 5.2', '### 5.3']) section(STP, section5);

// ---- Automated tests -------------------------------------------------------
const testDir = path.join(root, 'tests');
const automated = new Set();
for (const file of fs.readdirSync(testDir).filter((f) => f.endsWith('.test.js'))) {
  const src = read(path.join('tests', file));
  for (const m of src.matchAll(/\btest\(\s*['"`](TC-[A-Z]+-\d{2})\b/g)) automated.add(m[1]);
}
for (const tc of stpCases.keys()) if (!automated.has(tc)) fail(`${tc} has no automated test in tests/`);
for (const tc of automated) if (!stpCases.has(tc)) fail(`tests/ uses ${tc}, which is not defined in the STP`);
info(`STP: ${stpCases.size} test cases; ${automated.size} automated in tests/`);

if (problems.length) {
  process.stderr.write(`\nDocumentation integrity check FAILED (${problems.length} problem(s)):\n`);
  for (const p of problems) process.stderr.write(`  - ${p}\n`);
  process.exit(1);
}
process.stdout.write('Documentation integrity check passed.\n');
