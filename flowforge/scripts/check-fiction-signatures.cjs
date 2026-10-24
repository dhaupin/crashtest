#!/usr/bin/env node
/**
 * Fiction-signature gate - the flowforge shell edition (same scanner logic
 * the struct-family repos run; the seed signatures below are GENERIC, and
 * the shell house law is:
 *
 *     seed your own signatures the moment a fiction is caught twice;
 *     anything caught twice becomes a gate, not a memory.
 *
 * A signature is [regex, human explanation]. Exit 1 on any hit outside the
 * allow-list (a debunking line counts - NEGATION below).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// signature: [regex, human explanation]  -- GENERIC seeds; replace/add yours
const SIGNATURES = [
  [/(artificial\s+)?intelligence\s+(will|is\s+going\s+to)\s+(change|revolution)/i,
    'hype claim - describe what the product DOES, not what it would do someday'],
  [/fastest|blazingly|lightning[- ]fast[^.]{0,40}(fastest|ever|world)/i,
    'superlative performance claims need a receipt (benchmark, file:line) or they are fiction'],
  [/100%\s+(secure|safe|guaranteed)|unhackable/i,
    'absolute security claims are fiction on any surface'],
  [/(enterprise[- ]grade|world[- ]class|cutting[- ]edge)\b/i,
    'banned hype vocabulary (house style: plain verbs, shown not told)'],
];
// a line that admits the fiction (docs explaining the rule) is not a hit
const NEGATION = /do not|never|must not|fiction|example|placeholder|e\.g\.|rule/;
// text extensions + allow-list
const TEXT_EXT = new Set(['.md', '.txt', '.html', '.js', '.mjs', '.cjs', '.yml', '.css']);
const ALLOW = new Set(['scripts/check-fiction-signatures.cjs', 'scripts/check-docs-style.cjs']);
const hits = [];
let scanned = 0;

(function walk(dir, relRoot) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(relRoot, f.name);
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (['node_modules', '_site', '.git', 'dist'].includes(f.name)) continue;
      walk(p, rel);
      continue;
    }
    if (ALLOW.has(rel)) continue;
    if (!TEXT_EXT.has(path.extname(f.name))) continue;
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    scanned++;
    const lines = text.split('\n');
    for (const [re, why] of SIGNATURES) {
      let hitLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) { hitLine = i; break; }
      }
      if (hitLine === -1) continue;
      const line = lines[hitLine];
      const context = (lines[hitLine - 1] || '') + '\n' + line;
      if (NEGATION.test(context)) continue; // debunk line, not a regression
      hits.push(`${rel}:${hitLine + 1}: "${line.trim().slice(0, 120)}" - ${why}`);
    }
  }
})(ROOT, '');
if (hits.length) {
  console.error(`FICTION SIGNATURES: FAIL (${hits.length} hit${hits.length === 1 ? '' : 's'} in ${scanned} files)`);
  for (const h of hits) console.error(' ' + h);
  console.error(' (fix the text, or if the signature is stale, update the signature here AND your house ledger)');
  process.exit(1);
}
console.log(`FICTION SIGNATURES: PASS (${scanned} files scanned, ${SIGNATURES.length} signatures)`);
