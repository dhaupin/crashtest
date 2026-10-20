// S1.2 — contract + loader + RNG tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScenario, refused, exploited, bounded, attackIds, fuzzFloorViolation,
} from '../../src/scenarios/contract.js';
import { loadScenarios } from '../../src/scenarios/loader.js';
import { Rng, mixSpreadSeeds } from '../../src/rng.js';

const validScenario = {
  name: 'demo',
  description: 'demo module',
  attacks: [
    { name: 'attack-a', async run() { return refused('ok'); } },
    { name: 'attack-b', async run() { return exploited('hit'); } },
  ],
};

test('validateScenario: happy path passes and returns the module', () => {
  assert.equal(validateScenario(validScenario), validScenario);
});

test('validateScenario: bad names, no attacks, dupes all fail loudly', () => {
  assert.throws(() => validateScenario({ ...validScenario, name: '!' }), /bad module name/);
  assert.throws(() => validateScenario({ ...validScenario, name: 'ok name' }), /bad module name/);
  assert.throws(() => validateScenario({ ...validScenario, attacks: [] }), /non-empty attacks/);
  assert.throws(() => validateScenario({
    ...validScenario,
    attacks: [validScenario.attacks[0], validScenario.attacks[0]],
  }), /duplicate attack name/);
  assert.throws(() => validateScenario({
    ...validScenario,
    attacks: [{ ...validScenario.attacks[0], run: 'not a function' }],
  }), /needs run/);
});

test('bounded refuses ownerless risks (principle 6)', () => {
  assert.throws(() => bounded('', 'some bound', 'detail'), /owner \+ bound/);
  const b = bounded('dhaupin', 'retry window closed', 'why');
  assert.equal(b.verdict, 'BOUNDED');
  assert.equal(b.owner, 'dhaupin');
});

test('attackIds enumerates module/attack keys', () => {
  assert.deepEqual(attackIds(validScenario), ['demo/attack-a', 'demo/attack-b']);
});

test('fuzzFloorViolation classifies thrown / 5xx / fine', () => {
  assert.match(fuzzFloorViolation({ threw: true, error: { name: 'TypeError', message: 'x is undefined' } }), /uncaught throw/);
  assert.equal(fuzzFloorViolation({ threw: false, status: 500 }), '5xx: 500');
  assert.equal(fuzzFloorViolation({ threw: false, status: 400 }), null);
  assert.match(fuzzFloorViolation(null), /no record/);
});

test('built-in scenario library loads and validates', async () => {
  const loaded = await loadScenarios();
  assert.ok(loaded.length >= 1);
  const names = loaded.map(l => l.module.name);
  assert.ok(names.includes('input'));
  const input = loaded.find(l => l.module.name === 'input').module;
  assert.ok(input.attacks.length >= 3);
  // Every loaded module already passed validation inside the loader — belt
  // and braces: assert ids well-formed.
  for (const l of loaded) {
    for (const id of attackIds(l.module)) assert.match(id, /\/[a-z0-9-]+$/);
  }
});

test('rng determinism: same seed, same sequence; mixed seeds differ per name', () => {
  // Draw independent sequences per seed, compare whole sequences — no
  // double-advance aliasing between the two compared generators.
  const draws = (seed, n) => { const r = new Rng(seed); return Array.from({ length: n }, () => r.next()); };
  const seqA = draws(42, 100);
  assert.deepEqual(seqA, draws(42, 100)); // same seed → identical stream
  assert.notDeepEqual(seqA, draws(43, 100)); // different seed → diverges (overwhelming odds)

  const r1 = new Rng(mixSpreadSeeds(7, 'input/never-fail-mutations'));
  const r2 = new Rng(mixSpreadSeeds(7, 'input/never-fail-mutations'));
  assert.equal(r1.int(0, 100), r2.int(0, 100));
  const r3 = new Rng(mixSpreadSeeds(7, 'input/oversized-field'));
  assert.notEqual(r3.int(0, 9999), r1.int(0, 9999));
  const list = [1, 2, 3, 4, 5];
  assert.deepEqual([...list].sort(), [...new Rng(9).shuffle(list)].sort());
});
