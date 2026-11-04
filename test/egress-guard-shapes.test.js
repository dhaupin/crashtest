// egress-guard-shapes pack teeth: two-way proof, in-process, zero sockets.
//
//   1. vulnerable guard - dotted-only compare (no embedded-v4 decode, no
//      CIDR, no scheme trick) -> egress-shape-corpus EXPLOITED.
//   2. blanket-deny guard - refuses EVERYTHING including the public control
//      -> differential honestly REFUSED (a guard that denies all is not a
//      strong one; nothing proven).
//   3. hardened guard - decodes embedded v4, matches the full CIDRs, and
//      allows the public control -> both attacks honestly REFUSED.
//   4. ignorant guard - answers 200 with no decision dialect -> honest
//      REFUSED (never a false positive).
//   5. empty run root -> honest skipped-REFUSED rows.
//   6. ctx.targets narrows the corpus.
//
// The guard fixtures are NOT shipped - they stand in for a target's real
// guard so the pack's oracle is graded against both the vulnerable and the
// hardened shape (the qs-shapes/vite-shapes teeth precedent).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';

const mod = await import('../packs/public/egress-guard-shapes/index.js');
const pack = mod.default;
const attacks = Object.fromEntries(pack.attacks.map((a) => [a.name, a]));
const { INTERNAL_SHAPES, PUBLIC_CONTROL } = mod;

// --- the guards the fixtures wire in (not shipped) ---

/** WHATWG-normalize a URL body to a hostname, or null. */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return null; }
}

/** The VULNERABLE guard: only the dotted v4 forms are known-bad. An IPv6
 * wrapper or a v6 literal sails through - the exact bypass the pack pins. */
function vulnerableGuard() {
  return async ({ request }) => {
    const { url } = await request.json();
    const host = hostOf(url);
    const dotted = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host ?? '');
    return Response.json({ allow: !dotted });
  };
}

/** The HARDENED guard: embedded-v4 decode + full internal CIDRs + loopback. */
function hardenedGuard() {
  const v4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|224\.)/;
  return async ({ request }) => {
    const { url } = await request.json();
    const host = hostOf(url);
    if (!host) return Response.json({ allow: false });
    const embedded = embeddedV4(host);
    const internal = [host, embedded].filter(Boolean).some((h) =>
      v4.test(h) || h === '::1' || /^f[cd][0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h) || /^ff[0-9a-f]{2}:/i.test(h));
    return Response.json({ allow: !internal });
  };
}

/** Expand an IPv6 literal to its 8 16-bit groups (handles `::`). */
function expandV6(host) {
  if (!host.includes(':')) return null;
  const [head, tail] = host.split('::');
  const h = head ? head.split(':').filter(Boolean) : [];
  const t = tail === undefined ? null : (tail ? tail.split(':').filter(Boolean) : []);
  if (t === null) return h.length === 8 ? h.map((g) => parseInt(g, 16)) : null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return [...h, ...Array(fill).fill('0'), ...t].map((g) => parseInt(g, 16));
}

/** Decode a v4 embedded in a v6 literal (IPv4-mapped ::ffff:0:0/96,
 * IPv4-compatible ::/96, NAT64 64:ff9b::/96) - the tails the wall must
 * decode to reach the same endpoint as the dotted form. */
function embeddedV4(host) {
  const g = expandV6(host);
  if (!g) return null;
  const lead = g.slice(0, 5);
  const mapped = lead.every((x) => x === 0) && g[5] === 0xffff;
  const compatible = g.slice(0, 6).every((x) => x === 0);
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (!mapped && !compatible && !nat64) return null;
  return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
}

/** A guard that answers 200 with no allow/deny dialect at all. */
function ignorantGuard() {
  return async () => new Response('ok', { status: 200 });
}

test('egress-guard-shapes teeth: the vulnerable (dotted-only) guard trips the corpus', async () => {
  const harness = buildHarness({ guard: vulnerableGuard() });
  const verdict = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard' });
  assert.equal(verdict.verdict, 'EXPLOITED', `dotted-only guard must trip: ${verdict.detail}`);
  assert.match(verdict.detail, /allowed/);
  // the differential is honest here: the representative internal shape IS
  // the dotted form, which even this guard catches - so it refuses. The
  // WRAPPER bypass is the corpus row's find, not the differential's.
  const diff = await attacks['egress-guard-differential'].run(harness, { guardRoute: 'guard' });
  assert.equal(diff.verdict, 'REFUSED', `the representative (dotted) is caught -> differential REFUSED: ${diff.detail}`);
});

