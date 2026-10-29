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
// Second rule, same class (a source-level Liquid construct that only fails at
// BUILD time): an UNKNOWN tag. `{% seo %}` written in prose killed the docs
// build on 2026-10-29 ("Unknown tag 'seo' in packs.md") because the docs
// deliberately ship no theme gem and no jekyll-seo-tag plugin - backticks are
// markdown, not Liquid escaping, so the tag still parsed. Any tag outside the
// Jekyll 4.x set refuses here; wrap literal ones in {% raw %}.
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

// The Jekyll 4.x tag set (liquid + jekyll core + the end/else companions).
const KNOWN_TAGS = new Set([
  'assign', 'break', 'capture', 'case', 'comment', 'continue', 'cycle',
  'decrement', 'echo', 'else', 'elsif', 'endcapture', 'endcase', 'endcomment',
  'endfor', 'endif', 'endraw', 'endtablerow', 'endunless', 'for', 'if',
  'ifchanged', 'include', 'include_relative', 'increment', 'layout', 'link',
  'liquid', 'post_url', 'raw', 'render', 'tablerow', 'unless', 'when',
]);

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
    const source = fs.readFileSync(path.join(dir, entry.name), 'utf8');
    // Blank out {% raw %}...{% endraw %} regions (content is literal, not
    // Liquid) while keeping line count so file:line stays honest.
    const RAW_PAIR = /(\{%-?\s*raw\s*-?%\})([\s\S]*?)(\{%-?\s*endraw\s*-?%\})/g;
    const blank = (s) => s.replace(/[^\n]/g, ' ');
    const stripped = source.replace(RAW_PAIR, (m, open, body, close) => open + blank(body) + close);
    const lines = stripped.split('\n');
    lines.forEach((line, i) => {
      for (const filter of SINGLE_ARG) {
        // {{ x | remove: 'a', '' }} - one quoted arg, a comma, then a second one.
        // (single/single quotes both accepted; the second argument is the crime)
        const re = new RegExp("\\|[ ]*-?[ ]*" + filter + "\\s*:\\s*(?:'([^']*)'|\"([^\"]*)\")\\s*,");
        const m = re.exec(line);
        if (m) violations.push(`${file}:${i + 1} Liquid "${filter}" takes exactly one argument (the two-arg form kills the Jekyll build - crashtest#23): \`${line.trim()}\``);
      }
      // An unknown tag ({% seo %} in prose) is the same build-time class.
      const tagRe = /\{%-?\s*([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let t;
      while ((t = tagRe.exec(line)) !== null) {
        if (!KNOWN_TAGS.has(t[1])) {
          violations.push(`${file}:${i + 1} unknown Liquid tag "${t[1]}" (no theme gem / plugin defines it, so the Jekyll build dies - wrap literal text in {% raw %}): \`${line.trim()}\``);
        }
      }
    });
  }
}

if (!fs.existsSync(scanRoot)) process.exit(0);
walk(scanRoot);

if (violations.length > 0) {
  console.error(`JEKYLL FILTERS: FAIL (${violations.length} build-time Liquid construct(s))`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('JEKYLL FILTERS: PASS (single-arg string filters only, known tags only)');
