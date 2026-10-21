// S1.2 - the two-way proof. The same seed scenario library must EXPLOIT a
// vulnerable fixture and be REFUSED by a hardened one - exactly the finding
// semantics the report will surface (PRD section 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../../src/harness/harness.js';
import { loadScenarios } from '../../src/scenarios/loader.js';

const CRASHTEST_CANARY = 'crashtestCanary7d3f';

// ---- fixture apps -------------------------------------------------------
// vulnerable: recursive merge written the way an LLM writes one on a good day
function mergeVulnerable(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // the classic sin: target[key] happens to be Object.prototype for key '__proto__'
      if (!target[key]) target[key] = {};
      mergeVulnerable(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// hardened: never follows __proto__/constructor keys (also mirrors what a
// competent handler does: validate short allow-listed fields)
const KEYS = new Set(['key', 'owner']);
function mergeHardened(target, source) {
  for (const key of Object.keys(source)) {
    if (!KEYS.has(key)) continue; // allow-list: hostile keys never reach storage
    target[key] = source[key];
  }
  return target;
}

function makeRoutes({ merge }) {
  return {
    // JSON body merge into a per-device record (very common agent-app shape)
    enroll: async ({ request, env }) => {
      let body;
      try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
      if (typeof body !== 'object' || body === null) {
        return new Response('body must be an object', { status: 400 });
      }
      const record = {};
      merge(record, body);
      if (typeof record.key !== 'string' || record.key.length === 0 || record.key.length > 64) {
        return new Response('invalid key', { status: 400 });
      }
      try {
        const res = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)')
          .bind(record.key, String(record.owner ?? '')).run();
        return Response.json({ enrolled: true, id: res.meta.last_row_id }, { status: 201 });
      } catch (err) {
        if (String(err?.message).includes('UNIQUE constraint')) {
          return new Response('key conflict', { status: 409 });
        }
        throw err;
      }
    },
  };
}

const envSpec = {
  d1: {
    DB: {
      tables: {
        devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } },
      },
    },
  },
};

test('proto-pollution-body: EXPLOITED on vulnerable merge, REFUSED on hardened', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'input');
  const attack = module.attacks.find(a => a.name === 'proto-pollution-body');

  const vuln = buildHarness(makeRoutes({ merge: mergeVulnerable }), { env: envSpec });
  const r1 = await attack.run(vuln, { route: 'enroll' });
  assert.equal(r1.verdict, 'EXPLOITED', `expected pollution to succeed: ${r1.detail}`);
  assert.match(r1.detail, /canary planted/);
  delete Object.prototype[CRASHTEST_CANARY]; // clean up between arms

  const hard = buildHarness(makeRoutes({ merge: mergeHardened }), { env: envSpec });
  const r2 = await attack.run(hard, { route: 'enroll' });
  assert.equal(r2.verdict, 'REFUSED', `hardened app must not pollute: ${r2.detail}`);
});

test('never-fail-mutations: EXPLOITED on brittle handler, REFUSED on validated one', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'input');
  const attack = module.attacks.find(a => a.name === 'never-fail-mutations');
  assert.ok(attack);

  // brittle: fixtures where String ops explode on objects (classic)
  const brittle = {
    enroll: async ({ request, env }) => {
      const body = await request.json();
      // no validation at all - string coercion on hostile values
      const key = body.key;
      return Response.json({ got: key.toUpperCase(), len: String(key).length });
    },
  };
  const hb = buildHarness(brittle, { env: envSpec });
  const r1 = await attack.run(hb, { route: 'enroll', iterations: 24 });
  assert.equal(r1.verdict, 'EXPLOITED', `expected a floor violation: ${r1.detail}`);
  assert.match(r1.detail, /broke the floor/);

  const hard = buildHarness(makeRoutes({ merge: mergeHardened }), { env: envSpec });
  const r2 = await attack.run(hard, { route: 'enroll', iterations: 24 });
  assert.equal(r2.verdict, 'REFUSED', `${r2.detail}`);
});

