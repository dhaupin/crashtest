// v0.2 — adapters + state/volume libraries.
// Adapter double strategy: the adapters wrap *dispatch surfaces* (.request /
// .handle / .inject), not framework internals — so we ship exact-shape mini
// doubles here (like supertest does) and validate against REAL apps in the
// 0.2 adoption wave (gistory adapter, hono playground).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';
import { registerHono } from '../src/adapters/hono.js';
import { registerExpress } from '../src/adapters/express.js';
import { registerFastify } from '../src/adapters/fastify.js';
import { registerAdapters } from '../src/adapters/index.js';
import { loadScenarios } from '../src/scenarios/loader.js';
import { runCampaign } from '../src/campaigns/runner.js';

const envSpec = {
  d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } } } } },
  kv: { DEVICE_CACHE: { seed: { last: 'seed' } } },
};

// ---- mini doubles ---------------------------------------------------------
// mini hono: store(path, handler) → request(input, init) dispatches by path
function miniHono() {
  const routes = new Map();
  return {
    request: (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const handler = routes.get(`${req.method} ${url.pathname}`);
      if (!handler) return new Response('not found', { status: 404 });
      // hono handlers: (c) => Response — c.request / c.env styled; our doubles
      // only need the request surface for these tests.
      return Promise.resolve(handler({ req, url })).then(r => r ?? new Response(null, { status: 500 }));
    },
    store: (method, path, handler) => routes.set(`${method} ${path}`, handler),
  };
}

// mini express: route(method, path, handler) → handle(nodeReq, res) dispatches
function miniExpress() {
  const routes = new Map();
  return {
    on: (method, path, handler) => routes.set(`${method} ${path}`, handler),
    handle: (nodeReq, res) => {
      const handler = routes.get(`${nodeReq.method} ${nodeReq.url.split('?')[0]}`);
      if (!handler) { res.statusCode = 404; res.end('not found'); return; }
      try {
        const out = handler(nodeReq, res);
        Promise.resolve(out).catch(() => { res.statusCode = 500; res.end('boom'); });
      } catch { res.statusCode = 500; res.end('boom'); }
    },
  };
}

// mini fastify: inject({method,url,payload,headers}) → {statusCode, body, headers}
function miniFastify() {
  const routes = new Map();
  return {
    inject: async ({ method, url, payload }) => {
      const handler = routes.get(`${method} ${url.split('?')[0]}`);
      if (!handler) return { statusCode: 404, body: 'not found', headers: {} };
      const body = payload ? JSON.parse(payload.toString()) : undefined;
      const out = await handler({ method, url, body });
      return out ?? { statusCode: 500, body: '', headers: {} };
    },
    store: (method, path, handler) => routes.set(`${method} ${path}`, handler),
  };
}

// ---- adapters dispatch in-process and preserve the harness contract ------
test('adapters: hono/express/fastify doubles all dispatch through the harness', async () => {
  const hono = miniHono();
  hono.store('POST', '/enroll', async ({ req, url }) => {
    const body = await req.json();
    return Response.json({ ok: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
  });

  const expr = miniExpress();
  expr.on('POST', '/enroll', async (nodeReq, res) => {
    let chunks = '';
    for await (const c of nodeReq) chunks += c;
    const body = JSON.parse(chunks);
    res.setHeader('content-type', 'application/json');
    res.statusCode = 200;
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ ok: true }));
  });

  const fastify = miniFastify();
  fastify.store('POST', '/enroll', async ({ body }) => ({
    statusCode: 200, body: JSON.stringify({ ok: true }), headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  }));

  for (const [kind, app] of [['hono', hono], ['express', expr], ['fastify', fastify]]) {
    const h = buildHarness({}, { env: envSpec });
    (registerAdapters)(h, { [kind]: app });
    const r = await h.run('app', { method: 'POST', url: '/enroll', body: JSON.stringify({ key: 'k1', owner: 'rook' }) });
    assert.equal(r.status, 200, `${kind} dispatch`);
    assert.equal(r.threw, false, `${kind} threw: ${r.error?.message}`);
    const text = await r.response.json();
    assert.deepEqual(text, { ok: true }, `${kind} body`);
  }
});

test('adapters: 404s and broken handlers land in the threw/refused lanes', async () => {
  const hono = miniHono(); // no routes registered at all
  const h = buildHarness({}, { env: envSpec });
  registerAdapters(h, { hono });
  const r = await h.run('app', { method: 'POST', url: '/enroll', body: '{}' });
  assert.equal(r.status, 404);
  assert.equal(r.ok, false);

  const expr = miniExpress(); // handler never ends the response
  expr.on('POST', '/enroll', async () => { await new Promise(() => {}); });
  const h2 = buildHarness({}, { env: envSpec });
  registerAdapters(h2, { express: { app: expr, name: 'app' } });
  const r2 = await h2.run('app', { method: 'POST', url: '/enroll', body: '{}' });
  assert.equal(r2.threw, true, 'hung express route must fail loudly (bounded dispatch)');
});

