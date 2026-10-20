import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Harness, buildHarness } from '../../src/harness/harness.js';
import { FakeKV } from '../../src/harness/kv.js';

// A tiny target app fixture — Pages-Functions-shaped handler. This is what
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