test('oversized-field: REFUSED on validated handler, EXPLOITED on storage-crashing one', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'input');
  const attack = module.attacks.find(a => a.name === 'oversized-field');

  const hard = buildHarness(makeRoutes({ merge: mergeHardened }), { env: envSpec });
  const r2 = await attack.run(hard, { route: 'enroll' });
  assert.equal(r2.verdict, 'REFUSED', r2.detail);

  // one whose storage layer genuinely breaks on giant strings (the classic
  // agent-authored bug: trust the client, size-limit at the wrong layer -
  // here the "driver" throws above 255 chars)
  const crashy = {
    enroll: async ({ request }) => {
      const body = await request.json();
      if (body.key.length > 255) throw new Error('SQLite string too long');
      return Response.json({ fine: body.key.length });
    },
  };
  const cv = buildHarness(crashy, { env: envSpec });
  const r1 = await attack.run(cv, { route: 'enroll' });
  assert.equal(r1.verdict, 'EXPLOITED', r1.detail);
});

test('taxonomy: escalate-and-leak handler EXPLOITED, impersonal hardener REFUSED, skips politely', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'taxonomy');
  assert.ok(module);
  const not5xx = module.attacks.find(a => a.name === 'abuse-not-5xx');
  const impersonal = module.attacks.find(a => a.name === 'errors-stay-impersonal');
  for (const a of [not5xx, impersonal]) assert.ok(a);

  // The LLM-draft sad path: echo the raw request text back on error AND
  // escalate to 500 status (both bugs in one handler - the classic draft).
  const echoVuln = {
    enroll: async ({ request }) => {
      const text = await request.text();
      let body;
      try { body = JSON.parse(text); } catch {
        return new Response(`bad json: ${text} at Object.<anonymous> (node:internal/enroll:12:5)`, { status: 500 });
      }
      if (typeof body !== 'object' || body === null) {
        return new Response(`bad: ${text}`, { status: 500 });
      }
      return Response.json({ ok: body.key });
    },
  };
  const hb = buildHarness(echoVuln, { env: envSpec });
  const r1 = await not5xx.run(hb, { route: 'enroll' });
  assert.equal(r1.verdict, 'EXPLOITED', `expected 5xx escalations on the echo handler: ${r1.detail}`);
  const r2 = await impersonal.run(hb, { route: 'enroll' });
  assert.equal(r2.verdict, 'EXPLOITED', `expected leaks on the echo handler: ${r2.detail}`);
  assert.ok(/canary echo|node:internal|stack frame|file:line:col/.test(r2.detail), `leak reason should be named: ${r2.detail}`);

  const hard = buildHarness(makeRoutes({ merge: mergeHardened }), { env: envSpec });
  const r3 = await not5xx.run(hard, { route: 'enroll' });
  assert.equal(r3.verdict, 'REFUSED', `hardened handler must answer abuse honestly: ${r3.detail}`);
  const r4 = await impersonal.run(hard, { route: 'enroll' });
  assert.equal(r4.verdict, 'REFUSED', `hardened error paths must stay impersonal: ${r4.detail}`);

  // Contract pin: undeclared probe routes degrade to skipped-REFUSED.
  const skip = await not5xx.run(hb, { route: 'no-such-route' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared route must skip, not fail: ${skip.detail}`);
});

test('seeded determinism: same seed angle produces identical verdict details', async () => {
  const [module] = (await loadScenarios()).filter(l => l.module.name === 'input').map(l => l.module);
  const attack = module.attacks.find(a => a.name === 'never-fail-mutations');
  const hard = buildHarness(makeRoutes({ merge: mergeHardened }), { env: envSpec });
  const a = await attack.run(hard, { route: 'enroll', iterations: 16, seed: 999 });
  const b = await attack.run(hard, { route: 'enroll', iterations: 16, seed: 999 });
  assert.equal(a.verdict, b.verdict);
  assert.equal(a.detail, b.detail);
  assert.equal(a.detail, b.detail); // twice, once for the love of evidence
});

// ---- session (three-attack wire: hygiene / fixation / logout) ------------
function sessionRoutes({ secure }) {
  const sessions = new Map(); // sid -> user
  let rowSeq = 0; // deterministic sid source: sid${n}
  return {
    login: async ({ request }) => {
      let body;
      try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
      if (typeof body?.user !== 'string') return new Response('invalid user', { status: 400 });
      let sid;
      let flags;
      if (secure) {
        sid = `sid${++rowSeq}-rook-session`;
        sessions.set(sid, body.user);
        flags = 'Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600';
      } else {
        // the classic draft: one static sid for every login, zero flags
        sid = 'rook-fixed-sid';
        sessions.set(sid, body.user);
        flags = 'Path=/';
      }
      return new Response('ok', {
        status: 200,
        headers: { 'set-cookie': `sid=${sid}; ${flags}`, 'cache-control': 'no-store' },
      });
    },
    me: async ({ request }) => {
      const sid = (request.headers.get('cookie') ?? '').match(/sid=([^;]*)/)?.[1];
      if (sid && sessions.get(sid)) return Response.json({ user: sessions.get(sid) }, { headers: { 'cache-control': 'no-store' } });
      return new Response('unauthenticated', { status: 401, headers: { 'cache-control': 'no-store' } });
    },
    // The vulnerable draft's logout is a look-busy no-op (cookie stays alive
    // server-side); only the hardened variant actually deletes the row.
    logout: async ({ request }) => {
      const sid = (request.headers.get('cookie') ?? '').match(/sid=([^;]*)/)?.[1];
      if (secure && sid) sessions.delete(sid);
      // 204 reflex: null body required by WHATWG (a 204 cannot carry content).
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    },
  };
}

const sessionEnv = { d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } }, sessions: { rows: [], uniques: { sid_unique: ['sid'] } } } } } };

test('session: EXPLOITED on the trust-the-wire draft, REFUSED when rotated + forged-deny + invalidated', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'session');
  assert.ok(module, 'session library module must load');
  const hygiene = module.attacks.find(a => a.name === 'cookie-hygiene');
  const fixation = module.attacks.find(a => a.name === 'session-fixation');
  const logout = module.attacks.find(a => a.name === 'logout-invalidates');
  for (const a of [hygiene, fixation, logout]) assert.ok(a);

  const vuln = buildHarness(sessionRoutes({ secure: false }), { env: sessionEnv });
  const r1 = await hygiene.run(vuln, { loginRoute: 'login' });
  assert.equal(r1.verdict, 'EXPLOITED', `zero-flag cookie must trip: ${r1.detail}`);
  const r2 = await fixation.run(vuln, { loginRoute: 'login', meRoute: 'me' });
  assert.equal(r2.verdict, 'EXPLOITED', `static sid + forged-200 must trip: ${r2.detail}`);
  const r3 = await logout.run(vuln, { loginRoute: 'login', meRoute: 'me', logoutRoute: 'logout' });
  assert.equal(r3.verdict, 'EXPLOITED', `logout no-op must trip: ${r3.detail}`);

  const hard = buildHarness(sessionRoutes({ secure: true }), { env: sessionEnv });
  const r4 = await hygiene.run(hard, { loginRoute: 'login' });
  assert.equal(r4.verdict, 'REFUSED', `full hygiene must hold: ${r4.detail}`);
  const r5 = await fixation.run(hard, { loginRoute: 'login', meRoute: 'me' });
  assert.equal(r5.verdict, 'REFUSED', `rotation + forged-deny must hold: ${r5.detail}`);
  const r6 = await logout.run(hard, { loginRoute: 'login', meRoute: 'me', logoutRoute: 'logout' });
  assert.equal(r6.verdict, 'REFUSED', `invalidation must hold: ${r6.detail}`);

  // Contract pin: undeclared session routes degrade to skipped-REFUSED.
  const skip = await fixation.run(buildHarness({}, { env: sessionEnv }), { loginRoute: 'login', meRoute: 'me' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared routes must skip, not fail: ${skip.detail}`);
});

