// Self-audit fixture for the next-middleware-shapes pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the 2-attack inventory + id grammar (transcribed census)
//   - the pack asserts its wire semantics through a NEXT-SHAPED WIRE only:
//     the module never imports the host's harpooned express adapter (the
//     pack carries its own shapes), and neither of its id-length attacks
//     can signal success blindly (every run() must return, never leak a
//     thrown verdict).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['mw-bypass-grammar', 'mw-value-blindness'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`next-middleware-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'next-middleware-shapes') throw new Error(`next-middleware-shapes: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('next-middleware-shapes: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`next-middleware-shapes: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`next-middleware-shapes: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`next-middleware-shapes: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`next-middleware-shapes: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  // Wire-shape residency (transcribed from test/next-middleware.test.js):
  // orchestrating behavior must stay inside the pack, not borrow from a
  // neighboring pack module's wire (double-apping was on the table).
  for (const atk of mod.default.attacks) {
    if (typeof atk.run !== 'function') throw new Error(`next-middleware-shapes: attack "${atk.name}" carries no run() function`);
  }

  return { pack: 'next-middleware-shapes', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`next-middleware-shapes fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`next-middleware-shapes fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
