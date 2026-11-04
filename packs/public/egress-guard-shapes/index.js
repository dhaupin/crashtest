// packs/public/egress-guard-shapes/index.js - the outbound-request (SSRF) lane.
//
// Every target that accepts a caller-supplied URL guards it somewhere: a
// wall that refuses loopback / link-local / cloud-metadata / RFC1918 before
// it dials. That guard has its own shape signature generic attacks cannot
// emit - the hostile target corpus - and its own failure modes: comparing
// only the DOTTED v4 form while an IPv6 wrapper ([::ffff:127.0.0.1],
// [::ffff:7f00:1], [64:ff9b::7f00:1]) reaches the same address; matching
// `fe80:`/`fc00:` as literal prefixes instead of the full CIDR; trusting a
// scheme/userinfo/encoding trick. Two attacks, both INSIST on the guard's
// own answer (the app decides; the pack never dials - the one law):
//
//   egress-shape-corpus - fire the hostile corpus at the target's OWN guard
//     route; a guard that ALLOWS any internal shape is EXPLOITED with the
//     shape named. A guard that refuses them all is honestly REFUSED.
//   egress-guard-differential - the public control must be ALLOW-able on the
//     same guard (a blanket-deny guard is not a strong one - nothing proven,
//     honestly REFUSED), AND a representative internal shape must be refused
//     on that same guard. Control allowed + internal denied = the guard
//     discriminates (REFUSED); control allowed + internal allowed =
//     EXPLOITED.
//
// Vocabulary: ctx.guardRoute (required - a route answering { url } with a
// 4xx refusal or { allow | permit | granted: boolean }), ctx.targets
// (optional corpus subset). A run root without the guard route skips
// honestly (never a false positive).

import { refused, exploited } from '../../../src/scenarios/contract.js';

// The hostile corpus: every spelling of an internal endpoint an egress guard
// must refuse. Grouped by the class of bypass that motivated it.
export const INTERNAL_SHAPES = [
  // dotted v4 - the forms every guard catches
  'http://127.0.0.1/',
  'http://127.0.0.1:8080/admin',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.1/',
  'http://192.168.1.1/',
  'http://172.16.0.1/',
  'http://0.0.0.0/',
  // IPv6 wrappers of the SAME v4 endpoint (mapped/compatible/NAT64)
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[::ffff:169.254.169.254]/',
  'http://[::ffff:a9fe:a9fe]/',
  'http://[::127.0.0.1]/',
  'http://[64:ff9b::127.0.0.1]/',
  'http://[64:ff9b::7f00:1]/',
  // native internal v6: loopback, ULA, link-local, multicast
  'http://[::1]/',
  'http://[fd12:3456:789a::1]/',
  'http://[fc99::1]/',
  'http://[fe81::1]/',
  'http://[ff02::1]/',
  // scheme / userinfo / encoding tricks (WHATWG normalizes these to v4)
  'http://user@127.0.0.1/',
  'http://127.0.0.1#@public.example/',
  'http://2130706433/',        // decimal 127.0.0.1
  'http://0177.0.0.1/',        // octal 127.0.0.1
  'http://0x7f000001/',        // hex 127.0.0.1
  'http://127.1/',             // short form 127.0.0.1
];

// The public control: a guard that cannot allow THIS is not discriminating.
export const PUBLIC_CONTROL = 'https://example.com/';

const ALLOW_WORDS = new Set([true, 'allow', 'allowed']);
const DENY_WORDS = new Set([false, 'deny', 'denied']);

function isObject(b) {
  return b && typeof b === 'object' && !Array.isArray(b);
}

/** Classify one guard answer into a decision. Never guesses: an answer that
 * carries no explicit allow/deny is 'unreadable' (the guard does not speak
 * the decision dialect - the row says so instead of inventing a verdict). */
async function decide(record) {
  if (record.threw) return 'floor';
  const status = record.status;
  if (typeof status !== 'number') return 'floor';
  if (status >= 500) return 'floor';
  if (status >= 400) return 'deny';
  let body = null;
  try { body = await record.response.json(); } catch { body = null; }
  if (isObject(body)) {
    const permit = body.allow ?? body.permit ?? body.granted;
    if (ALLOW_WORDS.has(permit)) return 'allow';
    if (DENY_WORDS.has(permit)) return 'deny';
  }
  return 'unreadable';
}

async function askGuard(harness, route, url) {
  return harness.run(route, {
    method: 'POST',
    body: JSON.stringify({ url }),
    headers: { 'content-type': 'application/json' },
  });
}

