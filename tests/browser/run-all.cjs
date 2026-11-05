// Runs every browser test in turn and prints a summary.
// A test fails if it crashes, prints "FAIL", or reports page errors.
// The tests print measurements; tests/browser/README.md lists what each
// should show.
//   node tests/browser/run-all.cjs            all tests
//   node tests/browser/run-all.cjs band mic   only files whose name contains a word
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.cjs') && !['helpers.cjs', 'run-all.cjs'].includes(f))
  .filter(f => !filters.length || filters.some(w => f.includes(w)))
  .sort((a, b) => (a === 'regression.cjs' ? -1 : b === 'regression.cjs' ? 1 : a.localeCompare(b)));

const results = [];
for (const f of files) {
  process.stdout.write(`\n=== ${f}\n`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  const pageErrors = /ERRORS:?\s*\[\s*[^\]\s]/.test(out);
  const ok = r.status === 0 && !/\bFAIL\b/.test(out) && !pageErrors;
  results.push({ f, ok });
}
console.log('\n=== Summary');
for (const { f, ok } of results) console.log(`${ok ? 'ok  ' : 'FAIL'}  ${f}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
