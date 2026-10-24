#!/usr/bin/env node
/**
 * Docs frontmatter gate (ported from vant's scripts/check-docs-frontmatter.js,
 * adapted to crashtest's rules).
 *
 * Checks every markdown page under docs/:
 * - all 4 required fields present and non-empty: permalink, layout, title,
 *   description (vant's 5-field rule carries `version` + `nav_order`; here
 *   the sidebar is docs/_data/nav.yml-driven - nav_order is deliberately
 *   NOT used, and `version:` is optional, not required)
 * - permalink is baseurl-relative (plain path, no leading /) - the site
 *   composes it as /crashtest/<permalink>; a leading slash (or a baked-in
 *   /crashtest) is how the doubled-prefix fiction starts
 *
 * Exit 1 on any violation, evidence inline.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const REQUIRED = ['permalink', 'layout', 'title', 'description'];
const problems = [];
let pages = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + '/' + f.name;
    if (f.isDirectory() && f.name !== '_data' && f.name !== '_layouts' && f.name !== '_freestruct') walk(p);
    else if (f.name.endsWith('.md')) {
      pages++;
      const rel = path.relative(ROOT, p);
      const text = fs.readFileSync(p, 'utf8');
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) { problems.push(`${rel}: no frontmatter block`); continue; }
      const block = fm[1];
      for (const field of REQUIRED) {
        const m = block.match(new RegExp(`^${field}:\\s*(.*\\S)`, 'm'));
        if (!m) { problems.push(`${rel}: missing frontmatter field "${field}"`); continue; }
        const val = m[1].trim();
        if (!val || val === '""' || val === "''") {
          problems.push(`${rel}: frontmatter field "${field}" is empty`);
          continue;
        }
        if (field === 'permalink' && val !== '/' && (val.startsWith('/') || val.includes('crashtest'))) {
          problems.push(`${rel}: permalink "${val}" should be baseurl-relative (plain path; the site composes /crashtest/<permalink>; "/" is reserved for the docs home)`);
        }
      }
    }
  }
})(DOCS);
if (problems.length) {
  console.error(`FRONTMATTER: FAIL (${problems.length} issue${problems.length === 1 ? '' : 's'} in ${pages} pages)`);
  for (const p of problems) console.error(' ' + p);
  process.exit(1);
}
console.log(`FRONTMATTER: PASS (${pages} pages, all ${REQUIRED.length} fields + format checks)`);
