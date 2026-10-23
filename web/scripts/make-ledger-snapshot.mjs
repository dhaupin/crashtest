/**
 * scripts/make-ledger-snapshot.mjs
 * ================================
 * Regenerates web/src/lib/dogfoodSnapshot.js from the repo's REAL artifacts:
 *
 *   - labs/crashledger.json  -> the committed ledger (findings/acceptedRisks/baseline)
 *   - labs/hardening.md      -> cost economics rendered by src/report.js
 *
 * Run from the repo root (NOT from web/):
 *
 *   node web/scripts/make-ledger-snapshot.mjs
 *
 * The snapshot is a faithful copy - the dashboard's default view must always
 * render what the CLI actually wrote, never a hand-typed summary. Re-run it
 * after a dogfood run changes labs/, then commit the refreshed snapshot.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE   = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.resolve(HERE, '..', '..');
const OUT    = path.resolve(ROOT, 'web', 'src', 'lib', 'dogfoodSnapshot.js');
await mkdir(path.dirname(OUT), { recursive: true });

const ledger    = JSON.parse(await readFile(path.join(ROOT, 'labs', 'crashledger.json'), 'utf8'));
const hardening = await readFile(path.join(ROOT, 'labs', 'hardening.md'), 'utf8');

// Report header. Two shapes exist in the wild:
//   old: "> crashtest v0.1.0 / 2026-10-20T02:02:43.135Z / seed 12648430"
//   new (cut-stamp refactor): "> crashtest v1.0.0 / seed 12648430" with the
//     wall-clock stamp in labs/run-meta.json (determinism law - the ledger
//     itself must stay byte-stable per commit).
const headNew = hardening.match(/^> crashtest v(\S+) \/ seed (\d+)/m);
const headOld = hardening.match(/^> crashtest v(\S+) \/ (\S+) \/ seed (\d+)/m);
let version = 'unknown';
let startedAt = null;
let seed = null;
if (headNew) {
  [, version, seed] = headNew;
  const metaPath = path.join(ROOT, 'labs', 'run-meta.json');
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (meta.crashtestVersion && version === 'unknown') version = meta.crashtestVersion;
    startedAt = meta.generatedAt ?? null;
    seed = meta.seed ?? Number(seed);
  } catch { /* run-meta is a sidecar; missing it leaves startedAt null */ }
} else if (headOld) {
  [, version, startedAt, seed] = headOld;
}

// Cost totals: "- total: 397 backend ops across 599 in-process requests from 13 attacks"
const totals = hardening.match(/^- total: (\d+) backend ops across (\d+) in-process requests from (\d+) attacks/m);
if (!totals) throw new Error('could not find the cost total line in labs/hardening.md');

// Per attack: "  - id: N ops / M requests"
// Both id halves are hyphen-tolerant - module names like 'proto-hygiene'
// carry hyphens too (the taxonomy round paid for this once already; the
// proto-hygiene round found the attack side of it).
const perAttack = [...hardening.matchAll(/^  - ([a-z0-9-]+\/[a-z0-9-]+): (\d+) ops \/ (\d+) requests$/gm)]
  .map(([, id, ops, requests]) => ({ id, ops: Number(ops), requests: Number(requests) }));
if (perAttack.length === 0) throw new Error('could not parse any per-attack cost lines from labs/hardening.md');

const snapshot = {
  ledger,
  cost: {
    totals: { ops: Number(totals[1]), requests: Number(totals[2]), distinctAttacks: Number(totals[3]) },
    perAttack,
  },
  meta: { version, startedAt, seed: seed == null ? null : Number(seed) },
};

const banner = `/**
 * src/lib/dogfoodSnapshot.js - GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Snapshot of crashtest's own dogfood run, produced by
 * \`node web/scripts/make-ledger-snapshot.mjs\` from the committed artifacts:
 *   labs/crashledger.json (the ledger) + labs/hardening.md (cost economics).
 * Re-run the generator after a dogfood run changes labs/, then commit.
 *
 * The dashboard renders this snapshot as its default, honest view:
 * a real ledger cut v${version} - not demo data hand-typed for the page.
 */

`;

await writeFile(
  OUT,
  banner + 'export const dogfood = ' + JSON.stringify(snapshot, null, 2) + ';\n',
);
console.log(`[make-ledger-snapshot] wrote ${path.relative(ROOT, OUT)} (v${version}, seed ${seed}, ${perAttack.length} attack cost rows)`);
