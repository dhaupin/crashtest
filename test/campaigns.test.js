// S1.3 - campaign runner + verdict aggregation, on fixture apps shaped like
// real agent-built Cloudflare Pages handlers. Two-way invariant runs through
// EVERY seed library: vulnerable app -> EXPLOITED rows, hardened app -> REFUSED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';
import { loadScenarios } from '../src/scenarios/loader.js';
import { runCampaign } from '../src/campaigns/runner.js';
import { loadPacks } from '../src/packs/loader.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

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
      if (!['key', 'owner'].includes(k)) return new Response('unknown field (allowed: key, owner)', { status: 400 });
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
      if (!['key', 'owner'].includes(k)) return new Response('unknown field (allowed: key, owner)', { status: 400 });
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
  assert.ok(run.rows.length >= 8, `expected >=8 attacks, got ${run.rows.length}`);
  for (const row of run.rows) {
    assert.ok(['REFUSED', 'EXPLOITED', 'BOUNDED', 'PASSED'].includes(row.verdict), `${row.id}: ${row.verdict}`);
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
  assert.ok(ids.has('auth/identity-spoof-headers'), `x-is-admin spoof must flip 403->200 on admin (${[...ids]})`);
  assert.ok(ids.has('guards/hygiene-no-store'), 'bare 2xx write without Cache-Control must be a finding');
  assert.ok(ids.has('input/proto-pollution-body'), 'unvalidated merge surfaces the canary');
});

test('campaign: deterministic - same seed + same app -> identical rows, twice', async () => {
  const scenarios = await loadScenarios();
  const a = await runCampaign(hardHarness(), scenarios, { seed: 777 });
  const b = await runCampaign(hardHarness(), scenarios, { seed: 777 });
  assert.deepEqual(a.rows.map(r => [r.id, r.verdict, r.detail]), b.rows.map(r => [r.id, r.verdict, r.detail]));
  assert.deepEqual(a.tally, b.tally);
});

test('campaign: module beforeAll/afterall hooks fire once per module, in order, with moduleCtx + seed (contract hooks are LIVE - issue #7)', async () => {
  // Pins the lifecycle the contract promised: the validator arity-checks
  // beforeAll/afterAll, and the runner was the missing invocation - a pack
  // (gistory's sync-relay-shapes) builds its one-loud arming check here, so
  // a hook that never ran would have made that a fiction.
  const events = [];
  const scenarios = [{
    origin: 'hooks',
    module: {
      name: 'hooky-pack',
      description: 'lifecycle hook fixture',
      beforeAll: async (ctx) => { events.push(['beforeAll', ctx.seed, ctx.vocab ?? null]); },
      attacks: [
        { name: 'first-attack', description: 'a', run: async () => { events.push(['attack', 'first-attack']); return { verdict: 'REFUSED', detail: 'ok' }; } },
        { name: 'second-attack', description: 'b', run: async () => { events.push(['attack', 'second-attack']); return { verdict: 'REFUSED', detail: 'ok' }; } },
      ],
      afterAll: async (ctx) => { events.push(['afterAll', ctx.seed]); },
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, { seed: 555, moduleCtx: { 'hooky-pack': { vocab: 'enroll' } } });
  assert.deepEqual(run.tally, { TOTAL: 2, REFUSED: 2, EXPLOITED: 0, BOUNDED: 0, PASSED: 0 });
  assert.deepEqual(run.rows.map(r => r.id), ['hooky-pack/first-attack', 'hooky-pack/second-attack']);
  assert.deepEqual(events, [
    ['beforeAll', 555, 'enroll'],
    ['attack', 'first-attack'],
    ['attack', 'second-attack'],
    ['afterAll', 555],
  ]);
});

test('campaign: a throwing beforeAll fails the campaign loudly at cause (rule 3, issue #7 arming)', async () => {
  const scenarios = [{
    origin: 'bad-hook',
    module: {
      name: 'bad-hook-pack',
      description: 'throwing arming check',
      beforeAll: () => { throw new TypeError('vocabulary gap: "enroll" route missing from this target'); },
      attacks: [{ name: 'never-attack', description: 'n', run: async () => ({ verdict: 'REFUSED', detail: 'no' }) }],
    },
  }];
  await assert.rejects(() => runCampaign(buildHarness({}, {}), scenarios, { seed: 1 }), /vocabulary gap: "enroll" route missing/);
});

test('campaign: a skipped EXPLOITED record fails loud at cause (the honest-skip contract)', async () => {
  // `skipped` is the no-coverage marker for REFUSED rows only (PRD section 7
  // / issue #37). A skipped EXPLOITED would ride the exit rules as a fake
  // finding WHILE claiming nothing was graded - the first cut of
  // wp-roles' vocabulary-miswire branch shipped exactly that shape, found
  // on walk round 20. The runner fails loud with the offending name, and
  // the check sits outside the attack try/catch so the fault cannot be
  // re-advertised as an "attack itself threw" finding row.
  const scenarios = [{
    origin: 'skip-shape',
    module: {
      name: 'bad-skip-pack',
      description: 'contract-violating verdict shape',
      attacks: [{ name: 'fake-skip', description: 'f', run: async () => ({ verdict: 'EXPLOITED', detail: 'claims a skip', skipped: true }) }],
    },
  }];
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { seed: 1 }),
    /bad-skip-pack\/fake-skip.*verdict EXPLOITED carrying skipped: true/,
  );
});

