#!/usr/bin/env node
/**
 * Fiction-signature gate (ported from vant's scripts/check-fiction-signatures.js,
 * seeded with crashtest's own caught-wrong claims).
 *
 * The wrong-claims this project has actually caught in docs, help text, and
 * the marketing surfaces - repeatedly - are now gates, not memories:
 *
 * 1. `npm install -g crashtest` per the README's global-install pattern -
 *    the CLI is installed per-repo (npx crashtest / npm install crashtest);
 *    a global install lies about where labs/ lands. (Docs drift candidate.)
 * 2. "no dependencies" claimed of the WEB app - the zero-deps law is the
 *    CLI/runtime; web/ legitimately ships vite+react. (Fiction the web
 *    pages must not leak into CLI docs.)
 * 3. sockets claimed safe/supported - the one law: no sockets, ever. Any
 *    prose suggesting a network/live-fire mode is fiction.
 * 4. phantom modules version claims - release numbers that don't exist
 *    (forward-dated features); current release lives in package.json.
 * 5. `crashtest 0.2` style claims of shipped-but-unreleased flags -
 *    PRD-labeled v0.2/v0.4 features must say "planned", not imply shipped.
 *
 * SCOPE: every tracked text file EXCEPT the allow-list. Add a signature the
 * moment a fiction is caught twice. Exit 1 on any hit outside the allow-list.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
// signature: [regex, human explanation]
const SIGNATURES = [
  [/npm\s+install\s+(-g|--global)\s+crashtest/i,
    'global install is not the documented flow - labs/ is per-repo; docs say `npm install crashtest` in the repo or `npx crashtest`'],
  [/no\s+(runtime\s+)?dependencies[^\n]{0,80}(web|site|dashboard|vite|react)/i,
    'the zero-dependency law covers the CLI/runtime; the web app legitimately ships build tooling - do not claim it deps-free'],
  [/(live[- ]?fire|network|real\s+socket|http\s+server\s+listen)[^\n]{0,60}(mode|supported|allowed|enabled)/i,
    'no sockets, ever (PRD principle 2) - nothing network/live-fire exists on any surface'],
  [/\bv?0\.[2-9]\.[0-9]+\s+(is\s+)?(now\s+)?(shipped|released|available)\b/i,
    'forward-dated release claim - verify against package.json; PRD-labeled future work must say "planned", never "shipped"'],
];
function allowListed(rel) {
  if (rel === 'scripts/check-fiction-signatures.cjs') return true;
  if (/^scripts\/check-.*\.c?js$/.test(rel)) return true; // gates may quote signatures
  if (rel.startsWith('labs/archives/')) return true;
  // The rolling ledger QUOTES fiction when it fixes it - quotes are the job.
  if (rel === 'labs/TASKS.md' || rel === 'labs/prd-crashtest.md') return true;
  // The voice page documents the signatures themselves (same job as this file).
  if (rel === 'docs/about/style.md') return true;
  if (rel === 'CHANGELOG.md' || rel === 'package-lock.json') return true;
  if (/(^|\/)node_modules\//.test(rel) || rel.startsWith('.git/')) return true;
  if (rel === 'web/package-lock.json') return true;
  return false;
}
// A line that DEBUNKS a signature ("no sockets, ever", "never", "does not
// exist") is doing the gate's job in prose - not a regression.
const NEGATION = /there is no\b|does not exist|never existed|no sockets|never|not supported|out of scope|no network|zero sockets|planned\b/i;
const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.cjs', '.html', '.json', '.yml', '.yaml', '.txt', '.sh', '.css']);
const hits = [];
let scanned = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + f.name;
    const rel = path.relative(ROOT, p);
    if (f.isDirectory()) { walk(p); continue; }
    if (allowListed(rel)) continue;
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
})(ROOT);
if (hits.length) {
  console.error(`FICTION SIGNATURES: FAIL (${hits.length} hit${hits.length === 1 ? '' : 's'} in ${scanned} files)`);
  for (const h of hits) console.error(' ' + h);
  console.error(' (fix the text, or if the signature is stale, update the signature here AND the ledger)');
  process.exit(1);
}
console.log(`FICTION SIGNATURES: PASS (${scanned} files scanned, ${SIGNATURES.length} signatures)`);