test('adapters: alkready-registered routes still compose (routes + adapters)', async () => {
  const hono = miniHono();
  hono.store('GET', '/health', () => new Response('ok'));
  const h = buildHarness({ plain: async () => new Response('plain') }, { env: envSpec });
  registerAdapters(h, { hono });
  assert.deepEqual(h.listRoutes().sort(), ['app', 'plain']);
  assert.equal((await h.run('plain', {})).status, 200);
  assert.equal((await h.run('app', { url: 'https://x/health' })).status, 200);
});

// ---- state library --------------------------------------------------------
function makeDeviceRoutes({ hardened = true } = {}) {
  const dbTables = {
    devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } },
  };
  return buildHarness({
    device: async ({ request, env }) => {
      // hardened: DB-looked-up owner check; vulnerable: trusts body.owner
      let body;
      try { body = await request.json(); } catch { return new Response('bad', { status: 400 }); }
      const key = String(body?.key ?? '');
      if (hardened) {
        const row = await env.DB.prepare('SELECT * FROM devices WHERE key = ?').bind(key).first();
        if (!row || row.owner !== 'rook') return new Response('404', { status: 404 });
        return Response.json({ device: row });
      }
      const row = await env.DB.prepare('SELECT * FROM devices WHERE key = ?').bind(key).first();
      if (!row) return new Response('404', { status: 404 });
      return Response.json({ device: row });
    },
    enroll: async ({ request, env }) => {
      const body = await request.json();
      try {
        await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)').bind(body.key, body.owner).run();
        return Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (e) {
        if (String(e?.message).includes('UNIQUE')) return new Response('conflict', { status: 409 });
        throw e;
      }
    },
  }, { env: { d1: { DB: { tables: dbTables } } } });
}

test('state/enumeration-oracle: foreign ids denied on hardened, LEAKED permissive', async () => {
  const [state] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'state');
  const attack = state.attacks.find(a => a.name === 'enumeration-oracle');

  const hardened = makeDeviceRoutes({ hardened: true });
  const r1 = await attack.run(hardened, { route: 'device', mustDenyIds: ['alien-1', 'alien-2'], param: 'key' });
  assert.equal(r1.verdict, 'REFUSED', r1.detail);

  const permissive = makeDeviceRoutes({ hardened: false });
  const r2 = await attack.run(permissive, { route: 'device', mustDenyIds: ['seed'], param: 'key' });
  assert.equal(r2.verdict, 'EXPLOITED', r2.detail); // 'seed' row belongs to rook, read by anyone
});

test('state/id-collision-alias: second owner conflicts (hardened), silent overwrite EXPLOITED', async () => {
  const [state] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'state');
  const attack = state.attacks.find(a => a.name === 'id-collision-alias');

  const hardened = makeDeviceRoutes({ hardened: true }); // both owners can still enroll → 409 on second
  const r1 = await attack.run(hardened, { key: 'coll-1' });
  assert.equal(r1.verdict, 'REFUSED', r1.detail);

  // vulnerable: route that silently overwrites the same key row
  const vuln = buildHarness({
    enroll: async ({ request, env }) => {
      const body = await request.json();
      await env.DB.prepare("UPDATE devices SET owner = ? WHERE key = ?").bind(body.owner, body.key).run();
      return Response.json({ ok: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
    },
  }, { env: { d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'coll-2', owner: 'owner-a' }], uniques: {} } } } } } });
  const r2 = await attack.run(vuln, { key: 'coll-2' });
  assert.equal(r2.verdict, 'EXPLOITED', r2.detail);
});

// ---- volume library --------------------------------------------------------
test('volume: stuffing refrains on walls, amplification flags uneconomical handlers', async () => {
  const [volume] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'volume');

  const cheap = buildHarness({
    enroll: async ({ request, env }) => {
      const body = await request.json();
      // 2 ops/request (1 statement, 1 row) → well under amplification bound
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO devices (key, owner) VALUES (?, ?)').bind(body.key, body.owner).run();
        return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
      } catch { return new Response('conflict', { status: 409 }); }
    },
  }, { env: { d1: { DB: { tables: { devices: { rows: [], uniques: { key_unique: ['key'] } } } } } } });

  const h1 = await runCampaign(cheap, await loadScenarios(), {
    modules: ['volume'],
    moduleCtx: { volume: { route: 'enroll', rounds: 20, maxOpsPerRequest: 12 } },
  });
  assert.equal(h1.tally.REFUSED, h1.tally.TOTAL, h1.exploited.map(r => `${r.id}: ${r.detail}`).join(' | '));

  // expensive: a handler that does a full table scan per call (2 + rows ops)
  const expensive = buildHarness({
    enroll: async ({ request, env }) => {
      const body = await request.json();
      await env.DB.prepare('SELECT * FROM devices WHERE owner = ?').bind(body.owner).all(); // scan = 1, rows = N
      await env.DB.prepare('SELECT * FROM devices').all();        // more scan rows → amplifies
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    },
  }, { env: { d1: { DB: { tables: { devices: { rows: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, key: `k${i}`, owner: 'rook' })) } } } } } });

  const h2 = await runCampaign(expensive, await loadScenarios(), {
    modules: ['volume'],
    moduleCtx: { volume: { route: 'enroll', rounds: 10, maxOpsPerRequest: 12 } },
  });
  const amp = h2.exploited.find(r => r.id === 'volume/cost-amplification');
  assert.ok(amp, 'expensive handler must trip the amplification bound');
  assert.match(amp.detail, /ops\/request/);
});

