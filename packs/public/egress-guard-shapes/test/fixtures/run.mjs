// Self-audit fixture for the egress-guard-shapes pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the 2-attack inventory + id grammar (transcribed census)
//   - the corpus residency: the hostile corpus and the public control are
//     exported constants, so the pack asserts its shapes only through ITS
//     OWN table, never a fixed happy path it could dedupe around.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['egress-shape-corpus', 'egress-guard-differential'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`egress-guard-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'egress-guard-shapes') throw new Error(`egress-guard-shapes: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('egress-guard-shapes: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`egress-guard-shapes: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`egress-guard-shapes: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`egress-guard-shapes: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`egress-guard-shapes: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  for (const atk of mod.default.attacks) {
    if (typeof atk.run !== 'function') throw new Error(`egress-guard-shapes: attack "${atk.name}" carries no run() function`);
  }

  // Corpus residency: the exported tables must be non-empty, and the public
  // control must NOT be in the internal corpus (the differential depends on
  // the two being disjoint).
  if (!Array.isArray(mod.INTERNAL_SHAPES) || mod.INTERNAL_SHAPES.length < 8) {
    throw new Error('egress-guard-shapes: INTERNAL_SHAPES corpus is missing or suspiciously small');
  }
  if (typeof mod.PUBLIC_CONTROL !== 'string' || !mod.PUBLIC_CONTROL.startsWith('https://')) {
    throw new Error('egress-guard-shapes: PUBLIC_CONTROL must be an https URL');
  }
  if (mod.INTERNAL_SHAPES.includes(mod.PUBLIC_CONTROL)) {
    throw new Error('egress-guard-shapes: the public control must not appear in the internal corpus');
  }

  return { pack: 'egress-guard-shapes', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`egress-guard-shapes fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`egress-guard-shapes fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
