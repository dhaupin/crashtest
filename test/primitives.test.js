// Harness primitives (issues #14 + #15): step-scoped chain attacks and
// campaign-scoped state (vars / objects / groups). Additive onto the plain
// `run(harness, ctx) -> one record` contract - plain rows stay untouched,
// chains get per-step records with a summary verdict named by the flipped
// steps, vars/objects give packs deterministic cross-row data passing with
// loud late-key conflicts, groups grade one feature across many rows.
//
// House laws pinned here: honest-skip inherits (no false positives on
// undeclared routes), re-writes conflict loudly (late-key canary law),
// values are JSON-deterministic, findings name the step that flipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign } from '../src/campaigns/runner.js';
import { validateScenario } from '../src/scenarios/contract.js';
import { buildHarness } from '../src/harness/harness.js';
import { refused } from '../src/scenarios/contract.js';

const TAG = (mod) => ({ origin: 'test/primitives', module: mod });

const authRoutes = {
  // session-oracle: 'arm' mints (200 'session=...'), the exact code '123456'
  // replays a 200 session, anything else 4xx - shapes, not fixtures.
  auth: async ({ request }) => {
    const u = new URL(request.url);
    const stage = u.searchParams.get('stage');
    const code = u.searchParams.get('code');
    if (stage === 'arm') return new Response('session=000000', { status: 200 });
    if (code === '123456') return new Response('session ok', { status: 200 });
    return new Response('nope', { status: 400 });
  },
};