test('egress-guard-shapes teeth: a blanket-allow guard trips the differential', async () => {
  const harness = buildHarness({ guard: async () => Response.json({ allow: true }) });
  const diff = await attacks['egress-guard-differential'].run(harness, { guardRoute: 'guard' });
  assert.equal(diff.verdict, 'EXPLOITED', `a guard that allows everything must trip the differential: ${diff.detail}`);
  assert.match(diff.detail, /off in the wrong direction/);
});

test('egress-guard-shapes teeth: a blanket-deny guard is honestly REFUSED (not a false pass)', async () => {
  const harness = buildHarness({ guard: async () => Response.json({ allow: false }) });
  const diff = await attacks['egress-guard-differential'].run(harness, { guardRoute: 'guard' });
  assert.equal(diff.verdict, 'REFUSED', `blanket-deny guard proves nothing: ${diff.detail}`);
  assert.match(diff.detail, /blanket-deny|denies the public control/);
  // the corpus row is also honestly REFUSED (nothing was allowed)
  const corpus = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard' });
  assert.equal(corpus.verdict, 'REFUSED');
});

test('egress-guard-shapes teeth: the hardened guard holds both attacks', async () => {
  const harness = buildHarness({ guard: hardenedGuard() });
  for (const name of ['egress-shape-corpus', 'egress-guard-differential']) {
    const verdict = await attacks[name].run(harness, { guardRoute: 'guard' });
    assert.equal(verdict.verdict, 'REFUSED', `${name} must hold on the hardened guard: ${verdict.detail}`);
  }
});

test('egress-guard-shapes teeth: an ignorant guard (no decision dialect) is honestly REFUSED', async () => {
  const harness = buildHarness({ guard: ignorantGuard() });
  const corpus = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard' });
  assert.equal(corpus.verdict, 'REFUSED', `an answerless guard proves nothing: ${corpus.detail}`);
  assert.match(corpus.detail, /decision dialect|no allow\/deny/i);
});

test('egress-guard-shapes teeth: a guard that 5xxs is a crash-grade EXPLOITED', async () => {
  const harness = buildHarness({ guard: async () => { throw new Error('guard blew up'); } });
  const verdict = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard' });
  assert.equal(verdict.verdict, 'EXPLOITED', `a throwing guard is a failure, not a pass: ${verdict.detail}`);
  assert.match(verdict.detail, /fuzz floor/);
});

test('egress-guard-shapes teeth: no guard route -> honest skipped-REFUSED rows', async () => {
  const harness = buildHarness({ other: async () => new Response('ok') });
  for (const [name, attack] of Object.entries(attacks)) {
    const verdict = await attack.run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} on an unarmed run root must skip honestly: ${verdict.detail}`);
    assert.match(verdict.detail, /guardRoute.*skipped/i, `${name} must SAY it skipped: ${verdict.detail}`);
  }
});

test('egress-guard-shapes teeth: ctx.targets narrows the corpus', async () => {
  const harness = buildHarness({ guard: vulnerableGuard() });
  // narrow to a shape the vulnerable guard happens to catch -> REFUSED
  const caught = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard', targets: ['http://127.0.0.1/'] });
  assert.equal(caught.verdict, 'REFUSED', `the dotted form is caught -> narrow corpus REFUSED: ${caught.detail}`);
  assert.match(caught.detail, /1 internal shape/);
  // narrow to the mapped wrapper the vulnerable guard misses -> EXPLOITED
  const missed = await attacks['egress-shape-corpus'].run(harness, { guardRoute: 'guard', targets: ['http://[::ffff:127.0.0.1]/'] });
  assert.equal(missed.verdict, 'EXPLOITED', `the mapped wrapper is missed -> EXPLOITED: ${missed.detail}`);
});

test('egress-guard-shapes pack contract: manifest + attack names + corpus residency', async () => {
  assert.equal(pack.name, 'egress-guard-shapes');
  assert.deepEqual(pack.attacks.map((a) => a.name), ['egress-shape-corpus', 'egress-guard-differential']);
  assert.ok(INTERNAL_SHAPES.length >= 8, 'corpus must carry the wrapper + v6 + trick families');
  assert.equal(INTERNAL_SHAPES.includes(PUBLIC_CONTROL), false, 'control and corpus must be disjoint');
});
