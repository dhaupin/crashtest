// Packs - the extension surface (PRD section 14). Tests pin the loader contract:
// schema validation fails loudly, name collisions across surfaces fail, and
// private (local) packs load exactly like public ones - nothing about
// visibility changes semantics, only where files live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPacks, validatePackManifest, validateEnvClaims, evaluatePackEnv, applyPackSeed, renderEnvClaims, renderPrerequisite } from '../src/packs/loader.js';
import { FakeD1 } from '../src/harness/d1.js';
import { FakeKV } from '../src/harness/kv.js';
import { newBackendCounter } from '../src/harness/counters.js';
import { main } from '../src/cli.js';

async function mkPack(root, visibility, name, manifest, entryBody) {
  const dir = join(root, visibility, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (entryBody !== undefined) {
    await writeFile(join(dir, manifest.entry ?? 'index.js'), entryBody);
  }
  return dir;
}

const GOOD_MANIFEST = {
  schemaVersion: 1,
  name: 'probe-pack',
  description: 'a probe pack',
  entry: 'index.js',
};
const ENTRY_OK = "export default { name: 'probe-pack', description: 'a probe pack', attacks: [{ name: 'die-hard', description: 'probe', async run() { return { verdict: 'REFUSED', detail: 'held' }; } }] };\n";

test('validatePackManifest: enforces schemaVersion, kebab-case name, string fields', () => {
  assert.equal(validatePackManifest(GOOD_MANIFEST, 'public/probe').entry, 'index.js');
  assert.throws(() => validatePackManifest({ ...GOOD_MANIFEST, schemaVersion: 2 }, 'x'), /unsupported schemaVersion/);
  assert.throws(() => validatePackManifest({ ...GOOD_MANIFEST, name: 'Nope!' }, 'x'), /kebab-case/);
  assert.throws(() => validatePackManifest({ schemaVersion: 1, name: 'p' }, 'x'), /missing "description"/);
  assert.throws(() => validatePackManifest(null, 'x'), /not a JSON object/);
});

test('loadPacks: public and local packs load identically through the scenario contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-'));
  await mkPack(root, 'public', 'probe-pack', GOOD_MANIFEST, ENTRY_OK);
  await mkPack(root, 'local', 'loose-pack', { ...GOOD_MANIFEST, name: 'loose-pack', description: 'private probe' }, ENTRY_OK.replace(/probe-pack/g, 'loose-pack'));
  const packs = await loadPacks([root]);
  const pairs = packs.map((p) => [p.visibility, p.manifest.name, p.module.attacks.length]).sort((a, b) => a[1].localeCompare(b[1]));
  assert.deepEqual(pairs, [
    ['local', 'loose-pack', 1],
    ['public', 'probe-pack', 1],
  ]);
});

test('loadPacks: broken pack.json fails LOUDLY (rule 3), missing manifest skips quietly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-'));
  await mkdir(join(root, 'public', 'wip-stuff'), { recursive: true }); // no manifest - WIP, skip
  await mkPack(root, 'public', 'broken', { name: 'broken', description: 'no schema' }); // missing schemaVersion
  await assert.rejects(() => loadPacks([root]), /missing "schemaVersion"/);
  await writeFile(join(root, 'public', 'broken', 'pack.json'), '{ oh no');
  await assert.rejects(() => loadPacks([root]), /unreadable JSON/);
});

test('validatePackManifest: optional npm package field must be a string when present', () => {
  assert.equal(validatePackManifest({ ...GOOD_MANIFEST, package: '@you/crashtest-pack' }, 'x').package, '@you/crashtest-pack');
  assert.throws(() => validatePackManifest({ ...GOOD_MANIFEST, package: 42 }, 'x'), /"package" must be a string/);
});

test('CLI: crashtest packs --json inventories manifests as the LAST line (package + armedByKey ride along)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-json-'));
  const base = join(root, 'packs');
  await mkPack(base, 'public', 'probe-pack', { ...GOOD_MANIFEST, version: '2.4.1', package: '@you/crashtest-pack' }, ENTRY_OK);
  await mkPack(base, 'local', 'loose-pack', { ...GOOD_MANIFEST, name: 'loose-pack', armedByKey: 'loose-pack' }, ENTRY_OK.replace(/probe-pack/g, 'loose-pack'));
  const prev = process.cwd();
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await main(['packs', '--json']);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  const inv = JSON.parse(out[out.length - 1]);
  assert.equal(inv.packs.length, 2);
  const publicPack = inv.packs.find((p) => p.name === 'probe-pack');
  assert.equal(publicPack.version, '2.4.1');
  assert.equal(publicPack.package, '@you/crashtest-pack');
  const localPack = inv.packs.find((p) => p.name === 'loose-pack');
  assert.equal(localPack.visibility, 'local');
  assert.equal(localPack.armedByKey, 'loose-pack');
});