test('chains: steps grade per-step, summary holds across a full honest chain, state bag crosses steps', async () => {
  const harness = buildHarness(authRoutes);
  const mod = {
    name: 'otp-conversation',
    description: 'probe chain',
    attacks: [{
      name: 'steal-otp',
      description: 'the full conversation',
      steps: [
        { name: 'request-code', route: 'auth', init: () => ({ url: '/auth?stage=arm' }), expect: 200 },
        { name: 'wrong-code', route: 'auth', init: () => ({ url: '/auth?code=000000' }), expect: '4xx' },
        { name: 'arm-state', route: 'auth', init: (c) => { c.state.code = '123456'; c.state.tries = 3; return { url: '/auth?stage=arm' }; }, expect: '2xx' },
        { name: 'replay-window', route: 'auth', init: (c) => ({ url: `/auth?code=${c.state.code}` }), expect: 200 },
        { name: 'capping', route: 'auth', init: (c) => ({ url: `/auth?code=${c.state.tries}` }), expect: '429-or-4xx' },
        { name: 'ghost-step', route: 'ghost' },
      ],
    }],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const row = run.rows[0];
  assert.equal(row.verdict, 'REFUSED');
  assert.equal(row.evidence.steps.length, 6);
  const byName = Object.fromEntries(row.evidence.steps.map((s) => [s.name, s]));
  assert.equal(byName['request-code'].verdict, 'REFUSED');
  assert.equal(byName['wrong-code'].verdict, 'REFUSED');
  // the state bag crossed steps: replay-window's expect(200) only passes
  // because arm-state stashed the exact code in c.state
  assert.equal(byName['replay-window'].verdict, 'REFUSED');
  assert.equal(byName['ghost-step'].skip, true);
  assert.match(byName['ghost-step'].detail, /no route "ghost"/);
  assert.match(row.detail, /chain held: 6 steps .* ghost-step \(skip\)/);
  // plain rows stay untouched: the row shape carries the chain via evidence only
  assert.equal(row.id, 'otp-conversation/steal-otp');
});

test('chains: a flipped step EXPLOITEDs the chain, named by step; fuzz floor applies per-step', async () => {
  const harness = buildHarness({
    ...authRoutes,
    boom: async () => { throw new Error('handler fault'); },
  });
  const mod = {
    name: 'chain-flip',
    description: 'probe',
    attacks: [
      {
        name: 'escalate',
        description: 'probe',
        steps: [
          { name: 'opens', route: 'auth', init: () => ({ url: '/auth?stage=arm' }), expect: 200 },
          { name: 'wrong-code', route: 'auth', init: () => ({ url: '/auth?code=000000' }), expect: 200 }, // 4xx, wanted 200
          { name: 'still-honest', route: 'auth', init: () => ({ url: '/auth?stage=arm' }), expect: '2xx' },
        ],
      },
      {
        name: 'fuzz-floor',
        description: 'probe',
        steps: [{ name: 'throwing-step', route: 'boom' }], // no expect: floor alone
      },
    ],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const escalate = run.rows.find((r) => r.attack === 'escalate');
  assert.equal(escalate.verdict, 'EXPLOITED');
  assert.match(escalate.detail, /chain EXPLOITED at step: wrong-code/);
  const steps = Object.fromEntries(escalate.evidence.steps.map((s) => [s.name, s]));
  assert.equal(steps['still-honest'].verdict, 'REFUSED'); // later steps keep grading
  const floor = run.rows.find((r) => r.attack === 'fuzz-floor');
  assert.equal(floor.verdict, 'EXPLOITED');
  assert.match(floor.evidence.steps[0].detail, /uncaught throw: Error: handler fault/);
});

test('chains: custom grader functions and guard skips grade honestly', async () => {
  const harness = buildHarness(authRoutes);
  const mod = {
    name: 'chain-fn',
    description: 'probe',
    attacks: [{
      name: 'graded',
      description: 'probe',
      steps: [
        { name: 'shape-ok', route: 'auth', init: () => ({ url: '/auth?stage=arm' }), expect: (rec) => ({ ok: rec.status === 200, detail: `arm responded ${rec.status}` }) },
        { name: 'shape-bad', route: 'auth', init: () => ({ url: '/auth' }), expect: (rec) => rec.ok },
        { name: 'guarded-off', route: 'auth', guard: () => false },
      ],
    }],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const row = run.rows[0];
  const steps = Object.fromEntries(row.evidence.steps.map((s) => [s.name, s]));
  assert.match(steps['shape-ok'].detail, /arm responded 200/);
  assert.equal(steps['shape-bad'].verdict, 'EXPLOITED');
  assert.match(steps['shape-bad'].detail, /expect grader said not ok/);
  assert.equal(steps['guarded-off'].skip, true);
  assert.match(steps['guarded-off'].detail, /guard\(c\) returned false/);
});

test('validateScenario: chains validate loudly (run+steps mutually exclusive, step names, expect shapes, group names)', () => {
  const base = { name: 'm', description: 'd' };
  const both = { ...base, attacks: [{ name: 'x', run: () => {}, steps: [] }] };
  assert.throws(() => validateScenario(both), /declares both run and steps - pick one/);
  const empty = { ...base, attacks: [{ name: 'x', steps: [] }] };
  assert.throws(() => validateScenario(empty), /run\(harness, ctx\) - or a non-empty steps array/);
  const badName = { ...base, attacks: [{ name: 'x', steps: [{ name: 'Nope!' }] }] };
  assert.throws(() => validateScenario(badName), /step name must be kebab-case/);
  const dup = { ...base, attacks: [{ name: 'x', steps: [{ name: 'a' }, { name: 'a' }] }] };
  assert.throws(() => validateScenario(dup), /duplicate step name/);
  const badRoute = { ...base, attacks: [{ name: 'x', steps: [{ name: 'a', route: 42 }] }] };
  assert.throws(() => validateScenario(badRoute), /route must be a route name/);
  const badInit = { ...base, attacks: [{ name: 'x', steps: [{ name: 'a', init: (c, d) => {} }] }] };
  assert.throws(() => validateScenario(badInit), /init\(c\) takes at most one arg/);
  const badExpect = { ...base, attacks: [{ name: 'x', steps: [{ name: 'a', expect: [] }] }] };
  assert.throws(() => validateScenario(badExpect), /expect wants a status number/);
  const badGroup = { ...base, attacks: [{ name: 'x', run: () => {}, group: 'Nope!' }] };
  assert.throws(() => validateScenario(badGroup), /"group" wants a kebab-case name/);
  // a valid minimal chain passes
  const ok = { ...base, attacks: [{ name: 'x', steps: [{ name: 'a', route: 'r', expect: '4xx' }] }] };
  assert.equal(validateScenario(ok).attacks[0].steps.length, 1);
});

test('campaign vars: set across rows, reads never set are honest skips, conflicts explode loudly', async () => {
  const harness = buildHarness({ s: async () => new Response('ok') });
  const mod = {
    name: 'vars-lane',
    description: 'probe',
    attacks: [
      { name: 'minter', description: 'mints', run: async (h, ctx) => { ctx.vars.set('otp', '000123', 'vars-lane/minter'); return refused('minted'); } },
      { name: 'consumer', description: 'consumes', run: async (h, ctx) => (ctx.vars.has('otp') ? refused(`saw ${ctx.vars.get('otp')}`) : refused('skip honestly - var not set')) },
      { name: 're-minter', description: 'conflicts', run: async (h, ctx) => { ctx.vars.set('otp', '999999', 'vars-lane/re-minter'); return refused('re-minted'); } },
      { name: 'hostile', description: 'proto-canary', run: async (h, ctx) => { ctx.vars.set('canary', ({ __proto__: { x: 1 } }), 'vars-lane/hostile'); return refused('done'); } },
      { name: 'json-proto-data', description: 'proto-as-DATA', run: async (h, ctx) => { ctx.vars.set('probe', JSON.parse('{"__proto__":{"x":1}}'), 'vars-lane/json-proto-data'); return refused(`count=${Object.keys(JSON.parse('{"__proto__":{"x":1}}')).length}`); } },
    ],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const byName = Object.fromEntries(run.rows.map((r) => [r.attack, r]));
  assert.match(byName.consumer.detail, /saw 000123/);
  // re-writes conflict LOUDLY - the attack throw surfaces as an EXPLOITED row
  assert.equal(byName['re-minter'].verdict, 'EXPLOITED');
  assert.match(byName['re-minter'].detail, new RegExp('already set by .*vars-lane.*minter.*re-writes conflict loudly.*late-key canary law'));
  // the object-LITERAL poison (a var whose [[Prototype]] carries data) is
  // refused at cause - inheritance would poison later readers invisibly
  assert.equal(byName.hostile.verdict, 'EXPLOITED');
  assert.match(byName.hostile.detail, /not prototype-safe/);
  // ...while proto-as-JSON-DATA (own key, prototype-plain, round-trip
  // lossless) is legit deterministic data and passes
  assert.equal(byName['json-proto-data'].verdict, 'REFUSED');
  // the listing is sorted, key+writer only - nothing bloats the ledger
  assert.deepEqual(run.vars, [
    { key: 'otp', setBy: 'vars-lane/minter' },
    { key: 'probe', setBy: 'vars-lane/json-proto-data' },
  ]);
});

test('campaign vars: non-JSON values fail at cause naming the key', async () => {
  const harness = buildHarness({});
  const mod = {
    name: 'vars-lane',
    description: 'probe',
    attacks: [{
      name: 'fn-var', description: 'probe',
      run: async (h, ctx) => { ctx.vars.set('fn', () => {}); return refused('done'); },
    }],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  assert.equal(run.rows[0].verdict, 'EXPLOITED');
  assert.match(run.rows[0].detail, /"fn" value is not JSON round-trippable/);
});

test('campaign objects: wordier fixture handles cross rows by namespace, re-writes conflict, listing carries writers', async () => {
  const harness = buildHarness({});
  const mod = {
    name: 'objects-lane',
    description: 'probe',
    attacks: [
      { name: 'holder', description: 'mints', run: async (h, ctx) => { ctx.objects('fixtures').set('ledger', { rows: [1, 2] }, 'objects-lane/holder'); return refused('held'); } },
      { name: 'reader', description: 'reads', run: async (h, ctx) => (ctx.objects('fixtures').has('ledger') ? refused(`read ${JSON.stringify(ctx.objects('fixtures').get('ledger'))}`) : refused('skip honestly')) },
      { name: 'dupe', description: 'conflicts', run: async (h, ctx) => { ctx.objects('fixtures').set('ledger', {}, 'objects-lane/dupe'); return refused('duped'); } },
      { name: 'other-ns', description: 'other namespace', run: async (h, ctx) => { ctx.objects('other-ns').set('k', 1); return refused('other'); } },
    ],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const byName = Object.fromEntries(run.rows.map((r) => [r.attack, r]));
  assert.match(byName.reader.detail, /read {"rows":\[1,2\]}/);
  assert.equal(byName.dupe.verdict, 'EXPLOITED');
  assert.match(byName.dupe.detail, /campaign objects\('fixtures'\): "ledger" already set by/);
  assert.deepEqual(run.objects.map((o) => o.name), ['fixtures', 'other-ns']);
  assert.deepEqual(run.objects.find((o) => o.name === 'fixtures').keys.map((k) => k.key), ['ledger']);
  // bad namespace names fail loudly at call time
  const bad = {
    name: 'objects-lane', description: 'probe',
    attacks: [{ name: 'bad-ns', description: 'probe', run: async (h, ctx) => { ctx.objects('Nope!'); return refused('x'); } }],
  };
  const badRun = await runCampaign(buildHarness({}), [TAG(bad)]);
  assert.equal(badRun.rows[0].verdict, 'EXPLOITED');
  assert.match(badRun.rows[0].detail, /namespace name must be kebab-case/);
});

test('campaign groups: member rows keep their own records, the bundle grades the worst verdict', async () => {
  const harness = buildHarness({});
  const mod = {
    name: 'groups-lane',
    description: 'probe',
    attacks: [
      { name: 'a', description: 'probe', group: 'svc-healthy', run: async () => refused('held') },
      { name: 'b', description: 'probe', group: 'svc-healthy', run: async () => ({ verdict: 'EXPLOITED', detail: 'flipped' }) },
      { name: 'c', description: 'probe', group: 'other', run: async () => ({ verdict: 'BOUNDED', owner: 'team', bound: '1 per hour', detail: 'bounded' }) },
      { name: 'd', description: 'probe', run: async () => refused('no group') },
    ],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const svc = run.groups.find((g) => g.name === 'svc-healthy');
  assert.equal(svc.verdict, 'EXPLOITED');
  assert.deepEqual(svc.ids, ['groups-lane/a', 'groups-lane/b']);
  assert.equal(run.rows.find((r) => r.attack === 'a').verdict, 'REFUSED'); // per-row records intact
  assert.equal(run.groups.find((g) => g.name === 'other').verdict, 'BOUNDED');
  assert.equal(run.groups.find((g) => g.name === 'svc-healthy').verdict, 'EXPLOITED');
  // ungrouped rows appear in no group
  assert.equal(run.groups.length, 2);
});

test('campaign state: vars/objects/groups die with the campaign (two runs share nothing)', async () => {
  const harness = buildHarness({});
  const writerMod = {
    name: 'writer-mod', description: 'probe',
    attacks: [{ name: 'writer', description: 'wrote', run: async (h, ctx) => { ctx.vars.set('k', 'v1'); return refused('wrote'); } }],
  };
  const probeMod = {
    name: 'probe-mod', description: 'probe',
    attacks: [{ name: 'probe', description: 'probe', run: async (h, ctx) => refused(`has=${ctx.vars.has('k')}`) }],
  };
  validateScenario(writerMod);
  validateScenario(probeMod);
  const both = await runCampaign(harness, [TAG(writerMod), TAG(probeMod)]);
  assert.equal(both.rows.find((r) => r.attack === 'probe').detail, 'has=true');
  // a campaign WITHOUT the writer starts from nothing: no cross-run leakage
  const alone = await runCampaign(harness, [TAG(probeMod)]);
  assert.equal(alone.rows[0].detail, 'has=false');
  assert.deepEqual(alone.vars, []);
});

// ---- walk-13 teeth: the honest-skip flag ROUNDS THE RUNNER LOOP ---------
// Every library module sets skipped: true on skip records; the old runner
// record dropped it (nothing downstream read it), and a skipped-REFUSED row
// was indistinguishable from a plain hold in the ledger - vacuous-green veil.

test('walk-13: the skipped flag survives into run.rows and the built ledger findings (undefined JSON-drops otherwise)', async () => {
  const harness = buildHarness({});
  const mod = {
    name: 'skipflag-lane', description: 'probe',
    attacks: [
      { name: 'skips', description: 'probe', run: (h, ctx) => refused('route not declared - skipped', { skipped: true }) },
      { name: 'holds', description: 'probe', run: (h, ctx) => refused('held for real') },
    ],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  assert.equal(run.rows.find((r) => r.attack === 'skips').skipped, true);
  assert.equal(run.rows.find((r) => r.attack === 'holds').skipped, undefined);
  // JSON truth: only the skipping row carries the flag in artifact output.
  const blob = JSON.stringify({ rows: run.rows });
  assert.match(blob, /"skipped":true/);
  assert.equal(blob.match(/"skipped"/g).length, 1);
});

test('walk-13: an ALL-SKIP chain skips honestly (flag + wording) instead of vacuous "chain held"', async () => {
  const harness = buildHarness({}); // no routes - every step skips
  const mod = {
    name: 'allskip-chain', description: 'probe',
    attacks: [{ name: 'vacuous', description: 'probe', steps: [
      { name: 'a', route: 'ghost-a' },
      { name: 'b', route: 'ghost-b' },
    ] }],
  };
  validateScenario(mod);
  const run = await runCampaign(harness, [TAG(mod)]);
  const row = run.rows[0];
  assert.equal(row.verdict, 'REFUSED');
  assert.equal(row.skipped, true);
  assert.match(row.detail, /chain skipped: all 2 steps skipped/);
  // ...and a PARTIAL skip stays a plain hold (skips named in the summary).
  const harness2 = buildHarness({ real: async () => new Response('ok') });
  const mod2 = { ...mod, attacks: [{ ...mod.attacks[0], steps: [{ name: 'real', route: 'real' }, ...mod.attacks[0].steps] }] };
  const run2 = await runCampaign(harness2, [TAG(mod2)]);
  assert.equal(run2.rows[0].skipped, undefined);
  assert.match(run2.rows[0].detail, /chain held: 3 steps/);
});

test('walk-13: a step init returning a non-object reqInit fails LOUDLY (was a silent GET on "/")', async () => {
  const harness = buildHarness({ any: async () => new Response('ok') });
  for (const junk of ['GET-me', 42, ['url']]) {
    const mod = {
      name: 'junk-init', description: 'probe',
      attacks: [{ name: 'typo', description: 'probe', steps: [
        { name: 's1', route: 'any', init: () => junk },
      ] }],
    };
    validateScenario(mod);
    const run = await runCampaign(harness, [TAG(mod)]);
    const s1 = run.rows[0].evidence.steps[0];
    assert.equal(s1.verdict, 'EXPLOITED', `${JSON.stringify(junk)} must trip loudly: ${s1.detail}`);
    assert.match(s1.detail, /step "s1" init\(c\) returned a/);
  }
  // undefined/null still degrade honestly to {} (the default): no regression.
  const mod = {
    name: 'null-init-ok', description: 'probe',
    attacks: [{ name: 'fine', description: 'probe', steps: [{ name: 's2', route: 'any', init: () => null }] }],
  };
  const run = await runCampaign(harness, [TAG(mod)]);
  assert.equal(run.rows[0].evidence.steps[0].verdict, 'REFUSED');
});
