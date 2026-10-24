// Self-audit fixture for the crashtest-site pack (SPEC §4).
// Hand-invocable: node test/fixtures/run.mjs - imports the REAL module from
// ../attacks.js (the manifest entry) and pins:
//   - the manifest contract (schemaVersion/name/entry tamper-proofing)
//   - the documented 18-attack inventory (name census transcription)
//   - ids kebab-case + unique (the buffered id grammar attacks must obey)
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));      // <packdir>/test/fixture
const packDir = dirname(dirname(here));                    // <packdir>

const EXPECTED_ATTACKS = [
  'headers-claim-audit',
  'html-secret-leakage',
  'csp-canary-bypass-attempts',
  'version-grammar-hostile-shapes',
  'version-cache-poisoning-window',
  'sitemap-truth-audit',
  'manifest-declared-icons-resolve',
  'robotstxt-no-self-sabotage',
  'version-burst-under-shape-flapping',
  'taxonomy-abuse-not-5xx',
  'taxonomy-impersonal-sad-paths',
  'session-no-minted-cookies',
  'session-forged-cookie-never-adopted',
  'authz-no-privileged-surface',
  'proto-hygiene-shape-battery',
  'recursion-depth-sweep',
  'upload-multipart-hardening',
  'race-asset-parity',
];

export async function audit() {
  const manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error(`crashtest-site: manifest schemaVersion is ${manifest.schemaVersion}, expected 1`);
  if (manifest.name !== 'crashtest-site') throw new Error(`crashtest-site: manifest name "${manifest.name}" does not match directory`);

  const entryPath = join(packDir, manifest.entry);
  const mod = await import(pathToFileURL(entryPath).href);
  if (!Array.isArray(mod.default?.attacks) || mod.default.attacks.length === 0) {
    throw new Error('crashtest-site: entry module exposes no attacks array');
  }

  const ids = mod.default.attacks.map((a) => a.name);
  const bad = ids.filter((id) => !/^[a-z0-9-]+$/.test(id));
  if (bad.length) throw new Error(`crashtest-site: non-kebab-case attack ids: ${bad.join(', ')}`);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) throw new Error(`crashtest-site: duplicate attack ids: ${[...new Set(dupes)].join(', ')}`);

  const missing = EXPECTED_ATTACKS.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`crashtest-site: documented attacks missing from module: ${missing.join(', ')}`);
  const unexpected = ids.filter((id) => !EXPECTED_ATTACKS.includes(id));
  if (unexpected.length) throw new Error(`crashtest-site: undocumented attacks present in module: ${unexpected.join(', ')}`);

  if (ids.length !== EXPECTED_ATTACKS.length) {
    throw new Error(`crashtest-site: expected ${EXPECTED_ATTACKS.length} attacks, module exposes ${ids.length}`);
  }
  return { pack: 'crashtest-site', attacks: ids.length };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  try {
    const r = await audit();
    console.log(`crashtest-site fixture: OK (${r.attacks} attacks pinned)`);
  } catch (err) {
    console.error(`crashtest-site fixture: FAIL - ${err.message}`);
    process.exitCode = 1;
  }
}
