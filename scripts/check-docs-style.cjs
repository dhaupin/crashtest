#!/usr/bin/env node
/**
 * Docs style linter (ported from vant's scripts/check-docs-style.js,
 * adapted to crashtest's voice).
 *
 * Checks every docs/*.md file:
 * - every opening code fence carries a language tag (closing fences exempt)
 *   - HARD FAIL
 * - no heading level skips (h1 -> h3) - HARD FAIL
 * - no trailing whitespace, no tabs in prose - HARD FAIL
 * - pipe-table shape: lines starting with | must end with |; no pipes
 *   in headings; no bullets ending with | (broken-table residue) - HARD FAIL
 * - no em/en dashes in prose (hyphen-only voice; corpus converted 2026-10-20,
 *   150 dashes). CHANGELOG exempt.
 * - no emoji/dingbat glyphs in prose - HARD FAIL, with two carve-outs that
 *   are content, not decoration: verdict marks (🛡 ⚡ 🔒 - product
 *   vocabulary on any page) and the technical arrow -> (flow notation,
 *   same class as >= or infinity). Everything else (dingbats, emoji
 *   blocks, variation selectors) fails. Glyphs inside inline-code spans
 *   are literal data.
 * - AI cliches banned (delve/leverage/unlock/seamless/empower/journey/
 *   realm/game-changer/cutting-edge/revolutionary + "we're excited to",
 *   "click here" link text, "this section covers" placeholders) - HARD
 *   FAIL. The list lives above and in docs/about/style.md; add a phrase
 *   here when it surfaces twice.
 * Exit 1 on any hard finding; the voice corpus pass landed, so warnings
 * no longer apply - a violation is a regression.
 */
const fs = require('fs');
const path = require('path');
const DOCS = path.resolve(__dirname, '..', 'docs');
// AI-cliche list (docs/about/style.md): phrases that signal generated filler.
// HARD FAIL outside CHANGELOG (historical records keep their punctuation).
const CLICHES = [
  [/\bdelve into\b/i, 'cliche "delve into" (say "explore")'],
  [/\bleverag(e|ing)\b/i, 'cliche "leverage" (say "use")'],
  [/\bunlock(s|ed|ing)?\b/i, 'cliche "unlock" (be specific)'],
  [/\bseamless(ly)?\b/i, 'cliche "seamless" (remove)'],
  [/\bempower(s|ed|ing)?\b/i, 'cliche "empower" (say "let you")'],
  [/\bjourney\b/i, 'cliche "journey" (remove)'],
  [/\brealm\b/i, 'cliche "realm" (remove)'],
  [/\bgame[- ]?changer\b/i, 'cliche "game-changer" (remove)'],
  [/\bcutting[- ]?edge\b/i, 'cliche "cutting-edge" (remove)'],
  [/\brevolutionar(y|ily)\b/i, 'cliche "revolutionary" (state the fact)'],
  [/\bin today'?s (world|landscape)\b/i, 'cliche "in today\'s ..." (remove)'],
  [/\bwe'?re excited to\b/i, 'cliche "we\'re excited to" (remove)'],
  [/\bclick here\b/i, 'non-descriptive link text "click here"'],
  [/\bthis section (covers|will)\b/i, 'placeholder intro "this section covers" (write the content)'],
];
// Voice-rule exempt files: historical records keep their punctuation.
const VOICE_EXEMPT = /CHANGELOG\.md$/;
// Emoji-exempt: the verdict marks are semantic content on catalog/ledger pages.
const EMOJI_EXEMPT = /(CHANGELOG\.md$|reference\/(attacks|ledger)\.md$|getting-started\/(index|quick-start)\.md$|reference\/exit-rules\.md$)/;
// Carve-outs allowed on ANY page: verdict marks (product vocabulary) and
// the technical arrow (flow notation). Tested below, not per-file.
const ALLOWED_GLYPHS = /[\u2192\uD83D\uDEE1\u26A1\uD83D\uDD12]/g;
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + '/' + f.name;
    if (f.isDirectory() && f.name !== '_data' && f.name !== '_layouts' && f.name !== '_freestruct') walk(p);
    else if (f.name.endsWith('.md')) files.push(p);
  }
})(DOCS);
let issues = 0;
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
      if (/[\u2013\u2014]/.test(line)) { console.log(`${rel}:${n} em/en dash (hyphen-only voice; see docs/about/style)`); issues++; }
      // AI-cliche scan: inline-code spans are literal data, strip first.
      const proseLine = line.replace(/`[^`]*`/g, '');
      for (const [re, why] of CLICHES) {
        if (re.test(proseLine)) { console.log(`${rel}:${n} ${why}`); issues++; }
      }
      // Arrows, dingbats, emoji blocks, variation selectors. Verdict marks
      // are exempt on the pages that define them (EMOJI_EXEMPT). Glyphs
      // inside inline-code spans are literal data, so strip spans first.
      if (!EMOJI_EXEMPT.test(rel)) {
        const prose = line.replace(/`[^`]*`/g, '').replace(ALLOWED_GLYPHS, '');
        if (/[\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\uFE0F]|\uD83C[\uDF00-\uDFFF]|\uD83E[\uDD00-\uDDFF]/.test(prose)) { console.log(`${rel}:${n} emoji/glyph in prose`); issues++; }
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
  console.log(`DOCS STYLE: FAIL (${issues} issue${issues === 1 ? '' : 's'})`);
} else {
  console.log(`DOCS STYLE: PASS (${files.length} files)`);
}
process.exit(issues === 0 ? 0 : 1);
