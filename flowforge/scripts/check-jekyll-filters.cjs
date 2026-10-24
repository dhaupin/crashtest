// check-jekyll-filters.cjs - the two-argument Liquid filter trap (crashtest#23).
//
// Liquid string filters like `remove`, `remove_first`, `append`, `prepend`,
// `split`, and `join` take exactly ONE argument. A second argument is not a
// write-time error - it throws "wrong number of arguments (given 3, expected
// 2)" at BUILD time and kills the whole Jekyll build (found live in
// packstruct's CI on 2026-10-24: `| remove: '/x', ''` took down the docs
// deploy). This pass refuses such a call in docs/ source so the failure is
// named in lint:docs with a file:line, instead of in Jekyll's stack trace.
//
// Why not a regex in check-docs-style: that script enforces PROSE rules; this
// is a structural template check, so it lives in its own pass in the chain.
// Two-arg filters that are LEGAL in Liquid (replace / split on regex covers
// one arg only) are simply not in the refuse list.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const SKIP_DIRS = new Set(['_site', 'node_modules', 'vendor', '.bundle', '.jekyll-cache']);
const EXTS = new Set(['.html', '.md', '.yml', '.txt']);

// Single-argument Liquid string filters (a second argument is always a bug).
const SINGLE_ARG = ['remove_first', 'remove', 'append', 'prepend', 'newline_to_br'];

const violations = [];

// Root is overridable for testing: `node scripts/check-jekyll-filters.cjs <dir>`.
// CI/lint:docs call it with no argument and get the repo's docs/.
const scanRoot = process.argv[2] ? path.resolve(process.argv[2]) : DOCS;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }
    if (!EXTS.has(path.extname(entry.name))) continue;
    const file = path.relative(scanRoot, path.join(dir, entry.name));
    const lines = fs.readFileSync(path.join(dir, entry.name), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const filter of SINGLE_ARG) {
        // {{ x | remove: 'a', '' }} - one quoted arg, a comma, then a second one.
        // (single/single quotes both accepted; the second argument is the crime)
        const re = new RegExp("\\|[ ]*-?[ ]*" + filter + "\\s*:\\s*(?:'([^']*)'|\"([^\"]*)\")\\s*,");
        const m = re.exec(line);
        if (m) violations.push(`${file}:${i + 1} Liquid "${filter}" takes exactly one argument (the two-arg form kills the Jekyll build - crashtest#23): \`${line.trim()}\``);
      }
    });
  }
}

if (!fs.existsSync(scanRoot)) process.exit(0);
walk(scanRoot);

if (violations.length > 0) {
  console.error(`JEKYLL FILTERS: FAIL (${violations.length} two-argument single-arg filter call(s))`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('JEKYLL FILTERS: PASS (single-arg string filters only)');
