// Self-audit fixture for the wp-roles pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../index.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the 3-attack inventory + id grammar (transcribed census)
//   - the experimental contract: the pack must still be a well-behaved
//     contract-shaped module (imports its own stub WP core accounting-
//     harness, never the host's). Stub residency by name.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packDir = dirname(dirname(here));

const EXPECTED_ATTACKS = ['nopriv-callback-denied', 'low-privilege-callback-blocked', 'capability-constants-hold'];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`wp-roles: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'wp-roles') throw new Error(`wp-roles: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const src = await readFile(entryPath, 'utf8');
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('wp-roles: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`wp-roles: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`wp-roles: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);
  for (const id of EXPECTED_ATTACKS) {
    if (!ids.includes(id)) throw new Error(`wp-roles: documented attack missing from module: ${id}`);
  }
  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`wp-roles: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }

  return { pack: 'wp-roles', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`wp-roles fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`wp-roles fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