test('volume/storage-fill: fills without breaks are REFUSED with growth numbers; undeclared route skips', async () => {
  const [volume] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'volume');
  const fill = volume.attacks.find(a => a.name === 'storage-fill');

  const h = buildHarness({
    kvwrite: async ({ request, env }) => {
      const body = await request.json();
      await env.DEVICE_CACHE.put(body.key, body.blob ?? 'x');
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    },
  }, { env: { kv: { DEVICE_CACHE: {} } } });
  const r = await fill.run(h, { route: 'kvwrite', rounds: 12 });
  assert.equal(r.verdict, 'REFUSED', r.detail);
  assert.match(r.detail, /storage \d+ keys/);

  const skip = await fill.run(buildHarness({}, { env: envSpec }), { route: 'ghost' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.equal(skip.skipped, true);
});

test('adapters/dispatchNodeRequest: raw server gets the event surface (on data/end, setTimeout, destroy) — vant-shape', async () => {
  const { dispatchNodeRequest } = await import('../src/adapters/express.js');
  // Event-style raw handler: collects via req.on, guards via req.setTimeout,
  // cleans up via req.destroy() (the old surface threw on all three).
  const seen = { chunks: [], timedOut: false, destroyed: false };
  const rawHandler = (req, res) => {
    req.setTimeout(5000, () => { seen.timedOut = true; });
    req.on('data', (chunk) => seen.chunks.push(String(chunk)));
    req.on('end', () => {
      seen.destroyed = typeof req.destroy === 'function';
      req.destroy();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ got: seen.chunks.join(''), destroyable: seen.destroyed }));
    });
  };
  const res = await dispatchNodeRequest(rawHandler, new Request('https://x.local/call', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'probe' }),
  }));
  const body = JSON.parse(await res.text());
  assert.equal(res.status, 200);
  assert.equal(body.got, JSON.stringify({ tool: 'probe' }));
  assert.equal(body.destroyable, true);
  assert.equal(seen.timedOut, false);
});

test('scenarios/state id-collision-alias: missing DB binding REFUSES instead of crashing', async () => {
  const [state] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'state');
  const alias = state.attacks.find(a => a.name === 'id-collision-alias');
  // Harness WITHOUT any d1 binding — the crash case the fix closes.
  const h = buildHarness({ enroll: async () => Response.json({ ok: true }) }, { env: {} });
  const r = await alias.run(h, { route: 'enroll' });
  assert.equal(r.verdict, 'REFUSED', r.detail);
  assert.equal(r.skipped, true);
  assert.match(r.detail, /no DB binding/);
});

test('harness/aliasRoute: rewrites only the path (query passes through), body stream survives the rewrite', async () => {
  let captured;
  const h = buildHarness({
    app: async ({ request }) => {
      captured = { url: new URL(request.url), text: await request.text() };
      return new Response('ok', { status: 201, headers: { 'cache-control': 'no-store' } });
    },
  }, { env: {} });
  h.aliasRoute('enroll', 'app', { path: '/real/enroll' });

  const r = await h.run('enroll', {
    method: 'POST',
    url: '/enroll?key=x1&tag=probe',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'x1', owner: 'rook' }),
  });
  assert.equal(r.status, 201);
  assert.equal(captured.url.pathname, '/real/enroll');
  assert.equal(captured.url.searchParams.get('key'), 'x1');
  assert.equal(captured.url.searchParams.get('tag'), 'probe');
  assert.equal(captured.text, JSON.stringify({ key: 'x1', owner: 'rook' }));
});

test('harness/registerRoute: duplicate names fail loudly (silent overwrite leaked requests)', () => {
  const h = buildHarness({ app: async () => new Response('one') }, { env: {} });
  assert.throws(
    () => h.registerRoute('app', async () => new Response('treaty side lied')),
    /already registered/,
  );
});

test('harness/aliasRoute: aliasing a missing source route names the cause', () => {
  const h = buildHarness({}, { env: {} });
  assert.throws(
    () => h.aliasRoute('enroll', 'ghost'),
    /needs a registered source route/,
  );
});
