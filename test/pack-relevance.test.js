// The ignore mechanism (relevance, not a deny-list). Tests pin the loader
// contract: `requires`/`provides` skip a pack before import (honestly, never
// silently), `ignore`/`.packignore` override relevance, and a run root that
// declares nothing behaves exactly as before (no accidental skips).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPacks, validatePackManifest } from '../src/packs/loader.js';
import { relevanceSkip, globMatch, parsePackignore, normalizeTokens, validateRequires } from '../src/packs/relevance.js';

const ENTRY = (name) => `export default { name: '${name}', description: 'probe', attacks: [{ name: 'x', description: 'probe', async run() { return { verdict: 'REFUSED', detail: 'held' }; } }] };\n`;

async function mkPack(root, name, manifest, entryBody) {
  const dir = join(root, 'public', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify({ schemaVersion: 1, description: 'probe pack', ...manifest }, null, 2) + '\n');
  await writeFile(join(dir, 'index.js'), entryBody ?? ENTRY(name));
  return dir;
}

test('validateRequires: kebab tokens, unique, loud on anything else', () => {
  assert.equal(validateRequires(undefined, 'x'), undefined);
  assert.deepEqual(validateRequires(['wordpress', 'd1'], 'x'), ['wordpress', 'd1']);
  assert.throws(() => validateRequires('wordpress', 'x'), /must be an array/);
  assert.throws(() => validateRequires(['WordPress'], 'x'), /kebab-case/);
  assert.throws(() => validateRequires(['a', 'a'], 'x'), /lists "a" twice/);
});

test('validatePackManifest: requires rides the validated manifest (normalized), and is rejected when malformed', () => {
  const m = validatePackManifest({ schemaVersion: 1, name: 'p', description: 'd', requires: ['wordpress'] }, 'public/p');
  assert.deepEqual(m.requires, ['wordpress']);
  assert.throws(() => validatePackManifest({ schemaVersion: 1, name: 'p', description: 'd', requires: [1] }, 'public/p'), /requires/);
});

test('globMatch: `*` is the only metacharacter; everything else is literal', () => {
  assert.equal(globMatch('wp-*', 'wp-roles'), true);
  assert.equal(globMatch('wp-*', 'next-shapes'), false);
  assert.equal(globMatch('*', 'anything'), true);
  assert.equal(globMatch('exact', 'exact'), true);
  assert.equal(globMatch('exact', 'exactly'), false);
  // A regex metacharacter in the pattern is literal, not a wildcard.
  assert.equal(globMatch('a.b', 'axb'), false);
  assert.equal(globMatch('a.b', 'a.b'), true);
});

test('parsePackignore: one token per line, # comments, blank lines, surrounding whitespace', () => {
  const tokens = parsePackignore('\n# comment\nwp-*\n\n  next-middleware-shapes  # trailing\n');
  assert.deepEqual(tokens, ['wp-*', 'next-middleware-shapes']);
});

test('normalizeTokens: loud on a non-array or a non-string entry', () => {
  assert.deepEqual(normalizeTokens(undefined, 'provides'), []);
  assert.deepEqual(normalizeTokens(['a', ' b '], 'provides'), ['a', 'b']);
  assert.throws(() => normalizeTokens('a', 'provides'), /must be an array/);
  assert.throws(() => normalizeTokens([1], 'provides'), /non-empty strings/);
});

test('relevanceSkip: requires unmet -> skip; provided -> relevant; empty provides -> never filters', () => {
  const pack = { name: 'wp-roles', origin: 'public/wp-roles', manifest: { requires: ['wordpress'] } };
  assert.equal(relevanceSkip(pack, { provides: ['wordpress'] }), null);
  assert.equal(relevanceSkip(pack, { provides: [] }), null, 'a run root declaring nothing is not participating - no silent skip');
  assert.deepEqual(relevanceSkip(pack, { provides: ['node'] }), { reason: 'unmet-requires', detail: 'requires wordpress - target provides node' });
  assert.equal(relevanceSkip({ name: 'cve-feed', origin: 'public/cve-feed', manifest: {} }, { provides: ['node'] }), null, 'a pack with no requires is always relevant');
});

test('relevanceSkip: ignore wins over relevance, and matches by name or origin with globs', () => {
  const pack = { name: 'wp-roles', origin: 'public/wp-roles', manifest: { requires: ['wordpress'] } };
  assert.equal(relevanceSkip(pack, { provides: ['wordpress'], ignore: ['wp-*'] }).reason, 'ignored');
  assert.equal(relevanceSkip(pack, { provides: ['wordpress'], ignore: ['public/wp-roles'] }).reason, 'ignored', 'origin match');
  assert.equal(relevanceSkip(pack, { provides: ['wordpress'], ignore: ['other'] }), null);
});

test('loadPacks: a requires pack whose capability is provided LOADS; unmet SKIPS and is named, never imported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rel-'));
  await mkPack(root, 'wp-roles', { name: 'wp-roles', requires: ['wordpress'] });
  await mkPack(root, 'cve-feed', { name: 'cve-feed' });
  const skipped = [];
  const packs = await loadPacks([root], new Map(), null, { provides: ['node'], skipped });
  assert.deepEqual(packs.map((p) => p.manifest.name), ['cve-feed']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].manifest.name, 'wp-roles');
  assert.equal(skipped[0].skipped.reason, 'unmet-requires');
  assert.match(skipped[0].skipped.detail, /wordpress/);
});

test('loadPacks: a skipped pack is NEVER imported (a broken entry under an unmet requires cannot fail the run)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rel-skip-'));
  // The entry does not exist - if the loader imported it, the run would fail.
  const dir = await mkPack(root, 'wp-roles', { name: 'wp-roles', requires: ['wordpress'] }, 'export default {};\n');
  await writeFile(join(dir, 'index.js'), 'this is not valid javascript !!!');
  const skipped = [];
  const packs = await loadPacks([root], new Map(), null, { provides: ['node'], skipped });
  assert.deepEqual(packs, []);
  assert.equal(skipped.length, 1);
});

test('loadPacks: ignore by config token skips a pack even when its requires is satisfied', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rel-ignore-'));
  await mkPack(root, 'wp-roles', { name: 'wp-roles', requires: ['wordpress'] });
  const skipped = [];
  const packs = await loadPacks([root], new Map(), null, { provides: ['wordpress'], ignore: ['wp-*'], skipped });
  assert.deepEqual(packs, []);
  assert.equal(skipped[0].skipped.reason, 'ignored');
});

test('loadPacks: no provides and no ignore -> byte-identical behavior (every pack loads)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rel-none-'));
  await mkPack(root, 'wp-roles', { name: 'wp-roles', requires: ['wordpress'] });
  await mkPack(root, 'cve-feed', { name: 'cve-feed' });
  const packs = await loadPacks([root]);
  assert.deepEqual(packs.map((p) => p.manifest.name), ['cve-feed', 'wp-roles']);
});

test('loadPacks: a skipped pack is still manifest-validated (a broken manifest stays a loud config error)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rel-bad-'));
  const dir = join(root, 'public', 'wp-roles');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify({ schemaVersion: 1, name: 'wp-roles', description: 'd', requires: ['WordPress'] }));
  await writeFile(join(dir, 'index.js'), ENTRY('wp-roles'));
  await assert.rejects(() => loadPacks([root], new Map(), null, { provides: ['node'] }), /requires/);
});