test('loadPacks: the same pack name across public+local is a collision (x)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-'));
  await mkPack(root, 'public', 'dupe', GOOD_MANIFEST, ENTRY_OK);
  await mkPack(root, 'local', 'dupe', GOOD_MANIFEST, ENTRY_OK);
  await assert.rejects(() => loadPacks([root]), /pack name collision/);
});

test('loadPacks: a pack whose entry is contract-invalid fails LOUDLY naming the pack origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-'));
  await mkPack(root, 'public', 'snap', GOOD_MANIFEST, 'export default { not: "a module" };\n');
  await assert.rejects(() => loadPacks([root]), /invalid scenario module .*public\/snap\/index\.js/);
});

// --- issue #33: entry shape is host-owned per profile (packstruct SPEC section 7) ------------

test('loadPacks: profile-minimal entries load with validateProfile:false - the SPEC section 7 clean case (issue #33)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-clean-'));
  // The §7 clean fixture shape: manifest-conformant, entry-importable, NOT scenario-shaped.
  const pk = await mkPack(root, 'public', 'clean-pack', { ...GOOD_MANIFEST, name: 'clean-pack' }, "export default { name: 'clean-pack' };\n");
  const packs = await loadPacks([pk], new Map(), null, { validateProfile: false });
  assert.equal(packs.length, 1);
  assert.equal(packs[0].manifest.name, 'clean-pack', 'the manifest contract stays fully enforced');
  assert.equal(packs[0].module.name, 'clean-pack', 'the host-owned entry shape surfaces as-is, no second validation added');
});

test('loadPacks: profile-deferred loading still enforces the manifest contract (bad manifest fails loudly either way, issue #33)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-clean-manifest-'));
  const pk = await mkPack(root, 'public', 'clean-pack', { schemaVersion: 9, name: 'clean-pack', description: 'x' }, "export default { name: 'clean-pack' };\n");
  await assert.rejects(() => loadPacks([pk], new Map(), null, { validateProfile: false }), /unsupported schemaVersion/);
});

test('loadPacks: the DEFAULT stays strict - profile-minimal entry refuses so the run path is byte-identical (issue #33)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-clean-default-'));
  const pk = await mkPack(root, 'public', 'clean-pack', { ...GOOD_MANIFEST, name: 'clean-pack' }, "export default { name: 'clean-pack' };\n");
  await assert.rejects(() => loadPacks([pk]), /invalid scenario module .*needs a one-line description/);
});

// --- the packs-root/visibility-dir footgun guard (packstruct#13's family shape) ------------

test('loadPacks: a declared ROOT named public/ or local/ refuses LOUDLY naming the packs-root fix (the silent zero-pack typo is closed)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-footgun-'));
  const pk = await mkPack(root, 'public', 'probe-pack', GOOD_MANIFEST, ENTRY_OK);
  // The classic typo: pointing AT the visibility dir instead of the ROOT.
  await assert.rejects(
    () => loadPacks([join(root, 'public')]),
    (e) => /looks like the public directory itself/.test(e.message)
      && e.message.includes(`- pass the packs ROOT (the parent of public/), not the visibility dir: ${root}`),
  );
  // The local/ variant, and the same misfire inside an array of roots.
  await assert.rejects(() => loadPacks([join(root, 'local'), pk]), /looks like the local directory itself/);
  // The real root keeps working right next to it - the guard narrows, never widens.
  const packs = await loadPacks([root]);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].manifest.name, 'probe-pack');
});

test('loadPacks: the escape hatch stays legal - a pack.json directly inside a public/-named dir is a one-pack-dir load, not a misfire', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-footgun-legal-'));
  // A single pack dir may legitimately BE named public (pack.json directly inside).
  const pk = await mkPack(root, 'public', 'public', { ...GOOD_MANIFEST, name: 'oddly-named' }, ENTRY_OK.replace(/probe-pack/g, 'oddly-named'));
  const packs = await loadPacks([pk]);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].visibility, 'public');
  assert.equal(packs[0].manifest.name, 'oddly-named');
});

