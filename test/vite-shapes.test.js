// vite-dev-shapes pack teeth: two-way proof, in-process, zero sockets.
//
//   1. vulnerable dev wire - plain /@fs/ gated (403), bypass grammars serve
//      content (200) -> fs-deny-bypass EXPLOITED; /.env answered with
//      env-shaped content -> env-canary EXPLOITED.
//   2. hardened dev wire   - grammar included: everything 403/404 -> both REFUSED.
//   3. ungated posture     - handler serves /@fs/ content freely -> the
//      differential does NOT exist (the gate is not armed) -> honest
//      REFUSED with the posture note, never a fake exploit.
//   4. anything-200 wire   - handler answers 'ok' to every path (the
//      classic self-dogfood stand-in) -> content-shape oracle must refuse.
//   5. empty run root      -> honest skipped-REFUSED rows.
//   6. ctx.routes whitelist narrows the sweep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';

const pack = (await import('../packs/public/vite-dev-shapes/index.js')).default;
const attacks = Object.fromEntries(pack.attacks.map((a) => [a.name, a]));

const SENTINEL = 'crashtest-vite-file-material=LITERAL_VALUE';
const envBody = 'CRASHTEST_SECRET_CANARY=planted-here\nOTHER=1';

// --- the vite dev-server stand-ins (test fixtures, not shipped) ---

const bypasses = ['?raw??', '?import&raw??', '?import&raw&inline??'];
const deniedPaths = ['/.env', '/.env?raw??', '/.env.local?raw??', '/@fs/etc/.env?raw??', '/@fs/%2e%2e%2f.env?raw??', '/@fs/..%2f..%2f.env?import&raw??'];

async function viteStandIn(request, { mode }) {
  const url = new URL(request.url);
  const path = url.pathname + url.search;
  if (mode === 'vulnerable') {
    // the pre-fix shape: plain /@fs/ gated, transform-suffix served; .env leaked
    if (path.startsWith('/@fs/') && !bypasses.some((b) => path.includes(b))) {
      return new Response('denied', { status: 403 });
    }
    if (path.startsWith('/@fs/') || bypasses.some((b) => path.includes(b))) {
      return new Response(SENTINEL);
    }
    if (deniedPaths.some((p) => path === p)) {
      return new Response(envBody);
    }
    return new Response('not found', { status: 404 });
  }
  if (mode === 'hardened') {
    // grammar removed by patch: everything sensitive-gated, 404 for junk
    if (path.startsWith('/@fs/') || path.startsWith('/.env')) {
      return new Response('denied', { status: 403 });
    }
    return new Response('not found', { status: 404 });
  }
  if (mode === 'ungated') {
    // serves /@fs/ freely - no gate to bypass (differential impossible)
    if (path.startsWith('/@fs/')) return new Response(SENTINEL);
    return new Response('not found', { status: 404 });
  }
  if (mode === 'anything-200') {
    return new Response('ok');
  }
  throw new Error(`unknown mode ${mode}`);
}

const harnessModes = (mode) => buildHarness({
  dev: ({ request }) => viteStandIn(request, { mode }),
});

test('vite-dev-shapes teeth: the vulnerable dev wire catches BOTH attacks', async () => {
  const harness = harnessModes('vulnerable');
  const bypass = await attacks['vite-fs-deny-bypass'].run(harness, {});
  assert.equal(bypass.verdict, 'EXPLOITED', `grammar differential must trip: ${bypass.detail}`);
  assert.match(bypass.detail, /bypass grammar/);

  assert.equal((await attacks['vite-env-canary'].run(harness, {})).verdict, 'EXPLOITED', 'deny-listed .env with env-shaped body must trip');
});

test('vite-dev-shapes teeth: the hardened dev wire holds both attacks', async () => {
  const harness = harnessModes('hardened');
  for (const name of Object.keys(attacks)) {
    const verdict = await attacks[name].run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must hold on the hardened wire: ${verdict.detail}`);
  }
});

test('vite-dev-shapes teeth: ungated posture is honest REFUSED, not a fake exploit', async () => {
  const harness = harnessModes('ungated');
  const bypass = await attacks['vite-fs-deny-bypass'].run(harness, {});
  assert.equal(bypass.verdict, 'REFUSED', `no gate armed -> no differential -> refuse: ${bypass.detail}`);
  assert.match(bypass.detail, /posture note/, 'refusal must say this was a posture note');
  // env canary on this wire: /@fs paths serve file-shaped SENTINEL (has '=')...
  // but the .env-specific paths are 404, so the content-shape oracle holds.
  const env = await attacks['vite-env-canary'].run(harness, {});
  assert.equal(env.verdict, 'REFUSED', `.env shapes are 404 here - oracle holds: ${env.detail}`);
});

test('vite-dev-shapes teeth: anything-200 wire is honestly REFUSED (content-shape oracle)', async () => {
  const harness = harnessModes('anything-200');
  for (const name of Object.keys(attacks)) {
    const verdict = await attacks[name].run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} on an anything-200 wire must refuse honestly: ${verdict.detail}`);
  }
});

test('vite-dev-shapes teeth: no routes -> honest skipped-REFUSED rows', async () => {
  const harness = buildHarness({});
  for (const [name, attack] of Object.entries(attacks)) {
    const verdict = await attack.run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must skip honestly: ${verdict.detail}`);
    assert.match(verdict.detail, /no routes declared.*skipped/i);
  }
});

test('vite-dev-shapes teeth: ctx.routes whitelist narrows the sweep', async () => {
  const harness = buildHarness({
    dev: ({ request }) => viteStandIn(request, { mode: 'vulnerable' }),
    other: async () => new Response('ok'),
  });
  // armed to an UNINVOLVED route only -> the vulnerable route is not swept
  const quiet = await attacks['vite-fs-deny-bypass'].run(harness, { routes: ['other'] });
  assert.equal(quiet.verdict, 'REFUSED', `unarmed sweep must refuse: ${quiet.detail}`);
  assert.ok(quiet.detail.includes('1 route(s)'), 'whitelist must report the narrowed count');

  const trip = await attacks['vite-fs-deny-bypass'].run(harness, { routes: ['dev'] });
  assert.equal(trip.verdict, 'EXPLOITED', 'armed to the vulnerable route -> trips');
});

test('vite-dev-shapes pack contract: manifest + attack names are loadable pack vocabulary', () => {
  assert.equal(pack.name, 'vite-dev-shapes');
  assert.deepEqual(pack.attacks.map((a) => a.name), ['vite-fs-deny-bypass', 'vite-env-canary']);
});
