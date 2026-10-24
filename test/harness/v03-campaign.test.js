// The campaign-path seam, pinned two-way (the throwaway probe earned its keep).
//
// The unit rows (d1-v03.test.js / kv-v02.test.js) pin the engine directly and
// campaigns.test.js pins the verdict machinery - but nothing else exercises
// the union a real campaign takes: campaign -> runCampaign -> attack ->
// harness.run() -> handler -> FakeD1 v0.3. This file walks that path against
// the v0.3 surface (GROUP BY rollups, one-key JOINs, fake-clock date fns,
// ensureSchema DDL, KV cursor pagination): the disciplined run-root scores
// 5/5 REFUSED and the naive twin - the code an LLM writes on a bad day -
// scores 5/5 EXPLOITED. Same shape the v0.1 library's two-way proof
// (test/scenarios/attacks.test.js) established for the library rows.
//
// PAID-FOR TRAP, pinned here on purpose: seeding tables as RAW ARRAYS
// (`tables: { notes: [rowObj, ...] }`) silently produces EMPTY stores, and
// empty stores grade scope rows REFUSED from the outside - the careless
// fixture never even fails loudly. The correct shape is
// `tables: { notes: { rows: [...] } }`, and the hardened run also asserts
// the rollup actually SAW data, so a REFUSED can never be a false negative.
//
// The vulnerable twin's wall-clock handler is deliberate (that IS the
// exploit); it touches no committed artifacts, so determinism pins are not
// in play - the determinism bar covers shipped surfaces, not documented
// naive twins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../../src/harness/harness.js';
import { runCampaign } from '../../src/campaigns/runner.js';
import { FAKE_CLOCK_EPOCH } from '../../src/harness/d1.js';

const SEED = {
  notes: [
    { id: 1, owner: 'alice', tier: 'gold', created_at: '2026-02-02 02:40:00' },
    { id: 2, owner: 'alice', tier: 'silver', created_at: '2026-02-03 00:00:00' },
    { id: 3, owner: 'bob', tier: 'gold', created_at: '2026-02-04 00:00:00' },
    { id: 4, owner: 'bob', tier: 'gold', created_at: '2026-02-05 00:00:00' },
    { id: 5, owner: 'bob', tier: 'silver', created_at: '2026-02-06 00:00:00' },
  ],
  secrets: [
    { note_id: 1, label: 'alice-mine' },
    { note_id: 3, label: 'bob-supersecret' },
    { note_id: 4, label: 'bob-second-secret' },
  ],
};

function makeTarget({ vulnerable }) {
  const routes = {
    // v0.3 GROUP BY rollup - scope discipline on a shared table
    rollup: async ({ env, request }) => {
      const owner = new URL(request.url).searchParams.get('owner');
      const q = vulnerable
        ? 'SELECT owner, tier, COUNT(*) AS n FROM notes GROUP BY owner, tier ORDER BY n DESC'
        : 'SELECT tier, COUNT(*) AS n FROM notes WHERE owner = ? GROUP BY tier ORDER BY n DESC';
      const res = await env.DB.prepare(q).bind(...(vulnerable ? [] : [owner])).all();
      return Response.json({ rows: res.results });
    },
    // v0.3 one-key JOIN - secrets must not ride another owner's lookups
    join: async ({ env, request }) => {
      const owner = new URL(request.url).searchParams.get('owner');
      const q = vulnerable
        ? 'SELECT notes.id AS id, secrets.label AS label FROM notes JOIN secrets ON notes.id = secrets.note_id'
        : 'SELECT notes.id AS id, secrets.label AS label FROM notes JOIN secrets ON notes.id = secrets.note_id WHERE notes.owner = ?';
      const res = await env.DB.prepare(q).bind(...(vulnerable ? [] : [owner])).all();
      return Response.json({ got: res.results });
    },
    // v0.3 fake-clock date fn - the day bucket must be the FIXED epoch
    daybucket: async () => {
      // a v0.3 fake-clock bucket vs the wall-clock twin a naive handler writes
      const day = vulnerable
        ? Math.floor(Date.now() / 86400000) // (deliberate: this IS the exploit)
        : Math.floor(FAKE_CLOCK_EPOCH / 86400);
      return Response.json({ day });
    },
    // ensureSchema must be idempotent (CREATE TABLE IF NOT EXISTS rerun)
    ensure: async ({ env }) => {
      const a = await env.DB.prepare('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT)').run();
      if (vulnerable) {
        // the classic non-idempotent ensureSchema: bare CREATE on the rerun
        await env.DB.prepare('CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT)').run();
      }
      return Response.json({ created: a.meta.changes });
    },
    // KV cursor pagination honesty, graded from the client side
    kvpage: async ({ env }) => {
      for (let i = 0; i < 5; i++) await env.CACHE.put(`k${i}`, `${i}`);
      const page1 = await env.CACHE.list({ limit: 2 });
      return Response.json(vulnerable
        ? { ...page1, list_complete: true, cursor: undefined } // the LIE
        : page1);
    },
  };
  return buildHarness(routes, {
    env: { d1: { DB: { tables: { notes: { rows: SEED.notes }, secrets: { rows: SEED.secrets } } } }, kv: { CACHE: {} } },
  });
}