// ---- authz (method matrix / role bodies / alias drift) -------------------
function authzRoutes({ leaky }) {
  const adminGate = leaky
    ? async ({ request, env }) => {
        // This fixture's leaky gate trusts BODY-declared roles only (the
        // primary's own bug); the alias trusts the identity HEADERS the
        // primary ignores - which is exactly the drift authz/alias hunts.
        let role = null;
        try { const body = await request.json(); role = body?.role ?? body?.isAdmin; } catch { /* no body */ }
        if (role === 'admin' || role === 'true') return Response.json({ all: 1 });
        return new Response('403: admin only', { status: 403 });
      }
    : async () => new Response('403: admin only', { status: 403 });
  return {
    admin: adminGate,
    // the alias dimension: hardened keeps the name, denies identically;
    // leaky is the leftover debug trapdoor honoring headers the gate ignores
    'dev-check': leaky
      ? async ({ request }) => {
          if (request.headers.get('x-is-admin') === 'admin') return Response.json({ debug: true });
          return new Response('403: admin only (dev-check)', { status: 403 });
        }
      : () => new Response('403: admin only', { status: 403 }),
  };
}

const authzEnv = envSpec;

test('authz: EXPLOITED on the header/body-trusting gate + debug alias, REFUSED when method-blind + role-tight + alias-aligned', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'authz');
  assert.ok(module, 'authz library module must load');
  const matrix = module.attacks.find(a => a.name === 'method-matrix-privileged');
  const roleBody = module.attacks.find(a => a.name === 'role-body-spoof-family');
  const alias = module.attacks.find(a => a.name === 'handler-alias-confusion');
  for (const a of [matrix, roleBody, alias]) assert.ok(a);

  const vuln = buildHarness(authzRoutes({ leaky: true }), { env: authzEnv });
  const r1 = await roleBody.run(vuln, { privilegedRoute: 'admin' });
  assert.equal(r1.verdict, 'EXPLOITED', `body-declared roles must flip the leaky gate: ${r1.detail}`);
  assert.match(r1.detail, /role.*POST|isAdmin/);
  const r2 = await alias.run(vuln, { privilegedRoute: 'admin', aliasRoute: 'dev-check' });
  assert.equal(r2.verdict, 'EXPLOITED', `the debug leftover must be the trapdoor: ${r2.detail}`);
  assert.match(r2.detail, /x-is-admin/);

  const hard = buildHarness(authzRoutes({ leaky: false }), { env: authzEnv });
  const r3 = await matrix.run(hard, { privilegedRoute: 'admin' });
  assert.equal(r3.verdict, 'REFUSED', `the gate must be method-blind: ${r3.detail}`);
  const r4 = await roleBody.run(hard, { privilegedRoute: 'admin' });
  assert.equal(r4.verdict, 'REFUSED', `role claims must never route: ${r4.detail}`);
  const r5 = await alias.run(hard, { privilegedRoute: 'admin', aliasRoute: 'dev-check' });
  assert.equal(r5.verdict, 'REFUSED', `the alias must deny identically: ${r5.detail}`);

  // Contract pin: undeclared privileged routes degrade to skipped-REFUSED.
  const skip = await matrix.run(buildHarness({}, { env: authzEnv }), { privilegedRoute: 'admin' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared routes must skip, not fail: ${skip.detail}`);
});

// ---- proto-hygiene (HEAD parity / request shape flood) -------------------
function shapeRoutes({ safe }) {
  return {
    read: async ({ request }) => {
      const u = new URL(request.url);
      const key = u.searchParams.get('key');
      const seg = u.pathname.split('/').filter(Boolean).pop();
      // the draft: dereference a param the URL never carried - crash on '?'
      return Response.json({ k: key.slice(0, 8).toUpperCase(), seg: seg ?? '' });
    },
    ok: safe
      ? async () => new Response('ok')
      : async ({ request }) => {
          if (request.method === 'HEAD') throw new Error('head? never tested it');
          return new Response('ok');
        },
  };
}

test('proto-hygiene: EXPLOITED on the crashing draft + untested-HEAD, REFUSED on the hardened shape handlers', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'proto-hygiene');
  assert.ok(module, 'proto-hygiene library module must load');
  const parity = module.attacks.find(a => a.name === 'head-get-parity');
  const flood = module.attacks.find(a => a.name === 'request-shape-flood');
  for (const a of [parity, flood]) assert.ok(a);

  // Vuln: 'ok' throws exactly on HEAD; 'read' dereferences a missing param.
  const vuln = buildHarness(shapeRoutes({ safe: false }), {});
  const r1 = await parity.run(vuln, { routes: ['ok'] });
  assert.equal(r1.verdict, 'EXPLOITED', `untested HEAD must trip: ${r1.detail}`);
  assert.match(r1.detail, /threw on HEAD/);
  const r2 = await flood.run(vuln, { routes: ['read'] });
  assert.equal(r2.verdict, 'EXPLOITED', `param dereference must trip: ${r2.detail}`);
  assert.match(r2.detail, /threw - /);

  const hardRoutes = {
    ok: () => new Response('ok'),
    read: ({ request }) => {
      const u = new URL(request.url);
      const key = u.searchParams.get('key') ?? '';
      return Response.json({ k: key.slice(0, 8).toUpperCase() });
    },
  };
  const hard = buildHarness(hardRoutes, {});
  const r3 = await parity.run(hard, { routes: ['ok'] });
  assert.equal(r3.verdict, 'REFUSED', `HEAD must mirror: ${r3.detail}`);
  const r4 = await flood.run(hard, { routes: ['read'] });
  assert.equal(r4.verdict, 'REFUSED', `safe shapes must hold: ${r4.detail}`);

  // Sweep default without ctx.routes walks everything - works on empty too.
  const emptySkip = await parity.run(buildHarness({}, {}), {});
  assert.equal(emptySkip.verdict, 'REFUSED');
  assert.ok(emptySkip.skipped === true, `empty sweep must skip, not fail: ${emptySkip.detail}`);
});

// ---- recursion (deep-nest stack / redos) -------------------------------

function mergeVulnerableDeep(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (!target[key]) target[key] = {};
      mergeVulnerableDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

test('recursion: EXPLOITED on the recursive walker + catastrophic regex, REFUSED on the depth-capped/linear pair', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'recursion');
  assert.ok(module, 'recursion library module must load');
  const deep = module.attacks.find(a => a.name === 'deep-nest-stack-overflow');
  const redos = module.attacks.find(a => a.name === 'redos-catastrophic-pattern');
  for (const a of [deep, redos]) assert.ok(a);

  const vuln = buildHarness({
    enroll: async ({ request, env }) => {
      const body = await request.json();
      const record = mergeVulnerableDeep({}, body);
      return Response.json({ got: typeof record.k === 'string' ? record.k : 'structured' });
    },
    validate: async ({ request }) => {
      const body = await request.json();
      // The verified-on-V8 catastrophic family: unanchored alternation +
      // failing suffix (evil ~300ms at the probe's committed length).
      if (/((a|aa)+)$/.test(String(body?.value ?? ''))) return new Response('ok');
      return new Response('rejected', { status: 400 });
    },
  }, {});

  const r1 = await deep.run(vuln, { deepRoute: 'enroll' });
  assert.equal(r1.verdict, 'EXPLOITED', `the recursive walker must stack-overflow: ${r1.detail}`);
  assert.match(r1.detail, /RangeError|call stack/i);
  const r2 = await redos.run(vuln, { regexRoute: 'validate' });
  assert.equal(r2.verdict, 'EXPLOITED', `the nested-quantifier regex must backtrack catastrophically: ${r2.detail}`);

  const hard = buildHarness({
    enroll: async ({ request }) => {
      const body = await request.json();
      // flat top-level read: never walks the structure recursively
      const k = (body?.k ?? null);
      return Response.json({ got: typeof k === 'string' ? k : 'structured' });
    },
    validate: async ({ request }) => {
      const body = await request.json();
      const value = body?.value;
      if (typeof value !== 'string' || value.length > 64 || !/^[a-zA-Z0-9-]{0,64}$/.test(value)) {
        return new Response('invalid value', { status: 400 });
      }
      return new Response('ok');
    },
  }, {});

  const r3 = await deep.run(hard, { deepRoute: 'enroll', depth: 12000 });
  assert.equal(r3.verdict, 'REFUSED', `the flat reader must hold: ${r3.detail}`);
  const r4 = await redos.run(hard, { regexRoute: 'validate' });
  assert.equal(r4.verdict, 'REFUSED', `the linear regex must hold: ${r4.detail}`);

  // Contract pin: undeclared routes degrade to skipped-REFUSED.
  const skip = await deep.run(buildHarness({}, {}), { deepRoute: 'enroll' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared routes must skip, not fail: ${skip.detail}`);
});