test('CLI: crashtest packs lists discovered packs with visibility + counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-cli-'));
  const base = join(root, 'packs');
  await mkPack(base, 'public', 'probe-pack', GOOD_MANIFEST, ENTRY_OK);
  await mkPack(base, 'local', 'loose-pack', { ...GOOD_MANIFEST, name: 'loose-pack' }, ENTRY_OK.replace(/probe-pack/g, 'loose-pack'));
  const prev = process.cwd();
  process.chdir(root);
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await main(['packs']);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  const text = out.join('\n');
  assert.match(text, /public - probe-pack/);
  assert.match(text, /local - loose-pack/);
  assert.match(text, /1 attacks/);
  assert.equal(process.exitCode, undefined);
});

async function withCwd(root, fn) {
  const prev = process.cwd();
  const out = [];
  const orig = console.log;
  const origErr = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await fn();
  } finally {
    console.log = orig;
    console.error = origErr;
    process.chdir(prev);
  }
  return out.join('\n');
}

test('CLI: packs add scaffolds a LOCAL pack that the loader immediately discovers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-add-'));
  await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['packs', 'add', 'vant-brain']);
  });
  const manifest = JSON.parse(await readFile(join(root, 'packs', 'local', 'vant-brain', 'pack.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.name, 'vant-brain');
  assert.equal(manifest.entry, 'index.js');
  // Privacy: the gitignore owns local-pack reality.
  assert.match(await readFile(join(root, '.gitignore'), 'utf8'), /^packs\/local\/$/m);
  // The stub must be contract-valid right out of the box (loader round-trip).
  const packs = await loadPacks([join(root, 'packs')]);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].visibility, 'local');
  assert.equal(packs[0].manifest.name, 'vant-brain');
  assert.equal(packs[0].module.attacks[0].name, 'first-attack');
});

test('CLI: packs add --public lands in packs/public and is NOT gitignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-add-pub-'));
  await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['packs', 'add', 'shared-shapes', '--public']);
  });
  assert.ok((await readFile(join(root, 'packs', 'public', 'shared-shapes', 'pack.json'), 'utf8')).length > 0);
  try { await readFile(join(root, '.gitignore'), 'utf8'); assert.fail('public add must not create .gitignore'); } catch (e) { assert.equal(e.code, 'ENOENT'); }
  const packs = await loadPacks([join(root, 'packs')]);
  assert.equal(packs[0].visibility, 'public');
});

test('CLI: packs add refuses existing dirs and non-kebab-case names LOUDLY', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-add-col-'));
  await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['packs', 'add', 'dupe-me']);
  });
  process.exitCode = undefined;
  const dupeOut = await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['packs', 'add', 'dupe-me']);
  });
  assert.equal(process.exitCode, 1);
  assert.match(dupeOut, /already exists/);
  process.exitCode = undefined; // CLI-refuse tests must not leak the refuse-exit into the runner's own status
  const bad = await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['packs', 'add', 'Nope!']);
  });
  assert.equal(process.exitCode, 1);
  assert.match(bad, /kebab-case/);
  process.exitCode = undefined;
});