// --- the silent-zero campaign guards (the same misfire class as packstruct#13) ------------

test('campaign: a module filter that matches NOTHING refuses loudly (a typo can never green a zero-row run)', async () => {
  const scenarios = [{
    origin: 'filter-fixture',
    module: {
      name: 'real-module',
      description: 'one real module',
      attacks: [{ name: 'held-attack', description: 'a', run: async () => ({ verdict: 'REFUSED', detail: 'ok' }) }],
    },
  }];
  // The classic typo: one dropped vowel, and every loaded module filters out.
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { modules: ['real-modul'] }),
    (e) => /module filter matched nothing/.test(e.message)
      && e.message.includes('"real-modul"')
      && e.message.includes('loaded modules: real-module'),
  );
  // An EMPTY filter is the same misfire by construction.
  await assert.rejects(() => runCampaign(buildHarness({}, {}), scenarios, { modules: [] }), /module filter matched nothing: \[\]/);
});

test('campaign: a filter that MATCHES a loaded module runs its rows - the guard narrows, never widens', async () => {
  const scenarios = [{
    origin: 'filter-fixture',
    module: {
      name: 'kept-module',
      description: 'matched module',
      attacks: [{ name: 'held-attack', description: 'a', run: async () => ({ verdict: 'REFUSED', detail: 'ok' }) }],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, { modules: ['kept-module'] });
  assert.deepEqual(run.tally, { TOTAL: 1, REFUSED: 1, EXPLOITED: 0, BOUNDED: 0, PASSED: 0 });
  assert.deepEqual(run.rows.map((r) => r.id), ['kept-module/held-attack']);
});

test('campaign: no filter at all keeps the full slate (unchanged default behavior)', async () => {
  const scenarios = [{
    origin: 'filter-fixture',
    module: {
      name: 'plain-module',
      description: 'unfiltered module',
      attacks: [
        { name: 'held-attack', description: 'a', run: async () => ({ verdict: 'REFUSED', detail: 'ok' }) },
        { name: 'kept-attack', description: 'b', run: async () => ({ verdict: 'REFUSED', detail: 'ok' }) },
      ],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, {});
  assert.equal(run.tally.TOTAL, 2);
});

// --- the ctx.config arming contract + the ctx-knob census (the misfire class, round two) ------------

test('campaign: ctx.config[<module>] carries the namespaced vocabulary - the scaffold arming contract is TRUE now, both read paths arm', async () => {
  let seen = null;
  const scenarios = [{
    origin: 'config-probe',
    module: {
      name: 'probe-mod',
      description: 'probe',
      attacks: [{ name: 'probe-attack', description: 'p', async run(h, ctx) {
        seen = {
          flat: ctx.postType,
          viaConfig: ctx?.config?.['probe-mod']?.postType ?? null,
          scaffoldShape: (() => { const cfg = ctx?.config?.['probe-mod'] ?? null; return typeof cfg === 'object' && cfg !== null; })(),
          otherModuleHidden: ctx?.config?.['other-mod'] ?? 'namespaced',
        };
        return { verdict: 'REFUSED', detail: 'ok' };
      } }],
    },
  }];
  await runCampaign(buildHarness({}, {}), scenarios, { moduleCtx: { 'probe-mod': { postType: 'shop_order' } } });
  assert.equal(seen.flat, 'shop_order', 'the top-level spread stays (the wp-roles vocabulary)');
  assert.equal(seen.viaConfig, 'shop_order', 'ctx.config[<name>] now arms exactly as the scaffolds teach');
  assert.equal(seen.scaffoldShape, true, 'the scaffold stub read (ctx?.config?.[<name>] ?? null) resolves non-null');
  assert.equal(seen.otherModuleHidden, 'namespaced', 'config is only reachable through the module key, never flattened across modules');
});

test('campaign: orphan moduleCtx/attackCtx keys refuse loud with both available target lists (census, rule 3)', async () => {
  const scenarios = [{
    origin: 'knob-fixture',
    module: {
      name: 'knob-mod',
      description: 'knob module',
      attacks: [{ name: 'held-attack', description: 'a', run: async () => ({ verdict: 'REFUSED', detail: 'ok' }) }],
    },
  }];
  // A typo'd moduleCtx key: the pack would arm as "not armed" and skip - the veil.
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { moduleCtx: { 'knob-mo': { vocab: 'x' } } }),
    (e) => /ctx knobs matched nothing: moduleCtx\['knob-mo'\]/.test(e.message)
      && e.message.includes('loaded modules: knob-mod'),
  );
  // A typo'd attackCtx key: the override silently applies nothing (worst: cost knobs).
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { attackCtx: { 'knob-mod/held-atk': { maxOps: 5 } } }),
    (e) => /ctx knobs matched nothing: attackCtx\['knob-mod\/held-atk'\]/.test(e.message)
      && e.message.includes('attack ids: knob-mod/held-attack'),
  );
});

