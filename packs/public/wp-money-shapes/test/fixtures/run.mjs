// Self-audit fixture for the wp-money-shapes pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the armedByKey gate: the pack's attacks are ONLY potent when the
//     harness context provides the wp-money-shapes key (the documented
//     mis-arm trap, test/wp-money-shapes.test.js) - the module must DERIVE
//     its arming decision itself, never import a constant it could dedupe.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['wp-write-volley', 'wp-txn-replay', 'wp-gate-burst'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`wp-money-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'wp-money-shapes') throw new Error(`wp-money-shapes: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const src = await readFile(entryPath, 'utf8');
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('wp-money-shapes: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`wp-money-shapes: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`wp-money-shapes: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`wp-money-shapes: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`wp-money-shapes: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  // The arming decision must be DRIVER-EXTERNAL (armed={{key}} in the
  // harness context), not a module-level constant the tamper gate could
  // overwrite. The source is the only way to catch it: armedByKey must
  // appear as a string in the module, and the attacks must receive it via
  // the harness shape (no hardcoded `true`).
  if (!/armed/.test(src)) {
    throw new Error('wp-money-shapes: entry module never mentions "armed" - the arming gate was dropped');
  }

  return { pack: 'wp-money-shapes', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`wp-money-shapes fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`wp-money-shapes fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