function corpusFor(ctx) {
  if (Array.isArray(ctx.targets) && ctx.targets.length) {
    const wanted = new Set(ctx.targets);
    return INTERNAL_SHAPES.filter((s) => wanted.has(s));
  }
  return INTERNAL_SHAPES;
}

export default {
  name: 'egress-guard-shapes',
  description: 'outbound-request (SSRF) guard shapes: a hostile internal-target corpus (dotted v4, IPv6 wrappers, full internal v6 ranges, scheme/userinfo/encoding tricks) fired at the app\'s own allow/deny guard route, plus a public-control differential (zero sockets; the guard decides, never a fake verdict)',

  attacks: [
    {
      name: 'egress-shape-corpus',
      description: 'fire the hostile corpus at the target\'s own guard route: any internal shape the guard ALLOWS is EXPLOITED (with the shape named); a guard that refuses them all is honestly REFUSED; a run root without the guard route skips',
      async run(harness, ctx = {}) {
        const route = ctx.guardRoute;
        if (!route || !harness.listRoutes().includes(route)) {
          return refused('vocabulary knob "guardRoute" not declared on this target - egress-guard-shapes skipped (export moduleCtx[\'egress-guard-shapes\'].guardRoute for coverage)', { skipped: true });
        }
        const shapes = corpusFor(ctx);
        const allowed = [];
        let unreadable = 0;
        for (const url of shapes) {
          const verdict = await decide(await askGuard(harness, route, url));
          if (verdict === 'floor') {
            return exploited(`the guard broke the fuzz floor on ${url} - a 5xx/uncaught throw is a crash-grade failure`, { url });
          }
          if (verdict === 'allow') allowed.push(url);
          else if (verdict === 'unreadable') unreadable += 1;
        }
        if (allowed.length) {
          return exploited(
            `egress guard allowed ${allowed.length} internal target(s): "${allowed[0]}" (+${allowed.length - 1} more) - the SSRF wall does not cover every spelling of the same endpoint`,
            { allowed: allowed.slice(0, 8) },
          );
        }
        if (unreadable === shapes.length) {
          return refused(`guard route "${route}" answered no allow/deny decision on ${shapes.length} shape(s) - it does not speak the decision dialect (4xx or {allow|permit|granted}), nothing proven`, { routes: shapes.length, skipped: true });
        }
        return refused(`${shapes.length} internal shape(s) refused by the guard (no spelling of loopback/metadata/RFC1918/internal-v6 was allowed${unreadable ? `; ${unreadable} unreadable answer(s)` : ''})`, { routes: shapes.length });
      },
    },

    {
      name: 'egress-guard-differential',
      description: 'the public control must be ALLOW-able on the same guard (a blanket-deny guard proves nothing - honestly REFUSED) AND a representative internal shape must be refused; control allowed + internal allowed = EXPLOITED',
      async run(harness, ctx = {}) {
        const route = ctx.guardRoute;
        if (!route || !harness.listRoutes().includes(route)) {
          return refused('vocabulary knob "guardRoute" not declared on this target - egress-guard-differential skipped (export moduleCtx[\'egress-guard-shapes\'].guardRoute for coverage)', { skipped: true });
        }
        const control = await decide(await askGuard(harness, route, PUBLIC_CONTROL));
        if (control === 'floor') {
          return exploited(`the guard broke the fuzz floor on the public control ${PUBLIC_CONTROL}`, { url: PUBLIC_CONTROL });
        }
        if (control === 'unreadable') {
          return refused(`guard route "${route}" answered no decision on the public control - nothing proven`, { skipped: true });
        }
        if (control === 'deny') {
          return refused('the guard denies the public control too - a blanket-deny guard is not a discriminating one, nothing proven', { control: PUBLIC_CONTROL, skipped: true });
        }
        // control allowed - now the internal representative must be refused.
        const internal = corpusFor(ctx)[0];
        const verdict = await decide(await askGuard(harness, route, internal));
        if (verdict === 'floor') {
          return exploited(`the guard broke the fuzz floor on the internal target ${internal}`, { url: internal });
        }
        if (verdict === 'allow') {
          return exploited(`guard allows the public control AND the internal target "${internal}" - the wall is off in the wrong direction`, { control: PUBLIC_CONTROL, internal });
        }
        return refused(`the guard discriminates: public control allowed, internal target "${internal}" refused`, { control: PUBLIC_CONTROL, internal });
      },
    },
  ],
};