test('campaign: matched knobs keep running beside the census (guards narrow, never widen)', async () => {
  const scenarios = [{
    origin: 'knob-fixture',
    module: {
      name: 'knob-mod',
      description: 'knob module',
      attacks: [{ name: 'held-attack', description: 'a', async run(h, ctx) { return { verdict: 'REFUSED', detail: `vocab:${ctx.vocab ?? 'none'}:ops:${ctx.maxOps ?? 'unset'}` }; } }],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, {
    moduleCtx: { 'knob-mod': { vocab: 'enroll' } },
    attackCtx: { 'knob-mod/held-attack': { maxOps: 5 } },
  });
  assert.equal(run.rows[0].detail, 'vocab:enroll:ops:5', 'both knob vocabularies apply on matched keys');
});

test('campaign: the SHIPPED wp-money-shapes pack arms through ctx.config - the honest-skip veil can never hide a dead arming contract again', async () => {
  // Regression pin for the runner shape this batch fixed: the pack reads
  // ctx.config['wp-money-shapes'] (per the scaffolds), the runner never set
  // it, and every row graded "not armed" REFUSED forever - a misfire hidden
  // behind the legitimate skip. Armed through the real loader + runner now.
  const packs = await loadPacks([join(REPO, 'packs', 'public', 'wp-money-shapes')]);
  assert.equal(packs.length, 1);
  const vocab = {
    postType: 'ct-shop-order', metaPaid: '_ct_paid', metaEmail: '_ct_email',
    optionKey: 'ct_money_settings', action: 'ct_probe_checkout',
    nonceAction: 'ct_probe_checkout', pacedHints: 'ct-paced',
  };
  const run = await runCampaign(buildHarness({}, {}), packs.map((p) => ({ origin: p.origin, module: p.module })), { moduleCtx: { 'wp-money-shapes': vocab } });
  assert.equal(run.rows.length, 3, 'the three money shapes ran');
  assert.ok(
    !run.rows.some((r) => r.detail.includes('Declare the moduleCtx vocabulary')),
    'no row may claim the vocab is missing while the config arms it: ' + run.rows.map((r) => r.detail).join(' | '),
  );
  // The target below has NO wordpress adapter - the mount gate now skips
  // honestly (REFUSED) instead of throwing harness-wide faults graded
  // EXPLOITED. That listener fix is the second half of this pin: a misfired
  // config degrades to skipped-REFUSED, never a false-positive EXPLOITED row.
  assert.ok(run.rows.every((r) => r.verdict === 'REFUSED'), 'honest skips stay REFUSED (no false positives)');
});

test('campaign: per-attack REQUESTS are per-attack truth - a two-attack module no longer bills 1+2+...+n', async () => {
  // The old baseline was module-level, so attack #2's `requests` counted
  // attack #1's requests too: totals.requests inflated triangularly. The
  // ledger's economics line is CI-facing - a doubled request count is a
  // cost-accounting lie, the same silence class as a green gate.
  const h = buildHarness({
    hit: async () => new Response('ok'),
    miss: async () => new Response('no', { status: 403 }),
  });
  const mod = { name: 'two-attacks', description: 'd', attacks: [
    { name: 'first', async run(hc) { await hc.run('hit'); return { verdict: 'REFUSED', detail: 'held' }; } },
    { name: 'second', async run(hc) { await hc.run('miss'); return { verdict: 'REFUSED', detail: 'held' }; } },
  ] };
  const run = await runCampaign(h, [{ origin: 'lib', module: mod }]);
  assert.equal(run.rows[0].requests, 1, 'attack #1 made one request and must report one');
  assert.equal(run.rows[1].requests, 1, 'attack #2 made one request and must report exactly one (not the cumulative 2)');
  assert.equal(run.cost.totals.requests, 2, 'totals.requests counts actual requests, not cumulative rows');
  assert.equal(run.cost.totals.ops, 2, 'ops stay route.invoke-counted');
});

test('issue #83: declared-isolated rows race N-wide and land in original order', async () => {
  // Three rows that each hold no cross-row state declare `isolated: true`.
  // With concurrency 3 + a harnessFactory, they run concurrently on SEPARATE
  // harnesses, but the output rows keep ORIGINAL order (determinism).
  const factory = () => buildHarness({ hit: async () => new Response('ok') });
  const live = new Set();
  let peak = 0;
  const mk = (name, delay) => ({
    name,
    isolated: true,
    async run(hc) {
      live.add(name);
      peak = Math.max(peak, live.size);
      await new Promise((r) => setTimeout(r, delay));
      await hc.run('hit');
      live.delete(name);
      return { verdict: 'REFUSED', detail: 'held' };
    },
  });
  const mod = { name: 'racy', description: 'd', attacks: [mk('a', 30), mk('b', 20), mk('c', 10)] };
  const run = await runCampaign(factory(), [{ origin: 'lib', module: mod }], { concurrency: 3, harnessFactory: factory });
  assert.deepEqual(run.rows.map((r) => r.id), ['racy/a', 'racy/b', 'racy/c'], 'original order preserved despite completion order');
  assert.equal(peak, 3, 'all three raced at once');
  assert.deepEqual(run.tally, { TOTAL: 3, REFUSED: 3, EXPLOITED: 0, BOUNDED: 0, PASSED: 0 });
});

test('issue #83: concurrency 1 (the default) never races - serial behavior is unchanged', async () => {
  const factory = () => buildHarness({ hit: async () => new Response('ok') });
  let peak = 0;
  let live = 0;
  const mk = (name) => ({
    name,
    isolated: true,
    async run(hc) {
      live += 1; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      await hc.run('hit');
      live -= 1;
      return { verdict: 'REFUSED', detail: 'held' };
    },
  });
  const mod = { name: 'serial', description: 'd', attacks: [mk('a'), mk('b')] };
  const run = await runCampaign(factory(), [{ origin: 'lib', module: mod }], { harnessFactory: factory });
  assert.equal(peak, 1, 'default concurrency is 1 - no row races');
  assert.equal(run.rows.length, 2);
});

test('issue #83: a non-integer or sub-1 concurrency refuses at the library boundary (zero-worker hole)', async () => {
  // The CLI screens --concurrency, but runCampaign is a public library entry
  // (package `main`), so a caller can pass "abc"/null/1.5/0 directly. Left
  // unguarded, `Math.min(NaN, n)` is NaN -> Array.from({length: NaN}) -> ZERO
  // workers -> every isolated row silently never runs and the campaign reads
  // as a clean zero-row pass. Refuse it by name instead.
  const factory = () => buildHarness({ hit: async () => new Response('ok') });
  const mk = (name) => ({ name, isolated: true, async run(hc) { await hc.run('hit'); return { verdict: 'REFUSED', detail: 'held' }; } });
  const mod = { name: 'guard', description: 'd', attacks: [mk('a'), mk('b')] };
  for (const bad of ['abc', null, 0, -1, 1.5, NaN]) {
    await assert.rejects(
      () => runCampaign(factory(), [{ origin: 'lib', module: mod }], { concurrency: bad, harnessFactory: factory }),
      /concurrency wants a positive integer/,
      `concurrency ${JSON.stringify(bad)} must refuse, not run zero workers`,
    );
  }
  // The valid default and an explicit positive integer still run.
  const ok = await runCampaign(factory(), [{ origin: 'lib', module: mod }], { concurrency: 2, harnessFactory: factory });
  assert.equal(ok.rows.length, 2, 'a valid concurrency still runs every row');
});

test('issue #83: a module with lifecycle hooks never races (the hook state is shared)', async () => {
  const factory = () => buildHarness({ hit: async () => new Response('ok') });
  let peak = 0;
  let live = 0;
  const mk = (name) => ({ name, isolated: true, async run(hc) { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 10)); await hc.run('hit'); live -= 1; return { verdict: 'REFUSED', detail: 'held' }; } });
  const mod = { name: 'hooked', description: 'd', beforeAll: async () => {}, attacks: [mk('a'), mk('b')] };
  const run = await runCampaign(factory(), [{ origin: 'lib', module: mod }], { concurrency: 4, harnessFactory: factory });
  assert.equal(peak, 1, 'hooks force the serial fallback');
  assert.equal(run.rows.length, 2);
});

