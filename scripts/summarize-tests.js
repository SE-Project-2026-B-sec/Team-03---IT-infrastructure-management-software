'use strict';

/* eslint-disable security/detect-non-literal-fs-filename -- The TAP file path is a CI argument. */

// Turns the TAP output of `npm run test:ci` into a Markdown summary for the
// GitHub Actions job page. It reports what actually happened, including
// failures, and never claims results that are not in the file.

const fs = require('node:fs');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  process.stdout.write('### Test results\n\nNo TAP results file was produced: the test step did not run to completion.\n');
  process.exit(0);
}

const tap = fs.readFileSync(file, 'utf8');
const totals = Object.fromEntries([...tap.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
const count = (name) => totals[name] || 0;
const results = [...tap.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)].map((m) => ({ ok: m[1] === 'ok', name: m[2] }));
const caseIds = new Map();
for (const r of results) {
  const id = (r.name.match(/^(TC-[A-Z]+-\d{2})/) || [])[1];
  if (id) caseIds.set(id, (caseIds.get(id) ?? true) && r.ok);
}

const lines = [
  `### Test results (Node ${process.version})`,
  '',
  '| Tests | Passed | Failed | Skipped | Test cases passing |',
  '| ---: | ---: | ---: | ---: | ---: |',
  `| ${count('tests')} | ${count('pass')} | ${count('fail')} | ${count('skipped')} | ${[...caseIds.values()].filter(Boolean).length} / ${caseIds.size} |`,
  ''
];
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  lines.push('**Failed tests**', '', ...failed.map((r) => `- ${r.name}`), '');
}
for (const m of tap.matchAll(/^# (requests=.*|latency .*|seeded .*|tag lookup .*)$/gm)) lines.push(`- ${m[1]}`);
process.stdout.write(`${lines.join('\n')}\n`);
