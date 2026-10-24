// packstruct-backfill - the offline self-audit fixture backfill, PREPARED
// before packstruct v1 is addressable (ask #2 of the packstruct#1 adoption
// notice; sequencing recorded in dhaupin/crashtest#20: fixtures transcribe,
// never invent). Four pins live here:
//
//   1. TRANSCRIPTION - the committed corpus.json is byte-equal to the real
//      shipped packs/public/*/pack.json files. A pack change that does not
//      regenerate the corpus fails HERE, loudly.
//   2. CONFORMANCE - conformance-rows.json re-derives true against the same
//      live bytes (the frozen-v1 column follows the data, never the reverse).
//   3. THE MATRIX - every refusal/acceptance row in refusal-matrix.json
//      reproduces against the engine validator, and every row still carries
//      its specKey: null placeholder (filling one later is a deliberate,
//      reviewed act - the assert names the rule).
//   4. THE CENSUS - the 44-ids / zero-collisions receipt from dhaupin/crashtest#19
//      re-verified LIVE against the library (49 attacks / 14 modules), so the
//      corpus receipt cannot go stale without failing here.
//
// Zero sockets, zero network: everything reads the repo's own files.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPacks, validatePackManifest } from '../src/packs/loader.js';
import { loadScenarios } from '../src/scenarios/loader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const BACKFILL = join(REPO, 'labs', 'packstruct-backfill');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function liveManifestBytes() {
  const names = (await readdir(join(REPO, 'packs', 'public'), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const bytes = new Map();
  for (const name of names) {
    try {
      bytes.set(name, await readFile(join(REPO, 'packs', 'public', name, 'pack.json'), 'utf8'));
    } catch {
      /* not a pack dir (same WIP rule as the loader) */
    }
  }
  return bytes;
}

// ---- 1. TRANSCRIPTION -----------------------------------------------------

test('cut: dataset packstruct-backfill corpus.json transcribes the shipped pack manifests byte-equal', async () => {
  const corpus = await readJson(join(BACKFILL, 'corpus.json'));
  const live = await liveManifestBytes();
  assert.equal([...live.keys()].length, corpus.packCount, 'mine: pack dir set changed on disk - regenerate corpus.json and review the diff');
  for (const pack of corpus.packs) {
    const actual = live.get(pack.name);
    assert.ok(actual !== undefined, `census: corpus lists unloaded pack "${pack.name}"`);
    assert.equal(actual, pack.manifestJson, `mine: pack "${pack.name}/pack.json" drifted from the committed corpus - regenerate (node labs/packstruct-backfill/build.mjs) and review`);
    assert.equal(createHash('sha256').update(actual).digest('hex'), pack.sha256, `mine: sha256 mismatch for "${pack.name}"`);
  }
});

// ---- 2. CONFORMANCE -------------------------------------------------------

test('cut: dataset packstruct-backfill conformance rows re-derive true against the live corpus bytes', async () => {
  const corpus = await readJson(join(BACKFILL, 'corpus.json'));
  const rows = (await readJson(join(BACKFILL, 'conformance-rows.json'))).rows;
  const HOST_OWNED = ['env', 'plugins', 'package'];
  const derived = [];
  for (const pack of corpus.packs) {
    const manifest = JSON.parse(pack.manifestJson);
    const entry = manifest.entry ?? 'index.js';
    let entryFileIsPresent;
    try {
      await readFile(join(REPO, pack.dir, entry), 'utf8');
      entryFileIsPresent = true;
    } catch {
      entryFileIsPresent = false;
    }
    derived.push({
      name: pack.name,
      dir: pack.dir,
      sha256: pack.sha256,
      declaredKeys: Object.keys(manifest).sort(),
      facts: {
        schemaVersionIs1: manifest.schemaVersion === 1,
        nameEqualsDir: manifest.name === pack.name,
        declaredEntry: manifest.entry ?? undefined,
        entryFileIsPresent,
        declaresArmedByKey: manifest.armedByKey !== undefined,
        hostOwnedKeysPresent: HOST_OWNED.filter((k) => manifest[k] !== undefined),
      },
    });
  }
  assert.deepEqual(rows, derived, 'mine: conformance facts drifted from the corpus bytes - regenerate and review');
  for (const r of rows) {
    assert.equal(r.facts.schemaVersionIs1, true, `mine: "${r.name}" must be schemaVersion 1`);
    assert.equal(r.facts.nameEqualsDir, true, `mine: "${r.name}" must equal its directory`);
    assert.equal(r.facts.entryFileIsPresent, true, `mine: "${r.name}" declared entry must exist on disk`);
  }
  // The audit-fresh column (crashtest#19 / #20 receipts): armedByKey on ONE
  // pack, host-owned keys on ZERO shipped packs today.
  assert.equal(rows.filter((r) => r.facts.declaresArmedByKey).length, 1);
  assert.equal(rows.filter((r) => r.facts.hostOwnedKeysPresent.length > 0).length, 0);
});

// ---- 3. THE MATRIX --------------------------------------------------------

function applySetup(setup, base) {
  if ('whole' in setup) return JSON.parse(JSON.stringify(setup.whole));
  const m = { ...base };
  for (const k of setup.drop ?? []) delete m[k];
  return { ...m, ...(setup.set ?? {}) };
}

test('cut: matrix packstruct-backfill every refusal/acceptance row reproduces against the real validator', async () => {
  const matrix = await readJson(join(BACKFILL, 'refusal-matrix.json'));
  const corpus = await readJson(join(BACKFILL, 'corpus.json'));
  const base = JSON.parse(corpus.packs.find((p) => p.name === matrix.base).manifestJson);
  assert.ok(base, `mine: matrix base "${matrix.base}" must be a corpus pack`);

  const seen = new Set();
  for (const row of matrix.rows) {
    assert.ok(!seen.has(row.id), `mine: duplicate matrix row id "${row.id}"`);
    seen.add(row.id);
    // The specKey gate (sequencing, crashtest#20): null meant "SPEC not
    // addressable yet". SPEC v1 became addressable on 2026-10-24 and the
    // fill landed deliberately against the committed transcript
    // (SPEC-v1.md, pinned SHA), so null or an off-grammar key is now a
    // regression - the same-review rule turned the other way.
    assert.equal(
      typeof row.specKey === 'string' && /^§\d+(\/[^/]+)+$/.test(row.specKey),
      true,
      `specKey on "${row.id}" must cite the SPEC v1 vocabulary (grammar "§<section>/<term>[/<term>...]", resolved against labs/packstruct-backfill/SPEC-v1.md); null was the pre-addressable placeholder and is a regression now`,
    );
    assert.ok(row.hostRule?.length > 0, `mine: "${row.id}" must cite the engine rule it derives from`);

    const candidate = applySetup(row.setup, base);
    if (row.kind === 'refuse') {
      assert.throws(
        () => validatePackManifest(candidate, `template-canvas/${row.id}`),
        (err) => err.message.includes(row.throwsIncludes),
        `mine: row "${row.id}" no longer refuses with "${row.throwsIncludes}" - the engine rule moved; re-derive the row the same way it was derived (from the NEW validator text)`,
      );
    } else if (row.kind === 'accept') {
      let out;
      try {
        out = validatePackManifest(candidate, `template-canvas/${row.id}`);
      } catch (err) {
        assert.fail(`mine: row "${row.id}" stopped passing (${err.message}) - the engine rule moved; re-derive`);
      }
      for (const [k, v] of Object.entries(row.expect ?? {})) {
        if (k === 'envNormalized') assert.deepEqual(out.env, v, `mine: "${row.id}" normalized env drifted`);
        else assert.deepEqual(out[k], v, `mine: "${row.id}" expected.${k} drifted`);
      }
    } else {
      assert.fail(`mine: row "${row.id}" has unknown kind "${row.kind}"`);
    }
  }
});

test('cut: matrix packstruct-backfill every specKey resolves against the committed SPEC v1 transcript (pinned, never memory)', async () => {
  const matrix = await readJson(join(BACKFILL, 'refusal-matrix.json'));
  assert.match(
    matrix.spec?.source ?? '',
    /b0e305034c974ad133b83e3b1c3cb27094d1de46/,
    'the pinned packstruct SHA on record moved or is missing - bump it ONLY with a re-transcribed SPEC-v1.md and a re-derived specKey review in the same commit (check: node labs/packstruct-backfill/verify-spec.mjs node_modules/packstruct)',
  );
  const spec = await readFile(join(BACKFILL, 'SPEC-v1.md'), 'utf8');
  assert.ok(spec.startsWith('# The packstruct spec, version 1\n'), 'the committed transcript is not SPEC v1 - re-transcribe from the pinned clone, never hand-edit');

  // Split the transcript into sections by its "## N. " headings, then
  // resolve every specKey both structurally (section exists, grammar) and
  // textually (each /term appears verbatim in that section) - a specKey
  // can only ever point at vocabulary the spec actually says.
  const starts = [...spec.matchAll(/^## (\d+)\. /gm)].map((m) => ({ n: Number(m[1]), at: m.index }));
  starts.sort((a, b) => a.n - b.n);
  const sectionText = (n) => {
    const i = starts.findIndex((s) => s.n === n);
    if (i === -1) return null;
    return spec.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : spec.length);
  };
  for (const row of matrix.rows) {
    const m = /^§(\d+)((?:\/[^/]+)+)$/.exec(row.specKey);
    assert.ok(m, `spec: "${row.id}" - specKey "${row.specKey}" does not match the §<section>/<term> grammar`);
    const [, sectionId, termsRaw] = m;
    const text = sectionText(Number(sectionId));
    assert.ok(text !== null, `spec: "${row.id}" - SPEC has no section ${sectionId} (SPEC-v1.md sections: ${starts.map((s) => s.n).join(', ')})`);
    for (const term of termsRaw.split('/').filter(Boolean)) {
      assert.ok(
        text.includes(term),
        `spec: "${row.id}" - term "${term}" does not appear in SPEC section ${sectionId} of the committed transcript - never point a specKey at vocabulary the spec does not actually say (re-read SPEC-v1.md and re-derive the key)`,
      );
    }
  }
});

// ---- loader-level rows (they need a filesystem to refuse at) ---------------

async function mkPack(root, visibility, name, manifest, entryBody) {
  const dir = join(root, visibility, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (entryBody !== undefined) await writeFile(join(dir, manifest.entry ?? 'index.js'), entryBody);
  return dir;
}

const LOAD_OK = { schemaVersion: 1, name: 'load-probe', description: 'probe', entry: 'index.js' };
const LOAD_ENTRY = "export default { name: 'load-probe', description: 'probe', attacks: [{ name: 'load-probe-attack', description: 'probe', async run() { return { verdict: 'REFUSED', detail: 'held' }; } }] };\n";

test('hit: load-level refusals - unreadable JSON fails the run loudly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backfill-load1-'));
  await mkdir(join(root, 'public', 'broken'), { recursive: true });
  await writeFile(join(root, 'public', 'broken', 'pack.json'), '{ oh no');
  await assert.rejects(() => loadPacks([root]), (err) => err.message.includes('is unreadable JSON'));
  await rm(root, { recursive: true, force: true });
});

