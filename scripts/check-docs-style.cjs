#!/usr/bin/env node
/**
 * Docs style linter (ported from vant's scripts/check-docs-style.js,
 * adapted to crashtest's voice).
 *
 * Checks every docs/*.md file:
 * - every opening code fence carries a language tag (closing fences exempt)
 *   — HARD FAIL
 * - no heading level skips (h1 -> h3) — HARD FAIL
 * - no trailing whitespace, no tabs in prose — HARD FAIL
 * - pipe-table shape: lines starting with | must end with |; no pipes
 *   in headings; no bullets ending with | (broken-table residue) — HARD FAIL
 * - em/en dashes and emoji in prose — WARN ONLY (vant's voice rule; the
 *   crashtest corpus uses em dashes deliberately and its verdict marks
 *   are content. Adopting vant's hyphen-only style is a later corpus pass,
 *   not a gate. Verdict-mark pages are exempt regardless.)
 * Exit 1 on hard findings; warnings never fail the gate.
 */
const fs = require('fs');
const path = require('path');
const DOCS = path.resolve(__dirname, '..', 'docs');
// Voice-rule exempt files: historical records keep their punctuation.
const VOICE_EXEMPT = /CHANGELOG\.md$/;
// Emoji-exempt: the verdict marks are semantic content on catalog/ledger pages.
const EMOJI_EXEMPT = /(CHANGELOG\.md$|reference\/(attacks|ledger)\.md$|getting-started\/(index|quick-start)\.md$|reference\/exit-rules\.md$)/;
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + '/' + f.name;
    if (f.isDirectory() && f.name !== '_data' && f.name !== '_layouts' && f.name !== '_freestruct') walk(p);
    else if (f.name.endsWith('.md')) files.push(p);
  }
})(DOCS);
let issues = 0;
let warnings = 0;
for (const f of files) {
  const rel = f.replace(DOCS + '/', '');
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let inFence = false;
  let lastHeading = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    if (/^\s*```/.test(line)) {
      if (!inFence && /^```\s*$/.test(line)) {
        console.log(`${rel}:${n} opening fence missing language tag`);
        issues++;
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/[ \t]+$/.test(line)) { console.log(`${rel}:${n} trailing whitespace`); issues++; }
    if (/\t/.test(line)) { console.log(`${rel}:${n} tab character`); issues++; }
    if (!VOICE_EXEMPT.test(rel)) {
      if (/[\u2013\u2014]/.test(line)) { console.log(`WARN ${rel}:${n} em/en dash (vant voice rule; corpus pass pending)`); warnings++; }
      // Arrows, dingbats, emoji blocks, variation selectors. Verdict marks
      // are exempt on the pages that define them (EMOJI_EXEMPT). Glyphs
      // inside inline-code spans are literal data, so strip spans first.
      if (!EMOJI_EXEMPT.test(rel)) {
        const prose = line.replace(/`[^`]*`/g, '');
        if (/[\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\uFE0F]|\uD83C[\uDF00-\uDFFF]|\uD83E[\uDD00-\uDDFF]/.test(prose)) { console.log(`WARN ${rel}:${n} emoji/glyph in prose`); warnings++; }
      }
    }
    // Broken pipe-table residue: "| a" not ending in |, headings that
    // swallowed cells, bullets ending with |.
    if (/^\|.*[^|\s]\s*$/.test(line) && !/^|[\s|:-]*$/.test(line)) { console.log(`${rel}:${n} pipe line does not end with | (broken table)`); issues++; }
    if (/^- .*\|\s*$/.test(line)) { console.log(`${rel}:${n} bullet ends with | (broken table)`); issues++; }
    if (/^#{1,6}\s.*\|/.test(line)) { console.log(`${rel}:${n} pipe character in heading (broken table)`); issues++; }
    const h = line.match(/^(#{1,6})\s/);
    if (h) {
      const level = h[1].length;
      if (lastHeading && level > lastHeading + 1) {
        console.log(`${rel}:${n} heading skips h${lastHeading} to h${level}`);
        issues++;
      }
      lastHeading = level;
    }
  }
}
if (issues > 0) {
  console.log(`DOCS STYLE: FAIL (${issues} hard issue${issues === 1 ? '' : 's'}${warnings ? ', ' + warnings + ' warnings' : ''})`);
} else {
  console.log(`DOCS STYLE: PASS (${files.length} files${warnings ? ', ' + warnings + ' voice warnings' : ''})`);
}
process.exit(issues === 0 ? 0 : 1);
