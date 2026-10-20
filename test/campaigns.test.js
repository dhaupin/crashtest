// S1.3 — campaign runner + verdict aggregation, on fixture apps shaped like
// real agent-built Cloudflare Pages handlers. Two-way invariant runs through
// EVERY seed library: vulnerable app → EXPLOITED rows, hardened app → REFUSED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';
import { loadScenarios } from '../src/scenarios/loader.js';
import { runCampaign } from '../src/campaigns/runner.js';

const envSpec = {
  d1: { DB: { tables: { devices: { rows: [{ id: 1, key: 'seed', owner: 'rook' }], uniques: { key_unique: ['key'] } } } } },
  secrets: { CRASHTEST_SECRET: 'v0.1-fake-secret-7f83b', STRIPE_SECRET: 'v0.1-fake-stripe-91aa2' },
};

function mergeVulnerable(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (!target[key]) target[key] = {};
      mergeVulnerable(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// ---------- vulnerable fixture: the classic agent-app assumptions ----------
const vulnerableRoutes = {
  enroll: async ({ request, env }) => {
    const body = await request.json();             // trusts every field
    if (typeof body !== 'object' || body === null) return new Response('bad', { status: 400 });
    const record = {};                             // vulnerable merge: hostile keys followed
    mergeVulnerable(record, body);                 // (proto-pollution canary can land here)
    const res = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)')
      .bind(String(record.key), String(record.owner)).run();    // no length check, no owner validation
    return Response.json({ ok: true, id: res.meta.last_row_id }); // no Cache-Control
  },
  device: async ({ request, env }) => {
    const body = await request.json();
    if (body.owner !== 'admin') return new Response('403: admins set their own owner', { status: 403 }); // trusts the very field being written
    const res = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)')
      .bind(String(body.key), String(body.owner)).run();
    return Response.json({ ok: true }, { status: 201 });
  },
  admin: async ({ request, env }) => {
    const role = request.headers.get('x-is-admin') ?? request.headers.get('x-user-role'); // trusts headers
    if (role === 'admin' || role === 'true') {
      const all = await env.DB.prepare('SELECT COUNT(*) FROM devices').first('count');
      return Response.json({ all: Number(all) });
    }
    return new Response('403: admin only', { status: 403 });
  },
};
const vulnHarness = () => buildHarness(vulnerableRoutes, { env: envSpec });

// ---------- hardened fixture: allow-lists + hygiene + validation-only storage ----------
const hardenedRoutes = {
  enroll: async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    if (typeof body !== 'object' || body === null) return new Response('bad', { status: 400 });
    for (const k of Object.keys(body)) {
      if (!['key', 'owner'].includes(k)) return new Response(`unknown field: ${k}`, { status: 400 });
    }
    if (typeof body.key !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.key)) {
      return new Response('invalid key', { status: 400 });
    }
    if (typeof body.owner !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.owner)) {
      return new Response('invalid owner', { status: 400 });
    }
    try {
      const res = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)')
        .bind(body.key, body.owner).run();
      return Response.json({ ok: true, id: res.meta.last_row_id }, {
        status: 201,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (err) {
      if (String(err?.message).includes('UNIQUE constraint')) return new Response('key conflict', { status: 409 });
      throw err;
    }
  },
  admin: async ({ request }) => {
    // Header-blind: admin gate reads a server-signed session only. Anonymous
    // requests are denied regardless of headers.
    return new Response('403: admin only', { status: 403 });
  },
  device: async ({ request, env }) => {
    let body;
    try { body = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
    for (const k of Object.keys(body ?? {})) {
      if (!['key', 'owner'].includes(k)) return new Response(`unknown field: ${k}`, { status: 400 });
    }
    if (typeof body?.owner !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.owner)) {
      return new Response('invalid owner', { status: 400 });
    }
    if (body.owner !== 'rook') return new Response('403: only rook writes devices', { status: 403 });
    try {
      await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)').bind(body.key ?? 'p1', body.owner).run();
      return new Response('ok', { status: 201, headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      if (String(err?.message).includes('UNIQUE')) return new Response('conflict', { status: 409 });
      throw err;
    }
  },
};
const hardHarness = () => buildHarness(hardenedRoutes, { env: envSpec });

test('campaign: every scenario attack produces a verdict row with cost', async () => {
  const scenarios = await loadScenarios();
  const run = await runCampaign(hardHarness(), scenarios, { seed: 123 });
  assert.ok(run.rows.length >= 8, `expected ≥8 attacks, got ${run.rows.length}`);
  for (const row of run.rows) {
    assert.ok(['REFUSED', 'EXPLOITED', 'BOUNDED'].includes(row.verdict), `${row.id}: ${row.verdict}`);
    assert.equal(typeof row.costDelta.ops, 'number', `${row.id} cost`);
    assert.ok(row.costDelta.ops >= 0);
  }
  assert.ok(run.tally.TOTAL === run.rows.length);
  assert.ok(run.cost.totals.ops > 0);
});

test('campaign: hardened fixture is clean (REFUSED everywhere, no exploited)', async () => {
  const scenarios = await loadScenarios();
  const run = await runCampaign(hardHarness(), scenarios, { seed: 123 });
  assert.deepEqual(run.exploited, [], run.exploited.map(r => `${r.id}: ${r.detail}`).join('\n'));
  assert.equal(run.tally.REFUSED, run.tally.TOTAL);
});

test('campaign: vulnerable fixture tripwires (auth bypass, leak, hygiene missing)', async () => {
  const scenarios = await loadScenarios();
  const run = await runCampaign(vulnHarness(), scenarios, { seed: 123 });
  const ids = new Set(run.exploited.map(r => r.id));
  assert.ok(ids.has('auth/identity-spoof-headers'), `x-is-admin spoof must flip 403→200 on admin (${[...ids]})`);
  assert.ok(ids.has('guards/hygiene-no-store'), 'bare 2xx write without Cache-Control must be a finding');
  assert.ok(ids.has('input/proto-pollution-body'), 'unvalidated merge surfaces the canary');
});

test('campaign: deterministic — same seed + same app → identical rows, twice', async () => {
  const scenarios = await loadScenarios();
  const a = await runCampaign(hardHarness(), scenarios, { seed: 777 });
  const b = await runCampaign(hardHarness(), scenarios, { seed: 777 });
  assert.deepEqual(a.rows.map(r => [r.id, r.verdict, r.detail]), b.rows.map(r => [r.id, r.verdict, r.detail]));
  assert.deepEqual(a.tally, b.tally);
});
