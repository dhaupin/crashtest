#!/usr/bin/env node
/**
 * gen-refusal-battery.cjs - the IN-REPO half of the shared refusal battery
 * (dhaupin/packstruct#3 / dhaupin/crashtest#25; the in-repo offer from the
 * #25 crashtest column, made permanent).
 *
 * It materializes each transcribed packstruct battery shape
 * (labs/refusal-battery/packstruct@<sha>/*.json) into a scratch root exactly
 * as the battery file instructs, runs OUR loader over the same bytes
 * (src/packs/loader.js - the crashtest#19 receipt path), and
 *   a) writes labs/refusal-matrix-crashtest.json when --write is passed, or
 *   b) VERIFIES the committed column: any row whose observed verdict or
 *      norms drifted from the commit is a loud failure naming both sides.
 *
 * The battery cannot go stale silently: a battery transcription change, an
 * engine rule change, or a column edit that disagrees with the observed
 * truth fails HERE (the same self-refusal teeth packstruct's
 * gen-refusal-matrix.mjs runs with, mirrored one-for-one).
 *
 * Exit 0 = observed column matches the commit; 1 = drift; 2 = usage.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Our loader's norms, tagged from OUR OWN message fragments (no invented tags).
function orient(err) {
  const m = err.message;
  if (/unsupported schemaVersion|missing "schemaVersion"/.test(m)) return ['schemaVersion'];
  if (/not kebab-case/.test(m)) return ['name-kebab-case'];
  if (/unreadable JSON/.test(m)) return ['manifest-invalid'];
  if (/failed to import/.test(m)) return ['entry'];
  if (/is not a JSON object/.test(m)) return ['manifest-invalid'];
  if (/loaded from both/.test(m)) return ['name-collision'];
  return [];
}

// The documented host-difference rows (SPEC-adjacent legitimacy, argued in
// dhaupin/crashtest#25): packstruct refuses where our loader hands back the
// resting shape. Pinning them is what makes a future disagreement a FINDING
// instead of ambient noise.
const DOCUMENTED_DIFFERENCES = new Set([
  'version-major-only',    // packs/loader.js does not gate on `version`
  'description-empty',     // presence + string type; empties pass
  'armedByKey-empty',      // presence semantics only; arming is host-ceremony
  'armedByKey-non-string', // same host-owned class: no type gate on armedByKey
  'name-dir-mismatch',     // `seen` is keyed by name; dir-match is data-level
  'manifest-missing',      // loose WIP dirs skip quietly (the local/ contract)
  'missing-public-dir',    // visibility dirs are optional roots
]);

async function observe(scratchRoot) {
  // ESM import inside a .cjs - the loader is ESM-only.
  const { pathToFileURL } = await import('node:url');
  const { loadPacks } = await import(pathToFileURL(path.join(ROOT, 'src/packs/loader.js')).href);
  try {
    const packs = await loadPacks([scratchRoot]);
    return { refused: false, norms: [], packsLoaded: packs.length };
  } catch (err) {
    return { refused: true, norms: orient(err) };
  }
}

async function materialize(bat, batteryDir) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'battery-'));
  if (bat.dirName) {
    const dir = path.join(root, 'public', bat.dirName);
    await fs.promises.mkdir(dir, { recursive: true });
    if (bat.manifest === null) {
      // no pack.json - the manifest-missing row can still write the entry
      if (bat.writeEntryFile) await writeEntry(dir, 'probes-entry.js');
    } else if (typeof bat.manifest === 'string') {
      // malformed-JSON placeholder -> write malformed bytes
      await fs.promises.writeFile(path.join(dir, 'pack.json'), '{"oh', 'utf8');
    } else {
      await fs.promises.writeFile(path.join(dir, 'pack.json'), JSON.stringify(bat.manifest, null, 2) + '\n', 'utf8');
      if (bat.writeEntryFile) await writeEntry(dir, bat.manifest.entry ?? 'probes-entry.js');
    }
  }
  return root;

  async function writeEntry(dir, name) {
    // A minimal LOADABLE module: our loader refuses EMPTY attacks arrays at
    // module level (the scenario contract), so the battery stub carries one
    // honest probe attack - the manifest verdict is what the battery reads.
    const body = "export default { name: 'shape-pack', description: 'battery base - clean otherwise', attacks: [{ name: 'shape-pack-probe', description: 'battery probe', async run() { return { verdict: 'REFUSED', detail: 'battery' }; } }] };\n";
    await fs.promises.writeFile(path.join(dir, name), body, 'utf8');
  }
}

async function main() {
  const pinnedDir = process.argv[2];
  const doWrite = process.argv.includes('--write');
  if (!pinnedDir) {
    console.error('usage: node scripts/gen-refusal-battery.cjs <labs/refusal-battery/packstruct@sha dir> [--write]');
    process.exit(2);
  }
  const corpusDir = path.join(ROOT, pinnedDir);
  const columnPath = path.join(ROOT, 'labs', 'refusal-matrix-crashtest.json');

  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.json') && f !== 'packstruct-column.json' && f !== 'packstruct-golden.json' && f !== 'README.md').sort();
  const rows = [];
  for (const f of files) {
    const bat = JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf8'));
    const root = await materialize(bat, corpusDir);
    const host = await observe(root);
    await fs.promises.rm(root, { recursive: true, force: true });
    rows.push({ id: bat.id, host, documentedDifference: DOCUMENTED_DIFFERENCES.has(bat.id) });
  }

  const column = {
    schema: 1,
    source: `crashtest loader over the transcribed packstruct battery (${pinnedDir}); observed 2026-10-24, generated by scripts/gen-refusal-battery.cjs`,
    rows,
  };
  const json = JSON.stringify(column, null, 2) + '\n';

  if (doWrite) {
    fs.writeFileSync(columnPath, json, 'utf8');
    console.log(`gen-refusal-battery: wrote labs/refusal-matrix-crashtest.json (${rows.length} rows)`);
    process.exit(0);
  }

  const committed = fs.readFileSync(columnPath, 'utf8');
  if (committed !== json) {
    console.error('gen-refusal-battery: DRIFT - the observed column differs from labs/refusal-matrix-crashtest.json');
    const committedParsed = JSON.parse(committed);
    for (const r of rows) {
      const c = committedParsed.rows.find((x) => x.id === r.id);
      if (!c) { console.error(`  missing row in commit: ${r.id}`); continue; }
      const cd = JSON.stringify([c.host.refused, ...c.host.norms]);
      const rd = JSON.stringify([r.host.refused, ...r.host.norms]);
      if (cd !== rd) console.error(`  ${r.id}: committed [${cd}] observed [${rd}]${r.documentedDifference ? ' (documented host difference - re-derive it deliberately if the engine rule moved)' : ''}`);
    }
    console.error('fix the engine or re-derive the column in the SAME review (`node scripts/gen-refusal-battery.cjs <dir> --write`)');
    process.exit(1);
  }
  console.log(`gen-refusal-battery: labs/refusal-matrix-crashtest.json verified against observed bytes (${rows.length} rows, ${DOCUMENTED_DIFFERENCES.size} documented differences pinned)`);
}

main().catch((err) => { console.error('gen-refusal-battery: ' + (err && err.message || err)); process.exit(1); });
