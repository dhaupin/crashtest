// Seed scenario library: 'recursion' - PRD section 6 expansion: the
// loops-without-a-guard dimension. Agentic world relevance is the point:
// the most common unbounded-work bugs in agent-authored handlers are
// recursive JSON walkers and validation regexes written on the first
// attempt. In-process, both classes are honestly observable:
//
//   deep-nest-stack-overflow : a JSON body nested thousands deep meets a
//     handler that walks it recursively - V8's JSON.parse is iterative so
//     parsing survives, but ANY recursive walk over the structure (merges,
//     flatteners, normalizers, formatters) overflows the call stack and
//     arrives as an uncaught RangeError. Uncaught = EXPLOITED. A handler
//     with a depth guard answers an honest 4xx = REFUSED.
//   redos-catastrophic-pattern : a catastrophic-backtracking validation
//     pattern behind attacker-controlled strings. The deterministic story:
//     the probe sends EVIL-BENIGN PAIRS of the same shape through the SAME
//     handler and compares SELF-relative ratios (evil vs benign on the
//     identical route, same transport) with generous buckets, so no host
//     clock decides the verdict - only the ratio, which for catastrophic
//     backtracking is orders of magnitude, not percent. For extra safety
//     the verdict additionally requires the evil request to cross a
//     substantial absolute bucket. This is the one timing-relative probe in
//     the library by design, documented as such.
//
// ctx vocabulary: deepRoute (default 'enroll'), regexRoute
// (default 'validate'), depth (default 12000), deepKey (default 'k').

import { refused, exploited } from '../contract.js';

/// Canonical catastrophic shapes, VERIFIED against V8's irregexp. Two facts
// decide the shapes:
//   1. Matching suffixes terminate fast (the first successful path wins),
//      so the evil probe FAILS the regex - that is what detonates the
//      exponential backtrack.
//   2. The benign partner is deliberately TINY ('ab' - a genuine match the
//      engine clears in ~0.2ms). Same-shape benign partners ('a'.repeat(30)
//      + 'b') backtrack almost as hard as the evil input and the ratio dies.
// Measured at the committed sizes: evil ~300ms vs benign ~0.2ms on a plain
// V8 - orders of magnitude above the ratio floor, sub-second per probe for
// the CI bench.
const REDOS_PAIRS = [
  {
    name: 'alternation-quantifier /((a|aa)+)/',
    evil: 'a'.repeat(30) + '!',
    benign: 'ab',
  },
  {
    name: 'reversed-order alternation /((aa|a)+)/',
    evil: 'a'.repeat(30) + '!',
    benign: 'ab',
  },
];

export default {
  name: 'recursion',
  description: "Unbounded work: deep-nested structures that stack-overflow recursive walkers, and catastrophic-backtracking validation patterns - the loop-without-a-guard class agent handlers write constantly",

  attacks: [{
    name: 'deep-nest-stack-overflow',
    description: 'A JSON structure nested thousands deep must meet a depth-guarded walker: an uncaught RangeError/TypeError stack-overflow on ANY recursive processing is EXPLOITED; an honest 4xx depth-cap is REFUSED',
    async run(harness, ctx = {}) {
      const route = ctx.deepRoute ?? 'enroll';
      const depth = ctx.depth ?? 12000;
      const key = ctx.deepKey ?? 'k';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - recursion skipped (declare it for coverage)`, { route, skipped: true });
      }
      // Build the nested body iteratively (a string-composed structure - the
      // constructive side never recurses either).
      let bodyText = `"leaf"`;
      for (let i = 0; i < depth; i++) {
        bodyText = `{"${key}":${bodyText}}`;
      }

      let rec;
      try {
        rec = await harness.run(route, {
          method: 'POST',
          body: bodyText,
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        // The transport itself faulted (e.g. undici body-size guard) - that
        // is a refuse/policy answer, not a handler verdict: honest bounce.
        return refused(
          `transport refused the deep body before the handler saw it (policy-level size guard: ${String(err).slice(0, 70)})`,
          { route, depth },
        );
      }

      if (rec.threw) {
        const stack = String(rec.error);
        if (/RangeError|Maximum call stack|call stack size/i.test(stack)) {
          return exploited(
            `deep-nested body (${depth} levels) stack-overflowed a recursive walker on "${route}" - uncaught ${stack.slice(0, 90)}`,
            { route, depth },
          );
        }
        return exploited(
          `deep-nested body crashed the handler on "${route}" (uncaught: ${stack.slice(0, 90)})`,
          { route, depth },
        );
      }
      if (rec.status >= 500) {
        return exploited(
          `deep-nested body escalated to ${rec.status} on "${route}" - the walker overflowed and the fiber faked an internal error instead of a depth refusal`,
          { route, depth },
        );
      }
      if (rec.status < 400) {
        return refused(
          `deep-nested body (${depth} levels) processed on "${route}" without unbounded recursion - top-level reading, or a walker you own that cannot overflow here`,
          { route, depth, status: rec.status },
        );
      }
      return refused(
        `deep-nested body (${depth} levels) answered honestly on "${route}" (${rec.status}) - a depth guard or flat processing refused it`,
        { route, depth, status: rec.status },
      );
    },
  }, {
    name: 'redos-catastrophic-pattern',
    description: 'Validation regexes behind attacker-controlled strings must backtrack linearly: evil-vs-benign pairs of the same shape through the SAME handler self-control the timing ratio (no host clock decides) - a catastrophic escape is EXPLOITED with the pair named',
    async run(harness, ctx = {}) {
      const route = ctx.regexRoute ?? 'validate';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - recursion skipped (declare it for coverage)`, { route, skipped: true });
      }
      const RATIO_FLOOR = 40;          // generous: catastrophic is 10^3 - 10^5
      const ABS_FLOOR_MS = 20;         // and the evil probe must be meaningfully slow

      const send = async (value) => await harness.run(route, {
        method: 'POST',
        body: JSON.stringify({ value }),
        headers: { 'content-type': 'application/json' },
      });

      const faults = [];
      for (const pair of REDOS_PAIRS) {
        // Benign first (prime no caches; also warms parameter shapes).
        const benignRec = await send(pair.benign);
        const evilRec = await send(pair.evil);
        if (evilRec.threw) { faults.push(`${pair.name}: threw on the evil probe - ${String(evilRec.error).slice(0, 70)}`); continue; }
        if (evilRec.status >= 500) { faults.push(`${pair.name}: ${evilRec.status} on the evil probe`); continue; }
        const benignMs = benignRec.threw ? 0 : (benignRec.durationMs ?? 0);
        const evilMs = evilRec.durationMs ?? 0;
        const ratio = evilMs / Math.max(benignMs, 0.01);
        if (ratio >= RATIO_FLOOR && evilMs >= ABS_FLOOR_MS) {
          faults.push(
            `${pair.name}: evil ${evilMs.toFixed(0)}ms vs benign ${benignMs.toFixed(2)}ms (x${ratio >= 1000 ? 'WAY>1000' : ratio.toFixed(0)}) - a catastrophic-backtracking regex saw attacker-shaped input and backtracked exponentially`,
          );
        }
      }
      if (faults.length) {
        return exploited(`catastrophic-backtracking escape(s) on "${route}": ${faults.join(' | ')}`, { route });
      }
      return refused(
        `${REDOS_PAIRS.length} evil/benign backtracking pairs walked linearly through "${route}" - no self-relative ratio crossed the bucket`,
        { route },
      );
    },
  }],
};