test('CLI: init scaffolds packs the loader loads OUT OF THE BOX (issue #16 pin)', async () => {
  // The bug this pins: init wrote manifest stubs declaring entry 'index.js'
  // without writing one - the very next `run`/`packs` hard-failed until the
  // user deleted the scaffold. Init must scaffold the same honest stub
  // `packs add` writes, and it must survive a full loader round-trip.
  const root = await mkdtemp(join(tmpdir(), 'packs-init-'));
  await withCwd(root, async () => {
    process.exitCode = undefined;
    await main(['init']);
  });
  process.exitCode = undefined;
  const packs = await loadPacks([join(root, 'packs')]);
  const scaffolded = packs
    .map((p) => [p.visibility, p.manifest.name, p.module.attacks[0]?.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
  assert.deepEqual(scaffolded, [
    ['public', 'my-pack', 'first-attack'],
    ['local', 'my-private-pack', 'first-attack'],
  ]);
});

// ---- env claims (issue #12): manifest-declared binding prerequisites ----

test('validateEnvClaims: shapes validate loudly, normalized copy comes back', () => {
  const good = { d1: { DB: { tables: ['charges', 'settings'] } }, kv: { UPLOADS: {} }, routes: ['charge'], seed: {} };
  assert.deepEqual(validateEnvClaims(good, 'x'), good);
  // loud on every wrong shape - a silent claim was never there
  assert.throws(() => validateEnvClaims([], 'x'), /claims must be an object/);
  assert.throws(() => validateEnvClaims({ nope: {} }, 'x'), /unrecognized claim "nope"/);
  assert.throws(() => validateEnvClaims({ d1: { 'bad name': {} } }, 'x'), /binding names must match/);
  assert.throws(() => validateEnvClaims({ d1: { DB: 'str' } }, 'x'), /"d1\[DB\]" must be an object/);
  assert.throws(() => validateEnvClaims({ d1: { DB: { junk: 1 } } }, 'x'), /accepts only "tables"/);
  assert.throws(() => validateEnvClaims({ d1: { DB: { tables: 'x' } } }, 'x'), /array of table names/);
  assert.throws(() => validateEnvClaims({ d1: { DB: { tables: [''] } } }, 'x'), /array of table names/);
  assert.throws(() => validateEnvClaims({ kv: { NS: { prop: 1 } } }, 'x'), /empty object for now/);
  assert.throws(() => validateEnvClaims({ routes: 'charge' }, 'x'), /array of route names/);
  assert.throws(() => validateEnvClaims({ seed: { nope: {} } }, 'x'), /not a seed kind/);
  assert.throws(() => validateEnvClaims({ seed: { d1: { DB: { t: { rows: 'no' } } } } }, 'x'), /rows" must be an array of row objects/);
  assert.throws(() => validateEnvClaims({ seed: { d1: { DB: { t: { rows: [], uniques: 'x' } } } } }, 'x'), /uniques" must be an object/);
  // tables-less d1 claims normalize to {}
  assert.deepEqual(validateEnvClaims({ d1: { DB: {} } }, 'x').d1, { DB: {} });
  // the manifest-level pass-through: unsigned stays undefined
  assert.equal(validatePackManifest(GOOD_MANIFEST, 'x').env, undefined);
  assert.deepEqual(validatePackManifest({ ...GOOD_MANIFEST, env: { kv: { K: {} } } }, 'x').env, { d1: {}, kv: { K: {} }, routes: [], seed: {} });
});

test('loadPacks: pointing at ONE pack dir loads exactly it (docs "one pack dir only" shape)', async () => {
  // This shape shipped in the docs before the loader could honor it - the
  // fix lets a run root aim packs: straight at a single pack, visibility
  // inherited from the path (public/ + local/) or "inline" for arbitrary dirs.
  const root = await mkdtemp(join(tmpdir(), 'packs-one-'));
  await mkPack(root, 'public', 'probe-pack', GOOD_MANIFEST, ENTRY_OK);
  await mkPack(root, 'public', 'second-pack', { ...GOOD_MANIFEST, name: 'second-pack' }, ENTRY_OK.replace(/probe-pack/g, 'second-pack'));
  const one = await loadPacks([join(root, 'public', 'probe-pack')]);
  assert.deepEqual(one.map((p) => [p.origin, p.visibility]), [['public/probe-pack', 'public']], 'exactly the aimed-at pack loads');
  // Inline dirs (no public/local in the path) still load, labeled "inline".
  const inlineRoot = await mkdtemp(join(tmpdir(), 'packs-inline-'));
  const inlineDir = join(inlineRoot, 'some', 'vendored', 'inline-pack');
  await mkdir(inlineDir, { recursive: true });
  await writeFile(join(inlineDir, 'pack.json'), JSON.stringify({ ...GOOD_MANIFEST, name: 'inline-pack', description: 'vendored' }), 'utf8');
  await writeFile(join(inlineDir, 'index.js'), ENTRY_OK.replace(/probe-pack/g, 'inline-pack'));
  const inline = await loadPacks([inlineDir]);
  assert.deepEqual(inline.map((p) => [p.origin, p.visibility]), [['inline/inline-pack', 'inline']], 'arbitrary-dir packs label as inline');
});

test('evaluatePackEnv: only the UNMET rows come back, names render compactly', () => {
  const db = new FakeD1({ tables: { charges: { rows: [] } } });
  const check = { env: { DB: db }, routeNames: ['charge'] };
  const claims = { env: { d1: { DB: { tables: ['charges', 'settings'] } }, kv: { GHOST: {} }, routes: ['charge', 'absent'] } };
  const rows = evaluatePackEnv(claims, check);
  assert.deepEqual(rows.map(renderPrerequisite), ['d1[DB:settings]', 'kv[GHOST]', 'route[absent]']);
  // a missing binding names the whole binding, not per-table ghosts
  assert.deepEqual(
    evaluatePackEnv({ env: { d1: { NOD: {} } } }, check).map((r) => r.detail),
    ['no d1 binding "NOD" in the run root'],
  );
  // satisfied claims -> zero rows; unchecked (null) still rows, flagged false
  assert.equal(evaluatePackEnv({ env: { d1: { DB: {} } } }, check).length, 0);
  assert.ok(evaluatePackEnv(claims, null).every((r) => r.checked === false));
  assert.equal(renderEnvClaims(claims.env), 'd1[DB: charges, settings], kv[GHOST], routes[charge, absent]');
  assert.equal(renderEnvClaims(null), '');
});

test('loadPacks: prerequisites attach with a check context, stay absent without one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-env-'));
  await mkPack(join(root, 'packs'), 'public', 'claiming', { ...GOOD_MANIFEST, env: { d1: { DB: { tables: ['charges'] } }, routes: ['charge'] } }, ENTRY_OK);
  const unchecked = await loadPacks([join(root, 'packs')]);
  assert.equal('prerequisites' in unchecked[0], false);
  const checked = await loadPacks([join(root, 'packs')], new Map(), { env: {}, routeNames: [] });
  assert.deepEqual(checked[0].prerequisites.map(renderPrerequisite), ['d1[DB]', 'route[charge]']);
});

test('applyPackSeed: kv absent-or-identical, d1 seed tables NEW only, no counter ticks', () => {
  const counter = newBackendCounter();
  const pack = (seed) => [{ manifest: { name: 'seed-pack', env: { seed } } }];

  // kv: absent keys set (non-strings JSON-stringify like buildEnv)
  const kv = new FakeKV('UPLOADS');
  applyPackSeed(pack({ kv: { UPLOADS: { canary: 'v1', obj: { a: 1 } } } }), { UPLOADS: kv });
  assert.equal(kv._store.get('canary')?.value, 'v1');
  assert.equal(kv._store.get('obj')?.value, JSON.stringify({ a: 1 }));
  // identical values are a no-op (idempotent re-apply)
  applyPackSeed(pack({ kv: { UPLOADS: { canary: 'v1', obj: { a: 1 } } } }), { UPLOADS: kv });
  assert.equal(kv._store.get('canary')?.value, 'v1');
  // differing values fail loudly, naming the pack + binding + key
  const other = new FakeKV('UPLOADS');
  other._store.set('canary', { value: 'run-root-wrote-this', metadata: null, expiresAt: null });
  assert.throws(
    () => applyPackSeed(pack({ kv: { UPLOADS: { canary: 'v1' } } }), { UPLOADS: other }),
    /pack "seed-pack" env\.seed: kv\[UPLOADS\]\.canary .* with different content/,
  );
  // a missing binding is an unmet prerequisite - seeds never invent one
  assert.doesNotThrow(() => applyPackSeed(pack({ kv: { GHOST: { k: 1 } } }), {}));

  // d1: seed tables are NEW tables carrying FakeD1's own row/uniques shape
  const db = new FakeD1({ tables: {}, counter });
  const seedPack = pack({ d1: { DB: { gadgets: { rows: [{ id: 3, name: 'g' }], uniques: { name_unique: ['name'] } } } } });
  applyPackSeed(seedPack, { DB: db });
  const t = db._t.get('gadgets');
  assert.deepEqual(t.rows, [{ id: 3, name: 'g' }]);
  assert.equal(t.nextId, 4); // derives exactly like the FakeD1 constructor
  assert.deepEqual([...t.uniques.get('name_unique')], ['name']);
  // seeds tick NO counters - fixture state, not requests
  assert.equal(counter.count('d1.query'), 0);
  // an existing table fails loudly - the run root owns its own tables
  assert.throws(
    () => applyPackSeed(seedPack, { DB: db }),
    /d1\[DB\]\[gadgets\] is already declared by the run root - env\.seed may not extend run-root tables/,
  );
});

test('CLI: packs (no config) renders the claims line; packs --config evaluates UNMET against the wired harness', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-claims-'));
  const base = join(root, 'packs');
  await mkPack(base, 'public', 'claiming', {
    ...GOOD_MANIFEST,
    env: { d1: { DB: { tables: ['charges'] } }, kv: { MISSING_KV: {} }, routes: ['charge', 'absent'] },
  }, ENTRY_OK);
  await writeFile(join(root, 'crashtest.config.js'),
    `export default {
      routes: { charge: async () => new Response('ok') },
      env: { d1: { DB: { tables: { charges: { rows: [] } } } } },
    };\n`);
  const noCfg = await withCwd(root, async () => { process.exitCode = undefined; await main(['packs']); });
  assert.match(noCfg, /claims d1\[DB: charges\], kv\[MISSING_KV\]/);
  assert.doesNotMatch(noCfg, /UNMET/);; // no harness -> claims are display-only
  const withCfg = await withCwd(root, async () => { process.exitCode = undefined; await main(['packs', '--config', 'crashtest.config.js']); });
  assert.match(withCfg, /claims d1\[DB: charges\], kv\[MISSING_KV\]/);
  assert.match(withCfg, /prerequisites UNMET - kv\[MISSING_KV\], route\[absent\]/);
});

