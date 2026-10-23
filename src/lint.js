// S1.6 - the determinism linter (issue #13, crate-tooling blocker 3).
//
// The determinism law is "same commit -> same findings": no wall clock, no
// unseeded randomness in verdict paths. The law is enforced by tests for the
// crate's own surfaces; packs and scenarioDirs are USER surfaces, and until
// now nothing kept them flat except reading them. This linter greps the
// declared sources for the wall-clock / randomness token family and fails
// loudly naming file:line - cheaply, before a campaign wastes a run.
//
// Scope is deliberately FLAT (a grep, not an AST walk): the finding classes
// it catches (Date.now, new Date(, Math.random) are flat-shaped, and a lint
// that needs a parser needs a dependency - the zero-deps law wins. The
// library's own timing-relative probes (redos) self-control the clock and
// the harness's durationMs is INFO, not a verdict input - neither is a
// target: the linter scans the sources the CONFIG declares, never src/.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const DETERMINISM_TOKENS = [
  { token: 'Date.now', why: 'wall-clock reads break same-commit -> same-findings (derive from ctx.seed)' },
  { token: 'new Date(', why: 'wall-clock construction breaks determinism (derive from ctx.seed)' },
  { token: 'Math.random', why: 'unseeded randomness breaks determinism (derive from ctx.seed)' },
];

/** Recursively collect source files under the given roots. */
export async function collectSourceFiles(roots, { exts = ['.js', '.mjs'], skipDirs = ['node_modules', '.git'] } = {}) {
  const files = [];
  const walk = async (dir, depth = 0) => {
    if (depth > 24) return; // bounded: a config pointing at "/" never hangs the CLI
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // optional dir
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (skipDirs.includes(ent.name)) continue;
        await walk(join(dir, ent.name), depth + 1);
      } else if (exts.some((e) => ent.name.endsWith(e)) && !ent.name.endsWith('.test.js')) {
        files.push(join(dir, ent.name));
      }
    }
  };
  for (const root of roots) await walk(root);
  files.sort();
  return files;
}

/**
 * Scan files for determinism-law tokens. Returns findings
 * [{ file, line, token, why, text }] - empty means the surface is flat.
 * @param {string[]} files
 */
export async function lintDeterminism(files) {
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch (err) {
      throw new Error(`determinism lint: cannot read "${file}": ${err.message}`);
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { token, why } of DETERMINISM_TOKENS) {
        if (lines[i].includes(token)) {
          findings.push({ file, line: i + 1, token, why, text: lines[i].trim().slice(0, 120) });
        }
      }
    }
  }
  return findings;
}
