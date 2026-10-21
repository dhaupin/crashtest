// qs-shapes pack teeth: two-way proof, in-process, zero sockets.
//
//   1. vulnerable wire  - a qs-like bracket parser with NO prototype guard
//      and NO depth cap (the pre-fix shape: bracket assignment honors
//      __proto__/constructor.prototype, recursion mirrors qs's recursive
//      parse) -> both attacks EXPLOITED (canary lands on Object.prototype;
//      the depth ladder breaks the fuzz floor).
//   2. hardened wire    - prototype-key sanitizer + depth cap -> both
//      attacks honestly REFUSED.
//   3. ignorant wire    - handler ignores bracket keys entirely -> REFUSED
//      (never a false positive: no expansion, no finding).
//   4. empty run root   -> honest skipped-REFUSED rows.
//   5. ctx.routes whitelist narrows the sweep (armed route only).
//
// Hygiene pin: a canary that lands on Object.prototype is deleted before
// the verdict returns - the process stays clean for the rest of the suite
// (determinism law: no planted keys survive a run).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';

const pack = (await import('../packs/public/qs-shapes/index.js')).default;
const attacks = Object.fromEntries(pack.attacks.map((a) => [a.name, a]));
const CANARY = 'crashtestQsCanary4e91';

// --- the parsers the fixtures wire in (not shipped - test The real ones) ---

function keyTokens(key) {
  const cut = key.indexOf('[');
  if (cut === -1) return [key];
  const tokens = [key.slice(0, cut)];
  const re = /\[([^\[\]]*)\]/g;
  let m;
  while ((m = re.exec(key))) tokens.push(m[1] === '' ? '0' : m[1]);
  return tokens;
}

// recursive walk (mirrors qs's recursive parse -> stack dies on deep keys)
function deepSet(node, tokens, i, value) {
  if (i === tokens.length - 1) { node[tokens[i]] = value; return; }
  if (typeof node[tokens[i]] !== 'object' || node[tokens[i]] === null) node[tokens[i]] = {};
  deepSet(node[tokens[i]], tokens, i + 1, value);
}

function wireHandler(flags, { depthCap, unsafeKeys }) {
  return async ({ request, counter }) => {
    const routes = [];
    const url = new URL(request.url);
    if (url.search.length > 1) routes.push(url.search.slice(1));
    if (request.method === 'POST') routes.push(await request.text());
    for (const segment of routes) {
      for (const pair of segment.split('&')) {
        const eq = pair.indexOf('=');
        const key = eq === -1 ? pair : pair.slice(0, eq);
        const val = eq === -1 ? '' : pair.slice(eq + 1);
        const tokens = keyTokens(key);
        const blocked = tokens.some((t) => unsafeKeys.includes(t));
        const depth = tokens.length - 1;
        if (blocked || depth > depthCap) {
          counter?.increment?.('qs.blocked');
          continue; // hardened floor: nothing parsed deeper or through the gate
        }
        try {
          deepSet({}, tokens, 0, val); // fresh root per pair - the VULNERABLE shape
        } catch (e) {
          return new Response('parse failed', { status: 500 }); // no depth cap -> the floor breaks
        }
      }
    }
    return new Response('ok');
  };
}

// NOTE: the vulnerable fixture must actually POLLUTE - deepSet's bracket
// assignment on {} chains honors node.__proto__ exactly like the real
// pre-fix reducers; the canary check in the pack reads the process, not
// the response, so pollution is the observed truth.

function freshClean() {
  const fresh = {};
  assert.equal(fresh[CANARY], undefined, 'Object.prototype must be canary-clean before the run');
}

test('qs-shapes teeth: the vulnerable parser catches BOTH attacks', async () => {
  freshClean();
  const harness = buildHarness({
    enroll: wireHandler({ unsafe: true }, { depthCap: Infinity, unsafeKeys: [] }),
  });
  const canary = await attacks['qs-bracket-canary'].run(harness, {});
  assert.equal(canary.verdict, 'EXPLOITED', `canary must trip on the vulnerable wire: ${canary.detail}`);
  assert.match(canary.detail, /Object\.prototype/);
  const depth = await attacks['qs-depth-floor'].run(harness, {});
  assert.equal(depth.verdict, 'EXPLOITED', `depth floor must trip on the uncapped parser: ${depth.detail}`);
  assert.match(depth.detail, /depth cap|broken the floor/);
  // the canary landed and was cleaned before the verdict returned
  const freshAfter = {};
  assert.equal(freshAfter[CANARY], undefined, 'pollution must be deleted before the verdict returns (process hygiene)');
});

test('qs-shapes teeth: the hardened parser holds both attacks', async () => {
  freshClean();
  const harness = buildHarness({
    enroll: wireHandler({ safe: true }, { depthCap: 5, unsafeKeys: ['__proto__', 'constructor', 'prototype'] }),
  });
  for (const name of ['qs-bracket-canary', 'qs-depth-floor']) {
    const verdict = await attacks[name].run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must hold on the hardened wire: ${verdict.detail}`);
  }
  assert.equal(({}[CANARY]), undefined, 'no residue after the refused verdicts');
});

test('qs-shapes teeth: an ignorant wire is honestly REFUSED (never a false positive)', async () => {
  freshClean();
  const harness = buildHarness({
    enroll: async () => new Response('ok'),
  });
  const canary = await attacks['qs-bracket-canary'].run(harness, {});
  const depth = await attacks['qs-depth-floor'].run(harness, {});
  assert.equal(canary.verdict, 'REFUSED', `ignores bracket keys -> no pollution, honest refusal: ${canary.detail}`);
  assert.equal(depth.verdict, 'REFUSED', `ignores the body -> floor never trips, honest refusal: ${depth.detail}`);
});

test('qs-shapes teeth: no routes -> honest skipped-REFUSED rows, never fake EXPLOITEDs', async () => {
  const harness = buildHarness({});
  for (const [name, attack] of Object.entries(attacks)) {
    const verdict = await attack.run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} on an empty run root must skip honestly: ${verdict.detail}`);
    assert.match(verdict.detail, /no routes declared.*skipped/i, `${name} must SAY it skipped: ${verdict.detail}`);
  }
});

test('qs-shapes teeth: ctx.routes whitelist narrows the sweep to armed routes only', async () => {
  const harness = buildHarness({
    vulnerable: wireHandler({ unsafe: true }, { depthCap: Infinity, unsafeKeys: [] }),
    hardened: wireHandler({ safe: true }, { depthCap: 5, unsafeKeys: ['__proto__', 'constructor', 'prototype'] }),
  });
  const canary = await attacks['qs-bracket-canary'].run(harness, { routes: ['hardened'] });
  assert.equal(canary.verdict, 'REFUSED', `the armed route is hardened - must refuse: ${canary.detail}`);
  assert.ok(canary.detail.includes('1 route(s)'), `whitelist sweep must report the narrowed count: ${canary.detail}`);

  const depth = await attacks['qs-depth-floor'].run(harness, { routes: ['vulnerable'] });
  assert.equal(depth.verdict, 'EXPLOITED', `unarmed sweep of the vulnerable wire must trip: ${depth.detail}`);
});

test('qs-shapes pack contract: manifest + attack names are loadable pack vocabulary', async () => {
  assert.equal(pack.name, 'qs-shapes');
  assert.deepEqual(pack.attacks.map((a) => a.name), ['qs-bracket-canary', 'qs-depth-floor']);
});
