// Snapshot-diff oracles (issue #13 blocker 2): the uniform store-diff shape
// that replaces the pack-by-pack hand-rolled comparators (vant measured at
// least four). Pins: row identity by id, structural fallback, table add/
// remove, KV keys, the mixed-store dispatch harness.snapshotStore() feeds,
// determinism (same inputs twice -> same output), and no counter ticks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffD1Snapshots, diffKvSnapshots, diffStoreSnapshots } from '../../src/harness/diff.js';
import { buildHarness } from '../../src/harness/harness.js';
import { newBackendCounter } from '../../src/harness/counters.js';

test('diffD1Snapshots: added/removed/changed rows by id, fields named, output sorted and copied', () => {
  const before = { notes: [{ id: 1, name: 'a' }, { id: 2, name: 'b', flag: false }] };
  const after = { notes: [{ id: 2, name: 'b', flag: true }, { id: 3, name: 'c' }, { id: 1, name: 'a' }] };
  const diff = diffD1Snapshots(before, after);
  assert.equal(diff.changed, true);
  const t = diff.tables.notes;
  assert.equal(t.status, 'changed');
  assert.deepEqual(t.added, [{ id: 3, name: 'c' }]);
  assert.deepEqual(t.removed, []);
  assert.deepEqual(t.changed, [{ before: { id: 2, name: 'b', flag: false }, after: { id: 2, name: 'b', flag: true }, fields: ['flag'] }]);
  // determinism: same inputs twice, byte-identical output
  assert.deepEqual(diffD1Snapshots(before, after), diff);
  // mutating the diff never reaches the snapshots
  t.added[0].name = 'mutated';
  assert.equal(after.notes.find((r) => r.id === 3).name, 'c');
});

test('diffD1Snapshots: table added/removed wholesale; structural fallback when rows lack ids', () => {
  const diff = diffD1Snapshots({ a: [{ id: 1 }] }, {});
  assert.equal(diff.tables.a.status, 'removed');
  assert.deepEqual(diff.tables.a.removed, [{ id: 1 }]);
  const structural = diffD1Snapshots(
    { t: [{ key: 'x' }, { key: 'y' }] },
    { t: [{ key: 'y' }, { key: 'z' }] },
  );
  assert.deepEqual(structural.tables.t.added, [{ key: 'z' }]);
  assert.deepEqual(structural.tables.t.removed, [{ key: 'x' }]);
  assert.deepEqual(diffD1Snapshots({ t: [{ id: 1 }] }, { t: [{ id: 1 }] }).tables.t.status, 'same');
  // same shape twice on identical inputs (empty diff) is flat
  assert.equal(diffD1Snapshots({ t: [{ id: 1 }] }, { t: [{ id: 1 }] }).changed, false);
});

test('diffKvSnapshots: added/removed/changed keys, values compared structurally', () => {
  const diff = diffKvSnapshots({ a: '1', b: { x: 1 }, c: 'stays' }, { b: { x: 2 }, c: 'stays', d: 'new' });
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.keys.added, [{ key: 'd', value: 'new' }]);
  assert.deepEqual(diff.keys.removed, [{ key: 'a', value: '1' }]);
  assert.deepEqual(diff.keys.changed, [{ key: 'b', before: { x: 1 }, after: { x: 2 } }]);
  assert.equal(diffKvSnapshots({ a: '1' }, { a: '1' }).changed, false);
});

test('diffStoreSnapshots: mixed D1 + KV store maps dispatch per binding', () => {
  const before = { DB: { notes: [{ id: 1 }] }, UPLOADS: { a: '1' } };
  const after = { DB: { notes: [{ id: 1 }, { id: 2 }] }, UPLOADS: { a: '2' } };
  const diff = diffStoreSnapshots(before, after);
  assert.equal(diff.changed, true);
  assert.equal(diff.bindings.DB.kind, 'd1');
  assert.equal(diff.bindings.DB.tables.notes.added.length, 1);
  assert.equal(diff.bindings.UPLOADS.kind, 'kv');
  assert.deepEqual(diff.bindings.UPLOADS.keys.changed, [{ key: 'a', before: '1', after: '2' }]);
  // a binding appearing/disappearing between snapshots is recorded whole
  assert.equal(diffStoreSnapshots({}, { DB: { t: [] } }).bindings.DB.status, 'added');
  // a shape CHANGING between snapshots is an oracle bug, not a finding - loud
  assert.throws(() => diffStoreSnapshots({ DB: { t: [{ id: 1 }] } }, { DB: { k: 'v' } }), /changed shape between snapshots/);
});

test('harness integration: snapshotStore + diffSnapshots grade what the STORE did; no counter ticks', () => {
  const counter = newBackendCounter();
  const harness = buildHarness({ s: async () => new Response('ok') }, {
    env: { kv: { UPLOADS: { seed: { a: '1' } } }, d1: { DB: { tables: { notes: { rows: [{ id: 1, name: 'x' }] } } } } },
  });
  harness._counter = counter; // observable
  const before = harness.snapshotStore();
  harness.env.UPLOADS._store.set('b', '2');
  harness.env.DB._t.get('notes').rows.push({ id: 2, name: 'y' });
  const after = harness.snapshotStore();
  const diff = harness.diffSnapshots(before, after);
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.bindings.DB.tables.notes.added, [{ id: 2, name: 'y' }]);
  assert.deepEqual(diff.bindings.UPLOADS.keys.added, [{ key: 'b', value: '2' }]);
  // snapshots are bookkeeping, not campaign ops - no counter ticks
  assert.equal(counter.count('kv.get'), 0);
  assert.equal(counter.count('d1.query'), 0);
  // restore-grade determinism: an untouched store diffs flat
  const again = harness.diffSnapshots(after, harness.snapshotStore());
  assert.equal(again.changed, false);
});