// ---- upload (filename traversal + mime polyglots) -----------------------
const UPLOAD_ENV = { d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } }, sessions: { rows: [], uniques: { sid_unique: ['sid'] } } } } }, kv: { UPLOADS: {} } };

function uploadRoutes({ safe }) {
  const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
  return {
    upload: safe
      ? async ({ request, env }) => {
          const data = await request.formData();
          const file = data.get('file');
          if (!file || typeof file.name !== 'string') return new Response('missing file', { status: 400 });
          if (!SAFE_NAME.test(file.name) || file.name.includes('..') || file.name.startsWith('.')) {
            return new Response('unsafe filename', { status: 400 });
          }
          const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
          if (!['png', 'jpg', 'jpeg', 'txt', 'csv', 'pdf'].includes(ext)) return new Response('forbidden extension', { status: 400 });
          if (!['image/png', 'image/jpeg', 'text/plain', 'text/csv', 'application/pdf'].includes(file.type ?? '')) {
            return new Response('forbidden content type', { status: 400 });
          }
          await env.UPLOADS.put(file.name, await file.text());
          return new Response('stored', { status: 201 });
        }
      : async ({ request, env }) => {
          const data = await request.formData();
          const file = data.get('file');
          await env.UPLOADS.put(file.name, await file.text());
          return Response.json({ stored: file.name, type: file.type });
        },
  };
}

