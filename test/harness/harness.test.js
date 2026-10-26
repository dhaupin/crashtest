import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, buildHarness } from '../../src/harness/harness.js';
import { FakeKV } from '../../src/harness/kv.js';
import { Rng } from '../../src/rng.js';
import { buildEnv } from '../../src/harness/env.js';
import { newBackendCounter } from '../../src/harness/counters.js';

// A tiny target app fixture - Pages-Functions-shaped handler. This is what
// scenarios will attack in v0.1 dogfooding.
function makeRoutes() {
  return {
    enroll: async ({ request, env }) => {
      const body = await request.json();
      const row = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)')
        .bind(body.key, body.owner).run();
      return Response.json({ enrolled: true, id: row.meta.last_row_id }, { status: 201 });
    },
    whoami: async ({ request, env }) => {
      const key = new URL(request.url).searchParams.get('key') ?? await env.DEVICE_CACHE.get('last');
      if (!key) return new Response('no key', { status: 400 });
      const device = await env.DB.prepare('SELECT * FROM devices WHERE key = ?').bind(key).first();
      if (!device) return new Response('unknown', { status: 404 });
      return Response.json({ device, cacheOps: env.DEVICE_CACHE._store.size });
    },
    throws: async () => { throw new Error('uncaught'); },
    notResponse: async () => ({ bad: true }),
  };
}

const envSpec = {
  d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } } } } },
  kv: { DEVICE_CACHE: { seed: { last: 'seed' } } },
};

test('KV fake: get/put/json/list/counter', async () => {
  const counter = { increment: (n) => ops.push(n) };
  const ops = [];
  const kv = new FakeKV('TEST', counter);
  assert.equal(await kv.get('missing'), null);
  await kv.put('a', 'plain');
  await kv.put('b', { x: 1 });
  assert.equal(await kv.get('a'), 'plain');
  assert.deepEqual(await kv.get('b', 'json'), { x: 1 });
  assert.equal(await kv.get('b'), '{"x":1}'); // raw default
  const listed = await kv.list({ prefix: 'a' });
  assert.deepEqual(listed.keys.map(k => k.name), ['a']);
  assert.equal(ops.filter(n => n === 'kv.put').length, 2);
});

test('harness: registered routes + in-process request through fake transport', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const r = await h.run('whoami', { url: '/whoami?key=seed' });
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.equal(r.threw, false);
  const body = await r.response.json();
  assert.equal(body.device.id, 1);
});

test('harness: uncaught throws surface as threw:true (never a fake 500)', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const r = await h.run('throws', {});
  assert.equal(r.threw, true);
  assert.equal(r.status, null);
  assert.match(r.error.message, /uncaught/);
});

test('harness: non-Response handler return is an occupant-visible error', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const r = await h.run('notResponse', {});
  assert.equal(r.threw, true);
  assert.match(r.error.message, /did not return a Response/);
});

test('harness: per-request op deltas + campaign cost totals', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const before = h.costTotals();
  const r1 = await h.run('enroll', { method: 'POST', body: JSON.stringify({ key: 'device-42', owner: 'rook' }) });
  assert.equal(r1.status, 201);
  assert.equal(r1.ops['d1.query'], 1);   // one INSERT
  assert.equal(r1.ops['d1.rows'], 1);    // one row materialized
  assert.equal(r1.ops['route.invoke'], 1);
  const r2 = await h.run('whoami', { url: '/whoami?key=device-42' });
  assert.equal(r2.ops['d1.query'], 1);
  const after = h.costTotals();
  assert.equal(after['d1.query'], before['d1.query'] + 2);
  assert.ok(after.__cost__ > before.__cost__);
});

test('harness: unique violation from the app surfaces as threw (Finding-worthy)', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const r = await h.run('enroll', { method: 'POST', body: JSON.stringify({ key: 'seed', owner: 'attacker' }) });
  assert.equal(r.status, null);
  assert.equal(r.threw, true); // takeover-style: handler trusted uniqueness and crashed
  assert.match(String(r.error), /UNIQUE constraint failed: devices\.key/);
});

test('harness: unknown route throws a naming error listing routes', async () => {
  const h = buildHarness({ whoami: makeRoutes().whoami }, { env: envSpec });
  await assert.rejects(h.run('ghost', {}), /no route registered as "ghost"/);
});

test('harness: env seeding lets secret-variant campaigns compare states', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  assert.equal(await h.env.DEVICE_CACHE.get('last'), 'seed');
  const listed = await h.env.DEVICE_CACHE.list({});
  assert.ok(listed.keys.length >= 1);
  const snap = h.env.DB.snapshot();
  assert.equal(snap.devices[0].key, 'seed');
});

// v0.2 - memory reuse: freezeTo/restoreTo/runFresh. The PRD's "sub-second
// repeat runs": replay a request like the FIRST run without re-importing or
// re-instantiating the backend - and restore-what-you-touch exactly.

