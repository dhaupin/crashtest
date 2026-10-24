// Self-audit fixture for the vite-dev-shapes pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the 2-attack inventory + id grammar (transcribed census)
//   - canary residency: both attacks run() through a dev-file WIRE shape
//     (imports their own), no direct file read (served shapes only), and
//     every attack is contract-shaped (run function, detail string).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['vite-fs-deny-bypass', 'vite-env-canary'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`vite-dev-shapes: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'vite-dev-shapes') throw new Error(`vite-dev-shapes: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('vite-dev-shapes: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`vite-dev-shapes: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`vite-dev-shapes: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`vite-dev-shapes: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`vite-dev-shapes: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  for (const atk of mod.default.attacks) {
    if (typeof atk.run !== 'function') throw new Error(`vite-dev-shapes: attack "${atk.name}" carries no run() function`);
  }

  return { pack: 'vite-dev-shapes', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`vite-dev-shapes fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`vite-dev-shapes fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
