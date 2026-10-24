// Pack self-audit fixtures (SPEC §4, crashtest#28): every shipped pack in
// packs/public/ must carry a hand-invocable self-audit fixture at
// test/fixtures/run.mjs that pins the pack's documented shape (manifest
// contract, attack inventory, id grammar, and per-pack data rules).
//
// This suite discovers every fixture and RUNS it, so a pack can never
// drop or wreck its fixture without a failing suite. The count pin here
// is the 8-shipped-pack census (AGENTS.md); adding a ninth pack means a
// NINTH fixture in the SAME commit - that is the pin wall doing its job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PUBLIC = new URL('../packs/public/', import.meta.url);

const PACK_COUNT = 8;
const EXPECTED_ATTACKS_TOTAL = 36;
const EXPECTED_FIXTURES = [
  'crashtest-site', 'cve-feed', 'wp-money-shapes', 'wp-roles',
  'wp-stock-smoke', 'next-middleware-shapes', 'vite-dev-shapes', 'qs-shapes',
];

// crashtest-site carries 18 of the 36; assert the SAME aggregate count the
// census transcribes so a fixture cannot shrink silently.
const EXPECTED_ATTACKS = {
  'crashtest-site': 18, 'wp-money-shapes': 3, 'cve-feed': 2,
  'next-middleware-shapes': 2, 'vite-dev-shapes': 2, 'qs-shapes': 2,
  'wp-roles': 3, 'wp-stock-smoke': 4,
};

test('packed-shape discovery: fixtures exist for every shipped pack (8/8)', async () => {
  const dirs = (await readdir(PUBLIC, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.equal(dirs.length, PACK_COUNT, `8 shipped packs pinned; found ${dirs.length}: ${dirs.join(', ')}`);
  assert.deepEqual(dirs, [...EXPECTED_FIXTURES].sort(), 'shipped-pack census changed - update this pin AND the per-pack fixture in the SAME commit');
  for (const pack of EXPECTED_FIXTURES) {
    const url = new URL(`${pack}/test/fixtures/run.mjs`, PUBLIC);
    let ok = false;
    try { await import(url.href); ok = true; } catch { /* reported below */ }
    assert.ok(ok, `pack ${pack} is missing its self-audit fixture (test/fixtures/run.mjs) - add it in the SAME commit as any pack change`);
  }
});

for (const pack of EXPECTED_FIXTURES) {
  test(`fixture runs clean: ${pack}`, async () => {
    const url = new URL(`${pack}/test/fixtures/run.mjs`, PUBLIC);
    const mod = await import(url.href);
    assert.equal(typeof mod.audit, 'function', `${pack}/test/fixtures/run.mjs must export audit()`);
    const result = await mod.audit();
    assert.equal(result.pack, pack, 'fixture must self-report its own pack name');
    assert.equal(result.attacks, EXPECTED_ATTACKS[pack], `${pack}: pinned attack count drifted from the census`);
  });
}

test('aggregate: transcribed attack inventory totals 36 across the 8 packs', () => {
  const total = Object.values(EXPECTED_ATTACKS).reduce((a, b) => a + b, 0);
  assert.equal(total, EXPECTED_ATTACKS_TOTAL);
  assert.equal(Object.keys(EXPECTED_ATTACKS).length, PACK_COUNT);
});
