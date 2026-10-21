// next-middleware-shapes pack teeth: two-way proof, in-process, zero sockets.
//
//   1. vulnerable middleware - bare gated (403), known grammar served ->
//      mw-bypass-grammar EXPLOITED (grammar named).
//   2. value-blind middleware - bare 403, ANY value served, known grammar
//      served -> both attacks EXPLOITED (the CVE grammar for one, the
//      canary for the other).
//   3. hardened middleware   - known grammar stays gated, canary stays
//      gated -> both honest REFUSED.
//   4. open wire             - everything 2xx -> both honest REFUSED
//      (nothing gated to bypass - posture notes, not fake exploits).
//   5. empty run root        -> honest skipped-REFUSED rows.
//   6. ctx.routes whitelist narrows the sweep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';

const pack = (await import('../packs/public/next-middleware-shapes/index.js')).default;
const attacks = Object.fromEntries(pack.attacks.map((a) => [a.name, a]));
const HEADER = 'x-middleware-subrequest';

const MW_GRAMMARS = [
  'middleware',
  'middleware:middleware:middleware:middleware:middleware',
  'src/middleware',
  'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware',
  'pages/_middleware',
];

const BARE = { probe: 403 };

function mwStandIn(request, { mode }) {
  const header = request.headers.get(HEADER);
  const isKnownGrammar = header != null && MW_GRAMMARS.includes(header);
  const hasAnyValue = header != null && header.length > 0;

  if (mode === 'vulnerable') {
    // the pre-fix shape: a KNOWNgrammar value makes the runtime skip the gate
    return (BARE.probe && !isKnownGrammar)
      ? new Response('forbidden', { status: 403 })
      : new Response('protected region body');
  }
  if (mode === 'value-blind') {
    return (BARE.probe && !hasAnyValue)
      ? new Response('forbidden', { status: 403 })
      : new Response('protected region body');
  }
  if (mode === 'hardened') {
    // post-fix shape: the gate verifies the caller chain - the canary
    // probe value (not a real chain member) never unlocks it either.
    if (isKnownGrammar || hasAnyValue) {
      return new Response('forbidden', { status: 403 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (mode === 'open') {
    return new Response('open region');
  }
  throw new Error(`unknown mode ${mode}`);
}

const harnessModes = (mode) => buildHarness({
  protected: ({ request }) => mwStandIn(request, { mode }),
});

test('next-middleware-shapes teeth: the vulnerable middleware catches the CVE grammar', async () => {
  const harness = harnessModes('vulnerable');
  const verdict = await attacks['mw-bypass-grammar'].run(harness, {});
  assert.equal(verdict.verdict, 'EXPLOITED', `grammar differential must trip: ${verdict.detail}`);
  assert.match(verdict.detail, /middleware skipped/);
  // value probe on this wire: unknown values stay gated -> honest REFUSED
  const blind = await attacks['mw-value-blindness'].run(harness, {});
  assert.equal(blind.verdict, 'REFUSED', `an unknown chain value must stay gated: ${blind.detail}`);
});

test('next-middleware-shapes teeth: a value-blind gate EXPLOITEDs both probes', async () => {
  const harness = harnessModes('value-blind');
  const grammar = await attacks['mw-bypass-grammar'].run(harness, {});
  assert.equal(grammar.verdict, 'EXPLOITED', `known grammar unlocks a presence-keyed gate: ${grammar.detail}`);
  const blind = await attacks['mw-value-blindness'].run(harness, {});
  assert.equal(blind.verdict, 'EXPLOITED', `a canary value must not unlock anything: ${blind.detail}`);
  assert.match(blind.detail, /value-blind/);
});

test('next-middleware-shapes teeth: the hardened middleware holds both probes', async () => {
  const harness = harnessModes('hardened');
  for (const name of Object.keys(attacks)) {
    const verdict = await attacks[name].run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must hold on the hardened wire: ${verdict.detail}`);
  }
});

test('next-middleware-shapes teeth: an open wire is honest REFUSED (nothing gated to bypass)', async () => {
  const harness = harnessModes('open');
  for (const name of Object.keys(attacks)) {
    const verdict = await attacks[name].run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} on an ungated wire must refuse honestly: ${verdict.detail}`);
    assert.match(verdict.detail, /posture|nothing to bypass|ungated bare/i);
  }
});

test('next-middleware-shapes teeth: no routes -> honest skipped-REFUSED rows', async () => {
  const harness = buildHarness({});
  for (const [name, attack] of Object.entries(attacks)) {
    const verdict = await attack.run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must skip honestly: ${verdict.detail}`);
    assert.match(verdict.detail, /no routes declared.*skipped/i);
  }
});

test('next-middleware-shapes teeth: ctx.routes whitelist narrows the sweep', async () => {
  const harness = buildHarness({
    gated: ({ request }) => mwStandIn(request, { mode: 'vulnerable' }),
    other: async () => new Response('ok'),
  });
  const quiet = await attacks['mw-bypass-grammar'].run(harness, { routes: ['other'] });
  assert.equal(quiet.verdict, 'REFUSED', `unarmed sweep must refuse: ${quiet.detail}`);
  assert.ok(quiet.detail.includes('1 route(s)'), 'whitelist must report the narrowed count');
  const trip = await attacks['mw-bypass-grammar'].run(harness, { routes: ['gated'] });
  assert.equal(trip.verdict, 'EXPLOITED', 'armed to the gated route -> trips');
});

test('next-middleware-shapes pack contract: manifest + attack names are loadable pack vocabulary', () => {
  assert.equal(pack.name, 'next-middleware-shapes');
  assert.deepEqual(pack.attacks.map((a) => a.name), ['mw-bypass-grammar', 'mw-value-blindness']);
});
