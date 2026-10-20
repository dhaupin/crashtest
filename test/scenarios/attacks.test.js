// S1.2 — the two-way proof. The same seed scenario library must EXPLOIT a
// vulnerable fixture and be REFUSED by a hardened one — exactly the finding
// semantics the report will surface (PRD §7).
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
      // no validation at all — string coercion on hostile values
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
  // agent-authored bug: trust the client, size-limit at the wrong layer —
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