test('harness: runFresh replays with identical op shapes and restores state exactly', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const at = h.freezeTo();
  const body = { method: 'POST', body: JSON.stringify({ key: 'fresh-1', owner: 'rook' }) };
  const r1 = await h.runFresh('enroll', body, at);
  assert.equal(r1.status, 201);
  const r2 = await h.runFresh('enroll', body, at);
  assert.equal(r2.status, 201);
  assert.deepEqual(r1.ops, r2.ops, 'identical request through the frozen state = identical ops');
  // restore-what-you-touch: the INSERT is gone, the KV put is gone, the
  // counter ticks are back at the frozen point.
  const rows = await h.env.DB.prepare('SELECT * FROM devices').all();
  assert.equal(rows.results.length, 1, 'only the seed row remains');
  assert.equal(await h.env.DEVICE_CACHE.get('last'), 'seed', 'KV put reverted');
  const beforeCost = at.counter.snapshot().__cost__;
  assert.equal(h.costTotals().__cost__, beforeCost + r2.ops.__cost__, 'counter restored to frozen point per runFresh');
});

test('harness: restoreTo throws back unique-violation state too (handler threw mid-write)', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const at = h.freezeTo();
  const bad = { method: 'POST', body: JSON.stringify({ key: 'seed', owner: 'attacker' }) };
  const r = await h.runFresh('enroll', bad, at);
  assert.equal(r.threw, true, 'the hostile replay still throws (campaigns must see it)');
  // And the harness is still healthy for the next fresh replay.
  const after = await h.runFresh('enroll', { method: 'POST', body: JSON.stringify({ key: 'fresh-2', owner: 'rook' }) }, at);
  assert.equal(after.status, 201);
});

test('harness: runFresh without an explicit at is a no-trace replay (fresh sandbox each call)', async () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  const r = await h.runFresh('enroll', { method: 'POST', body: JSON.stringify({ key: 'a1', owner: 'x' }) });
  assert.equal(r.status, 201);
  // No-trace default: the call froze the pre-request state and restored it
  // after, so the write never persists ("fresh" = zero footprints per call).
  const rows = await h.env.DB.prepare('SELECT * FROM devices').all();
  assert.equal(rows.results.length, 1, 'only the seed row remains (a1 wiped)');
  // An explicit freeze point is how multi-step / state-splitting flows work.
  const at = h.freezeTo();
  await h.runFresh('enroll', { method: 'POST', body: JSON.stringify({ key: 'a2', owner: 'x' }) }, at);
  await h.runFresh('enroll', { method: 'POST', body: JSON.stringify({ key: 'a3', owner: 'x' }) }, at);
  const rows2 = await h.env.DB.prepare('SELECT * FROM devices').all();
  assert.equal(rows2.results.length, 1, 'explicit-at replays restore to the shared freeze point too');
});

test('harness: restoreTo rejects junk snapshots loudly (rule 3)', () => {
  const h = buildHarness(makeRoutes(), { env: envSpec });
  assert.throws(() => h.restoreTo(null), /freezeTo\(\) snapshot/);
  assert.throws(() => h.restoreTo({ hello: 1 }), /freezeTo\(\) snapshot/);
});

// ---- edge-walk teeth (round-1 catches): silent fills become loud refusals ----

test('rng: pick on an empty list is a caller bug, not a silent undefined', () => {
  const r = new Rng(7);
  assert.throws(() => r.pick([]), /non-empty array/);
  assert.equal(r.pick(['a']), 'a');
});

test('rng: inverted int bounds are a caller bug, not a silent nonsense roll', () => {
  const r = new Rng(7);
  assert.throws(() => r.int(5, 3), /max >= min/);
  assert.throws(() => r.int(1.5, 3), /two integers/);
  assert.equal(r.int(3, 3), 3);
});

test('kv: unimplemented delivery types refuse loudly (type honesty)', async () => {
  const kv = new FakeKV('T');
  await kv.put('k', 'v');
  await assert.rejects(() => kv.get('k', 'arrayBuffer'), /not implemented by the fake/);
  await assert.rejects(() => kv.get('k', 'stream'), /not implemented by the fake/);
  assert.equal(await kv.get('k', 'text'), 'v');
  assert.equal(await kv.get('k', 'json'), null); // 'v' does not parse as json -> null (the KV contract)
});

test('kv: list limit outside 1..1000 refuses - a 0 page would stall pagination forever', async () => {
  const kv = new FakeKV('T');
  await kv.put('a', '1');
  await assert.rejects(() => kv.list({ limit: 0 }), /1\.\.1000/);
  await assert.rejects(() => kv.list({ limit: 1001 }), /1\.\.1000/);
  assert.equal((await kv.list({ limit: 1 })).keys.length, 1);
});

test('kv: a NaN expiration refuses loudly instead of silently never expiring', async () => {
  const kv = new FakeKV('T');
  await assert.rejects(() => kv.put('bad', 'v', { expiration: NaN }), /not a number/);
  // past/at-clock expiration stays legal BY DESIGN: it is the fake-clock scrub
  await kv.put('scrub', 'v', { expiration: 1 });
  assert.equal(await kv.get('scrub'), null);
});

test('kv: an unserializable put value refuses instead of storing undefined', async () => {
  const kv = new FakeKV('T');
  const circular = {}; circular.self = circular;
  await assert.rejects(() => kv.put('x', circular), /not JSON-serializable/);
});

test('env: a name declared as BOTH var and secret is a config bug, not a silent last-write', () => {
  assert.throws(
    () => buildEnv({ var: { KEY: 'a' }, secrets: { KEY: 'b' } }, newBackendCounter()),
    /one name, one owner/,
  );
});
