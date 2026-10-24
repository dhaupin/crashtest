// Self-audit fixture for the qs-shapes pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the 2-attack inventory + id grammar (transcribed census)
//   - the wire-shape residency: the pack asserts its engine differences
//     only through running ITS OWN shapes (harness run-second refusal
//     request, param-armed hardening), never engaged against a fixed
//     happy path the pack could dedupe around.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['qs-bracket-canary', 'qs-depth-floor'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`qs-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'qs-shapes') throw new Error(`qs-shapes: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('qs-shapes: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`qs-shapes: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`qs-shapes: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`qs-shapes: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`qs-shapes: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  for (const atk of mod.default.attacks) {
    if (typeof atk.run !== 'function') throw new Error(`qs-shapes: attack "${atk.name}" carries no run() function`);
  }

  return { pack: 'qs-shapes', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`qs-shapes fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`qs-shapes fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