test('issue #83: per-row costDelta + needs/isolation declarations land on the record', async () => {
  const h = buildHarness({ hit: async () => new Response('ok'), miss: async () => new Response('no', { status: 403 }) });
  const mod = { name: 'rows', description: 'd', attacks: [
    { name: 'one', needs: ['kv', 'd1'], isolated: true, async run(hc) { await hc.run('hit'); return { verdict: 'REFUSED', detail: 'held' }; } },
    { name: 'two', async run(hc) { await hc.run('miss'); return { verdict: 'REFUSED', detail: 'held' }; } },
  ] };
  const run = await runCampaign(h, [{ origin: 'lib', module: mod }]);
  const one = run.rows.find((r) => r.attack === 'one');
  assert.deepEqual(one.needs, ['d1', 'kv'], 'needs normalizes to a sorted list');
  assert.equal(one.isolated, true);
  assert.equal(one.costDelta.ops, 1, 'the row reports its own op delta');
  assert.equal(one.costDelta['route.invoke'], 1);
  const two = run.rows.find((r) => r.attack === 'two');
  assert.equal(two.needs, undefined, 'a row that declares nothing carries no needs key');
  assert.equal(two.isolated, undefined);
  assert.equal(two.durationMs, undefined, 'wall time is off by default - a committed ledger stays byte-stable');
});

test('issue #83: opts.timing adds per-row durationMs (accounting info, never a verdict input)', async () => {
  const h = buildHarness({ hit: async () => new Response('ok') });
  const mod = { name: 'timed', description: 'd', attacks: [
    { name: 'a', async run(hc) { await hc.run('hit'); return { verdict: 'REFUSED', detail: 'held' }; } },
  ] };
  const run = await runCampaign(h, [{ origin: 'lib', module: mod }], { timing: true });
  assert.equal(typeof run.rows[0].durationMs, 'number', 'timing on -> the row carries a duration');
  assert.ok(run.rows[0].durationMs >= 0);
});

