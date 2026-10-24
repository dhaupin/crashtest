// The two-pod fixture broker (issue #13 blocker 1) + expectation tables as
// data (issue #13 blocker 4) - teeth. This is the stateful ~20% census
// bucket (sync/backup/federation conversations) and the "table is
// complete" conversion property landing as tested crate tooling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPods } from '../../src/harness/pods.js';
import { evalExpectations, renderExpectationResult } from '../../src/expectations.js';

// a tiny federation conversation: each pod's store records what the
// handler did; the declared shared binding is the cross-talk seam.
function fedRoutes() {
  return {
    pull: async ({ env }) => {
      const rows = env.DB._t.get('notes').rows;
      await env.SESSIONS.put('lastPull', JSON.stringify(rows.map(r => r.id)));
      return new Response(JSON.stringify({ staged: rows.length }), { status: 200 });
    },
  };
}

const podSpec = (seedKey) => ({
  env: {
    d1: { DB: { tables: { notes: { rows: [{ id: 1, name: seedKey }] } } } },
    kv: { SESSIONS: { seed: { boot: '1' } } },
  },
});

test('pods: two staged pods drive the same routes against INDEPENDENT stores', async () => {
  const pods = buildPods({
    routes: fedRoutes(),
    pods: { home: podSpec('home-note'), remote: podSpec('remote-note') },
    shared: ['SESSIONS'],
  });
  const home = await pods.run('home', 'pull');
  assert.equal(home.status, 200);
  await pods.run('remote', 'pull', { keepalive: false });
  const homeStore = pods.snapshot('home');
  const remoteStore = pods.snapshot('remote');
  assert.deepEqual(Object.keys(homeStore.DB.notes[0]), ['id', 'name']);
  assert.deepEqual(homeStore.DB.notes.map(r => r.name), ['home-note']);
  assert.deepEqual(remoteStore.DB.notes.map(r => r.name), ['remote-note']);
  const lastPull = await pods.pod('home').env.SESSIONS.get('lastPull', 'json');
  assert.deepEqual(lastPull, [1], 'the shared seam recorded the home pod\'s pull');
  const remotePull = await pods.pod('remote').env.SESSIONS.get('lastPull', 'json');
  assert.deepEqual(remotePull, [1], 'cross-talk: the remote pod saw the same shared instance');
});

test('pods: cross-pod diff names what moved (added/removed/changed, deterministic)', async () => {
  const pods = buildPods({
    routes: fedRoutes(),
    pods: { home: podSpec('home'), remote: { env: { d1: { DB: { tables: {} } }, kv: { SESSIONS: {} } } } },
    shared: ['SESSIONS'],
  });
  const diff = pods.diff('home', 'remote');
  assert.equal(diff.podA, 'home');
  assert.equal(diff.changed, true);
  assert.equal(diff.bindings.DB.kind, 'd1', 'tables map present on home, absent on remote -> per-table statuses tell the story');
  assert.deepEqual(diff.bindings.DB.tables.notes.status, 'removed');
  // snapshot-only frames also ride the per-pod harness diffSnapshots
  const before = pods.snapshot('home');
  pods.pod('home').env.DB._t.get('notes').rows.push({ id: 2, name: 'fresh' });
  const after = pods.snapshot('home');
  assert.deepEqual(pods.pod('home').diffSnapshots(before, after).bindings.DB.tables.notes.added, [{ id: 2, name: 'fresh' }]);
});

test('pods: single pod, missing shared bindings and unknown pods fail LOUDLY', () => {
  assert.throws(() => buildPods({ routes: {}, pods: { only: podSpec('x') } }), /stage at least two pods/);
  assert.throws(
    () => buildPods({ routes: fedRoutes(), pods: { home: podSpec('h'), remote: { env: {} } }, shared: ['SESSIONS'] }),
    /shared binding "SESSIONS" is not declared on pod "remote"/,
  );
  const pods = buildPods({ routes: fedRoutes(), pods: { home: podSpec('h'), remote: podSpec('r') } });
  assert.throws(() => pods.run('miss', 'pull'), /no pod named "miss"/);
});

test('expectations: the table-is-complete property (both sides covered, verdicts agree)', () => {
  const rows = [
    { module: 'auth', attack: 'weak-key', verdict: 'REFUSED' },
    { module: 'auth', attack: 'secret-echo', verdict: 'BOUNDED', owner: 'wire', bound: 'one-echo' },
  ];
  const expected = [
    { module: 'auth', attack: 'weak-key', verdict: 'REFUSED' },
    { module: 'auth', attack: 'secret-echo', verdict: 'BOUNDED' },
  ];
  const r = evalExpectations(rows, expected, { scopeName: 'vant-auth' });
  assert.equal(r.pass, true);
  assert.equal(r.matched.length, 2);
  assert.equal(r.mismatched.length, 0);
  assert.equal(r.extra.length, 0);
});

test('expectations: flipped verdicts, missing rows and extra rows all fail naming both sides', () => {
  const rows = [
    { module: 'auth', attack: 'weak-key', verdict: 'EXPLOITED' },   // flipped
    { module: 'federation', attack: 'relay-flap', verdict: 'REFUSED' }, // extra
  ];
  const r = evalExpectations(rows, [
    { module: 'auth', attack: 'weak-key', verdict: 'REFUSED' },
    { module: 'auth', attack: 'secret-echo', verdict: 'BOUNDED' },  // missing
  ]);
  assert.equal(r.pass, false);
  assert.deepEqual(r.mismatched.filter(m => m.status === 'verdict'), [
    { module: 'auth', attack: 'weak-key', status: 'verdict', expected: 'REFUSED', actual: 'EXPLOITED' },
  ]);
  assert.deepEqual(r.mismatched.filter(m => m.status === 'missing'), [
    { module: 'auth', attack: 'secret-echo', status: 'missing', expected: 'BOUNDED', actual: null },
  ]);
  assert.deepEqual(r.extra.map(e => e.attack), ['relay-flap']);
  assert.ok(/weak-key: expected REFUSED, got EXPLOITED \(verdict\)/.test(renderExpectationResult(r)));
});

test('expectations: dup table rows and identity-less records fail LOUDLY at cause', () => {
  assert.throws(
    () => evalExpectations([{ module: 'a', attack: 'x', verdict: 'REFUSED' }], [
      { module: 'a', attack: 'x', verdict: 'REFUSED' },
      { module: 'a', attack: 'x', verdict: 'EXPLOITED' },
    ]),
    /expectation table lists .* twice/,
  );
  assert.throws(
    () => evalExpectations([{ module: 'a', verdict: 'REFUSED' }], []),
    /produced row without an attack name/,
  );
});