test('upload: EXPLOITED on the trust-the-wire draft, REFUSED on the validated storage pair', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'upload');
  assert.ok(module, 'upload library module must load');
  const traversal = module.attacks.find(a => a.name === 'filename-traversal-family');
  const polyglot = module.attacks.find(a => a.name === 'mime-polyglot-family');
  for (const a of [traversal, polyglot]) assert.ok(a);

  const vuln = buildHarness(uploadRoutes({ safe: false }), { env: UPLOAD_ENV });
  const r1 = await traversal.run(vuln, { route: 'upload' });
  assert.equal(r1.verdict, 'EXPLOITED', `raw storage keys must trip: ${r1.detail}`);
  assert.match(r1.detail, /stored \[/);
  const r2 = await polyglot.run(vuln, { route: 'upload' });
  assert.equal(r2.verdict, 'EXPLOITED', `stored polyglots must trip: ${r2.detail}`);
  assert.match(r2.detail, /POLYGLOT stored/);

  const hard = buildHarness(uploadRoutes({ safe: true }), { env: UPLOAD_ENV });
  const r3 = await traversal.run(hard, { route: 'upload' });
  assert.equal(r3.verdict, 'REFUSED', `validated names must hold: ${r3.detail}`);
  const r4 = await polyglot.run(hard, { route: 'upload' });
  assert.equal(r4.verdict, 'REFUSED', `the allow-list must hold: ${r4.detail}`);

  // Contract pin: undeclared route or store degrades to skipped-REFUSED.
  const skip = await traversal.run(buildHarness({}, { env: UPLOAD_ENV }), { route: 'upload' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared route must skip, not fail: ${skip.detail}`);
});

// ---- race (same-key bursts + concurrent field writes) --------------------
const RACE_ENV = { d1: { DB: { tables: {
  devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } },
  charges: { rows: [], uniques: { cid_unique: ['cid'] } },
  settings: { rows: [], uniques: { user_field_unique: ['user', 'field'] } },
  blobs: { rows: [], uniques: { user_unique: ['user'] } },
} } }, kv: { UPLOADS: {}, DEVICE_CACHE: { seed: { last: 'seed' } } } };

function raceRoutes({ unique }) {
  return {
    charge: unique
      ? async ({ request, env }) => {
          const body = await request.json();
          try {
            await env.DB.prepare('INSERT INTO charges (cid, user, cents) VALUES (?, ?, ?)').bind(body.idem, body.user ?? 'rook', body.cents ?? 0).run();
            return new Response('charged', { status: 201 });
          } catch (err) {
            if (String(err?.message).includes('UNIQUE')) return new Response('already charged', { status: 409 });
            throw err;
          }
        }
      : async ({ request, env }) => {
          const body = await request.json();
          const dup = await env.DB.prepare('SELECT id FROM charges WHERE cid = ?').bind(body.idem).first('id');
          if (dup != null) return new Response('already charged', { status: 409 });
          await env.DB.prepare('INSERT INTO charges (cid, user, cents) VALUES (?, ?, ?)').bind(body.idem, body.user ?? 'rook', body.cents ?? 0).run();
          return new Response('charged', { status: 201 });
        },
    profile: unique
      ? async ({ request, env }) => {
          const body = await request.json();
          for (const k of Object.keys(body)) {
            if (k === 'user') continue;
            await env.DB.prepare('INSERT INTO settings (user, field, value) VALUES (?, ?, ?)').bind(body.user, k, String(body[k])).run();
          }
          return new Response('saved', { status: 201 });
        }
      : async ({ request, env }) => {
          const body = await request.json();
          await env.DB.prepare('DELETE FROM blobs WHERE user = ?').bind(body.user).run();
          await env.DB.prepare('INSERT INTO blobs (user, json) VALUES (?, ?)').bind(body.user, JSON.stringify(body)).run();
          return new Response('saved', { status: 201 });
        },
  };
}

test('race: EXPLOITED on the TOCTOU charge + record-stomping writes, REFUSED on the unique-key/per-field pair', async () => {
  const [module] = (await loadScenarios()).map(l => l.module).filter(m => m.name === 'race');
  assert.ok(module, 'race library module must load');
  const idem = module.attacks.find(a => a.name === 'double-submit-idempotency');
  const lostUpdate = module.attacks.find(a => a.name === 'concurrent-write-lost-update');
  for (const a of [idem, lostUpdate]) assert.ok(a);

  const vuln = buildHarness(raceRoutes({ unique: false }), { env: RACE_ENV });
  const r1 = await idem.run(vuln, { submitRoute: 'charge' });
  assert.equal(r1.verdict, 'EXPLOITED', `the TOCTOU charge must admit the double: ${r1.detail}`);
  assert.match(r1.detail, /kept 2 charge rows|threw uncaught/);
  const r2 = await lostUpdate.run(vuln, { embedRoute: 'profile' });
  assert.equal(r2.verdict, 'EXPLOITED', `record stomping must lose fields: ${r2.detail}`);
  assert.match(r2.detail, /fields lost|threw uncaught/);

  const hard = buildHarness(raceRoutes({ unique: true }), { env: RACE_ENV });
  const r3 = await idem.run(hard, { submitRoute: 'charge' });
  assert.equal(r3.verdict, 'REFUSED', `unique cid must hold: ${r3.detail}`);
  const r4 = await lostUpdate.run(hard, { embedRoute: 'profile' });
  assert.equal(r4.verdict, 'REFUSED', `per-field storage must hold: ${r4.detail}`);

  // Contract pin: undeclared routes degrade to skipped-REFUSED.
  const skip = await idem.run(buildHarness({}, { env: RACE_ENV }), { submitRoute: 'charge' });
  assert.equal(skip.verdict, 'REFUSED');
  assert.ok(skip.skipped === true, `undeclared routes must skip, not fail: ${skip.detail}`);
});
