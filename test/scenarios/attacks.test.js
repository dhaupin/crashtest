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