test('CLI: run --module-plan prints the unmet env-claim row per pack (pure dry-run)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'packs-plan-'));
  await mkPack(join(root, 'packs'), 'public', 'claiming', { ...GOOD_MANIFEST, name: 'claiming', env: { kv: { MISSING_KV: {} } } }, ENTRY_OK.replace(/probe-pack/g, 'claiming'));
  await writeFile(join(root, 'crashtest.config.js'), "export default { };\n");
  const text = await withCwd(root, async () => { process.exitCode = undefined; await main(['run', '--module-plan', '--json']); });
  assert.match(text, /pack claiming \[public\/claiming\]: 1 env claim\(s\) unmet \(kv\[MISSING_KV\]\)/);
  const lines = text.split('\n');
  const plan = JSON.parse(lines[lines.length - 1]);
  const row = plan.packs.find((p) => p.name === 'claiming');
  assert.deepEqual(row.prerequisites.map(renderPrerequisite), ['kv[MISSING_KV]']);
  // env claims do NOT flip attack statuses - WILL-FIRE stays, the skip question is runtime
  assert.equal(row.prerequisites.length, 1);
});

// ---- edge-walk teeth: pack-level plan facts resolve by ORIGIN, not module-name equality ----

test('pack: a module may ship a scenario name of its own - the plan still honors the manifest armedByKey via the pack ORIGIN', async () => {
  // A pack manifest name and its entry module's scenario name are TWO
  // contracts (the pack name is dir-parity, the module name is scenario
  // contract); a module may legitimately differ (shared entries, bundled
  // plugins). Equality was never a loader rule - but plans must not MISS
  // pack-level facts because of it: buildModulePlan resolves armedByKey
  // through the pack ORIGIN (pack-loaded scenarios' origins ARE pack origins).
  const root = await mkdtemp(join(tmpdir(), 'packs-parity-'));
  const mismatch = "export default { name: 'other-ships-name', description: 'd', attacks: [{ name: 'a', description: 'p', async run() { return { verdict: 'REFUSED', detail: 'held' }; } }] };\n";
  await mkPack(root, 'public', 'pack-ships-name', { ...GOOD_MANIFEST, name: 'pack-ships-name', armedByKey: 'pack-ships-name' }, mismatch);
  const loaded = await loadPacks([root]);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].module.name, 'other-ships-name');

  const { buildModulePlan } = await import('../src/plans.js');
  const scenarios = loaded.map((p) => ({ origin: p.origin, module: p.module }));
  // No moduleCtx: the manifest says NEEDS-ARMING, and the ORIGIN-keyed
  // pack lookup must find it (a module-name lookup would silently miss and
  // mark WILL-FIRE - the exact overstate the plan exists to prevent).
  const planUnarmed = buildModulePlan({ moduleCtx: {} }, loaded, scenarios);
  assert.equal(planUnarmed.modules[0].status, 'NEEDS-ARMING');
  assert.equal(planUnarmed.modules[0].armedKey, 'pack-ships-name');
  // Armed through the pack name: WILL-FIRE resolves the same way.
  const planArmed = buildModulePlan({ moduleCtx: { 'pack-ships-name': { k: 1 } } }, loaded, scenarios);
  assert.equal(planArmed.modules[0].status, 'WILL-FIRE');
});