test('hit: load-level refusals - cross-surface pack name collision fails with both origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backfill-load2-'));
  await mkPack(root, 'public', 'dup-pack', { ...LOAD_OK, name: 'dup-pack' }, LOAD_ENTRY.replace(/load-probe/g, 'dup-pack'));
  await mkPack(root, 'local', 'dup-pack', { ...LOAD_OK, name: 'dup-pack' }, LOAD_ENTRY.replace(/load-probe/g, 'dup-pack'));
  await assert.rejects(() => loadPacks([root]), (err) => err.message.includes('loaded from both'));
  await rm(root, { recursive: true, force: true });
});

test('hit: load-level refusals - un-importable entry names the pack and wraps the cause', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backfill-load3-'));
  await mkPack(root, 'public', 'throwing-pack', LOAD_OK, 'throw new Error("entry boom");\n');
  await assert.rejects(
    () => loadPacks([root]),
    (err) => err.message.includes('failed to import') && err.message.includes('public/throwing-pack') && err.message.includes('entry boom'),
  );
  await rm(root, { recursive: true, force: true });
});

// ---- 4. THE CENSUS (crashtest#19 receipt, re-verified live) -----------------

test('cut: census shipped packs contribute 8 modules / 36 attack ids (44 ids total) with ZERO collisions pack-vs-pack and pack-vs-library', async () => {
  const corpus = await readJson(join(BACKFILL, 'corpus.json'));
  const modNames = new Set();
  const attackNames = new Set();
  let packAttacks = 0;
  for (const pack of corpus.packs) {
    const manifest = JSON.parse(pack.manifestJson);
    const modPath = join(REPO, pack.dir, manifest.entry ?? 'index.js');
    const mod = (await import(pathToFileURL(modPath).href)).default;
    assert.ok(modNames.has(mod.name) === false, `census: pack module name "${mod.name}" collides with another pack`);
    modNames.add(mod.name);
    for (const a of mod.attacks ?? []) {
      assert.ok(attackNames.has(a.name) === false, `census: pack attack id "${a.name}" collides (${pack.name}/${mod.name})`);
      attackNames.add(a.name);
      packAttacks += 1;
    }
  }

  const library = await loadScenarios();
  const libModules = new Set();
  for (const { module } of library) {
    assert.ok(!modNames.has(module.name), `census: pack module "${module.name}" collides with a library module`);
    libModules.add(module.name);
    for (const a of module.attacks) {
      assert.ok(!attackNames.has(a.name), `census: pack attack "${a.name}" collides with a library attack (${module.name})`);
    }
  }

  assert.equal(modNames.size, 8, 'count pin drifted silently: the shipped pack set changed without regenerating corpus.json - run node labs/packstruct-backfill/build.mjs, review the diff, and move this constant (and the totals above) in the SAME commit as the pack change');
  assert.equal(
    packAttacks,
    36,
    'count pin: 44 ids total (8 pack modules + 36 pack attacks) per the #19 audit - a pack change moves this constant in the SAME commit (regenerate the corpus, re-run build + this file)',
  );
});
