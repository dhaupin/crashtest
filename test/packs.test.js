// Packs - the extension surface (PRD section 14). Tests pin the loader contract:
// schema validation fails loudly, name collisions across surfaces fail, and
// private (local) packs load exactly like public ones - nothing about
// visibility changes semantics, only where files live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPacks, validatePackManifest } from '../src/packs/loader.js';
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
