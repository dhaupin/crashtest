// Packs — the extension surface (PRD §14). Tests pin the loader contract:
// schema validation fails loudly, name collisions across surfaces fail, and
// private (local) packs load exactly like public ones — nothing about
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
  await mkdir(join(root, 'public', 'wip-stuff'), { recursive: true }); // no manifest — WIP, skip
  await mkPack(root, 'public', 'broken', { name: 'broken', description: 'no schema' }); // missing schemaVersion
  await assert.rejects(() => loadPacks([root]), /missing "schemaVersion"/);
  await writeFile(join(root, 'public', 'broken', 'pack.json'), '{ oh no');
  await assert.rejects(() => loadPacks([root]), /unreadable JSON/);
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
  assert.match(text, /public — probe-pack/);
  assert.match(text, /local — loose-pack/);
  assert.match(text, /1 attacks/);
  assert.equal(process.exitCode, undefined);
});