function makeScenario() {
  return {
    name: 'v03-engine-probe',
    description: 'live-campaign walk of the v0.3 engine surface (the permanent two-way receipt)',
    attacks: [
      {
        name: 'rollup-scope',
        async run(harness, ctx) {
          const rec = await harness.run('rollup', { url: `/x?owner=${ctx?.expectedOwner ?? 'alice'}`, method: 'GET' });
          if (rec.threw) return { verdict: 'EXPLOITED', detail: `rollup threw: ${rec.error?.message ?? '?'}` };
          const body = await rec.response.json();
          const leak = body.rows.some((r) => r.owner && r.owner !== 'alice');
          return { verdict: leak ? 'EXPLOITED' : 'REFUSED', detail: leak ? 'cross-owner rows in the GROUP BY rollup' : 'rollup scoped to the requested owner' };
        },
      },
      {
        name: 'join-secret-leak',
        async run(harness, ctx) {
          const rec = await harness.run('join', { url: `/x?owner=${ctx?.expectedOwner ?? 'alice'}`, method: 'GET' });
          if (rec.threw) return { verdict: 'EXPLOITED', detail: `join threw: ${rec.error?.message ?? '?'}` };
          const body = await rec.response.json();
          const leak = body.got.some((r) => String(r.label).startsWith('bob-'));
          return { verdict: leak ? 'EXPLOITED' : 'REFUSED', detail: leak ? "another owner's secret labels rode the JOIN" : 'JOIN filtered by owner' };
        },
      },
      {
        name: 'day-bucket-determinism',
        async run(harness) {
          const rec = await harness.run('daybucket', { method: 'GET' });
          const body = await rec.response.json();
          const expected = Math.floor(FAKE_CLOCK_EPOCH / 86400);
          return { verdict: body.day === expected ? 'REFUSED' : 'EXPLOITED', detail: `day=${body.day} (the fixed-epoch bucket is ${expected})` };
        },
      },
      {
        name: 'ensure-schema-idempotent',
        async run(harness) {
          const a = await harness.run('ensure', { method: 'GET' });
          if (a.threw) return { verdict: 'EXPLOITED', detail: `ensureSchema threw on the FIRST call: ${a.error?.message ?? '?'}` };
          const first = await a.response.json();
          const b = await harness.run('ensure', { method: 'GET' });
          if (b.threw) return { verdict: 'EXPLOITED', detail: `ensureSchema re-ran destructively: ${b.error?.message ?? '?'}` };
          const second = await b.response.json();
          const clean = first.created === 0 && second.created === 0;
          return { verdict: clean ? 'REFUSED' : 'EXPLOITED', detail: clean ? 'rerun stayed meta.changes 0' : `changes ${first.created}/${second.created}` };
        },
      },
      {
        name: 'kv-cursor-honesty',
        async run(harness) {
          const rec = await harness.run('kvpage', { method: 'GET' });
          const body = await rec.response.json();
          const honest = body.list_complete === false && body.cursor != null;
          return { verdict: honest ? 'REFUSED' : 'EXPLOITED', detail: honest ? 'honest page + real cursor' : 'pagination lied (list_complete true with more keys)' };
        },
      },
    ],
  };
}

const runTwoWay = async (vulnerable) =>
  runCampaign(makeTarget({ vulnerable }), [{ origin: 'test/harness/v03-campaign.test.js', module: makeScenario() }]);

test('v0.3 campaign seam: the disciplined run-root walks the whole surface REFUSED (5/5), with REAL data (no empty-store false negative)', async () => {
  const res = await runTwoWay(false);
  assert.deepEqual(res.tally, { TOTAL: 5, REFUSED: 5, EXPLOITED: 0, BOUNDED: 0 });
  for (const r of res.rows) assert.equal(r.verdict, 'REFUSED', `${r.attack}: ${r.detail}`);
  // anti-false-negative: the rollup MUST have seen alice's rows - an empty
  // store (the raw-array seeding trap) would also "pass" this row
  const probe = makeTarget({ vulnerable: false });
  const direct = await probe.run('rollup', { url: '/x?owner=alice', method: 'GET' });
  const body = await direct.response.json();
  assert.equal(body.rows.reduce((s, r) => s + r.n, 0), 2, 'alice owns exactly 2 notes - the rollup path saw REAL data');
});

test('v0.3 campaign seam: the naive twin flips ALL five rows EXPLOITED at the campaign path', async () => {
  const res = await runTwoWay(true);
  assert.deepEqual(res.tally, { TOTAL: 5, REFUSED: 0, EXPLOITED: 5, BOUNDED: 0 });
  const names = res.rows.filter((r) => r.verdict === 'EXPLOITED').map((r) => r.attack).sort();
  assert.deepEqual(names, [
    'day-bucket-determinism',
    'ensure-schema-idempotent',
    'join-secret-leak',
    'kv-cursor-honesty',
    'rollup-scope',
  ]);
});
