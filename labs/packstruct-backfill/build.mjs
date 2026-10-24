// packstruct-backfill generator - the committed, offline fixture corpus for
// the packstruct self-audit backfill (dhaupin/crashtest#19 -> packstruct#1
// ask #2, sequencing ack recorded in crashtest#20).
//
// WHAT IT PRODUCES (both files are committed artifacts, like the ledger):
//   corpus.json           - byte-exact transcription of every shipped
//                           packs/public/<name>/pack.json (+ sha256) - the
//                           "real-world corpus" packstruct can lint against
//                           and crashtest can diff against forever.
//   conformance-rows.json - the per-pack conformance facts (frozen-v1
//                           column: required keys, optional host-owned keys,
//                           name == dir, entry exists), re-derived from the
//                           SAME bytes so facts can never drift from data.
//
// HOW TO RUN: node labs/packstruct-backfill/build.mjs  (from the repo root)
// The generator is deterministic on purpose - no Date.now(), no Math.random;
// the only inputs are the pack files themselves. A regenerated run that
// changes bytes means a pack changed - that diff is MEANT to be reviewed
// (the transcription pin in test/packstruct-backfill.test.js fails loudly
// if the committed corpus stops matching the shipped packs).
//
// Determinism house rule 4 applies: same worktree -> identical output bytes.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKS_PUBLIC = join(REPO_ROOT, 'packs', 'public');
const OUT_DIR = fileURLToPath(new URL('.', import.meta.url));

// The host-owned optional manifest keys (packs/loader.js + crashtest#19 /
// packstruct#20 ack): the engine shape-validates them, the spec acknowledges
// them by name. Listed so the conformance rows name what they saw on disk.
const HOST_OWNED_OPTIONAL = ['env', 'plugins', 'package'];

async function main() {
  const dirs = (await readdir(PACKS_PUBLIC, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const packs = [];
  for (const name of dirs) {
    const packDir = join(PACKS_PUBLIC, name);
    let manifestJson;
    try {
      manifestJson = await readFile(join(packDir, 'pack.json'), 'utf8');
    } catch {
      continue; // a dir without pack.json is not a pack (the local/ WIP rule)
    }
    const manifest = JSON.parse(manifestJson);
    const entry = manifest.entry ?? 'index.js';
    let entryFileIsPresent;
    try {
      await readFile(join(packDir, entry), 'utf8');
      entryFileIsPresent = true;
    } catch {
      entryFileIsPresent = false;
    }
    const sha256 = createHash('sha256').update(manifestJson).digest('hex');
    packs.push({ name, dir: `packs/public/${name}`, sha256, manifestJson, manifest, entryFileIsPresent });
  }
  packs.sort((a, b) => a.name.localeCompare(b.name));

  // Conformance rows: re-derived from the exact bytes snapshotted above, so
  // the facts and the corpus can never disagree.
  const rows = packs.map(({ name, dir, sha256, manifest, entryFileIsPresent }) => ({
    name,
    dir,
    sha256,
    declaredKeys: Object.keys(manifest).sort(),
    facts: {
      schemaVersionIs1: manifest.schemaVersion === 1,
      nameEqualsDir: manifest.name === name,
      declaredEntry: manifest.entry ?? undefined,
      entryFileIsPresent,
      declaresArmedByKey: manifest.armedByKey !== undefined,
      hostOwnedKeysPresent: HOST_OWNED_OPTIONAL.filter((k) => manifest[k] !== undefined),
    },
  }));

  // Raw manifest bytes ride INSIDE the snapshot string, verbatim - these
  // files are plain JSON objects, so escaping-free transcription holds.
  await writeFile(
    join(OUT_DIR, 'corpus.json'),
    JSON.stringify({
      schema: 1,
      source: 'packs/public/*/pack.json at the worktree this commit pins (transcription, never invention; regenerate via node labs/packstruct-backfill/build.mjs)',
      packCount: packs.length,
      packs: packs.map(({ name, dir, sha256, manifestJson }) => ({ name, dir, sha256, manifestJson })),
    }, null, 2) + '\n',
  );

  await writeFile(
    join(OUT_DIR, 'conformance-rows.json'),
    JSON.stringify({
      schema: 1,
      source: 're-derived from the corpus bytes above (same commit, same facts)',
      rows,
    }, null, 2) + '\n',
  );

  console.log(`packstruct-backfill: wrote corpus.json + conformance-rows.json (${packs.length} packs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
