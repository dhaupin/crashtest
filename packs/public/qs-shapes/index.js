// packs/public/qs-shapes/index.js - the express-qs precedent pack.
// Where genuine value lives: a framework's OWN wire signature that generic
// attacks cannot emit. The express extended-query / urlencoded parser (qs)
// expands bracket-notation keys (`a[b][c]=v`) BEFORE the handler sees
// anything - generic JSON-body attacks (src/scenarios/library/input.js)
// never exercise that parser. Two shapes, both INSIST on the wire truth
// (what the target's parser actually does to those keys):
//
//   qs-bracket-canary - urlencoded bracket shapes carrying a canary key on
//     __proto__/constructor.prototype paths; the canary must never surface
//     on a fresh object literal. Same oracle as the library's
//     proto-pollution-body, delivered through the bracket wire instead of
//     hostile JSON.
//   qs-depth-floor - deep `[0]` nesting ladders must stay under the fuzz
//     floor: never 5xx, never an uncaught throw (a parser without a depth
//     cap dies in recursion; modern qs caps at 5 by default).
//
// Sweep semantics (cve-feed style): every declared route is fired; an
// optional `ctx.routes` whitelist narrows the sweep. A route that ignores
// bracket keys is honestly REFUSED - never a false positive (AGENTS rule 5).
// Vocabulary: ctx.routes (optional route list).

import { refused, exploited, fuzzFloorViolation } from '../../../src/scenarios/contract.js';

const QS_CANARY = 'crashtestQsCanary4e91';

/** Deterministic urlencoded bracket shapes: the two prototype-arrival paths
 * qs parsers are known for. Raw brackets - qs tolerates unencoded brackets
 * and decodes the value. */
function canaryShapes(canary) {
  return [
    `x[__proto__][${canary}]=planted`,
    `x[constructor][prototype][${canary}]=planted`,
  ];
}

/** Clean up any pollution the fire may have planted - the process must stay
 * sane between attacks (same hygiene as input.js). */
function cleanupCanary(canary) {
  delete Object.prototype[canary];
  if (Object.prototype[canary]) delete Object.prototype[canary]; // second pass for broken shapes
}

function routesFor(harness, ctx) {
  const declared = harness.listRoutes();
  if (!declared.length) {
    return { declared, sweep: null, skipped: true };
  }
  const pinned = Array.isArray(ctx.routes) ? ctx.routes.filter((r) => declared.includes(r)) : null;
  return { declared, sweep: pinned ?? declared, skipped: false };
}

export default {
  name: 'qs-shapes',
  description: 'qs bracket-notation shapes for any route whose handler expands bracket keys (express extended-query / urlencoded parser): prototype-key canaries and deep-nesting floor checks (zero sockets, sweep semantics)',

  attacks: [
    {
      name: 'qs-bracket-canary',
      description: 'urlencoded bracket shapes plant a canary via __proto__ / constructor.prototype keys - the canary must never surface on a fresh object literal; a route that expands those keys pollutes global state',
      async run(harness, ctx = {}) {
        const { declared, sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - bracket-canary skipped', { skipped: true });
        }
        const polluted = [];
        const fired = [];
        for (const route of sweep) {
          for (const shape of canaryShapes(QS_CANARY)) {
            const rec = await harness.run(route, {
              method: 'POST',
              body: shape,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
            });
            fired.push(`${route}:${rec.threw ? 'threw' : rec.status ?? 'no-status'}`);
            const fresh = {}; // object literal - inherits Object.prototype only
            if (fresh[QS_CANARY] === 'planted') {
              polluted.push(`${route} (${shape.split('=')[0]})`);
              break;
            }
            cleanupCanary(QS_CANARY);
          }
        }
        cleanupCanary(QS_CANARY); // belt and braces between verdict and teardown
        if (polluted.length) {
          return exploited(
            `bracket canary landed on Object.prototype via "${polluted[0]}" (+${polluted.length - 1} more) - the qs-style parser honors __proto__/constructor.prototype keys on the urlencoded wire`,
            { routes: polluted.slice(0, 6), fired: fired.length },
          );
        }
        return refused(
          `${fired.length} bracket-shape fires across ${sweep.length} route(s) left global state clean - no bracket-key expansion reached the prototype (synced: none needed)`,
          { routes: sweep.length, fired: fired.length },
        );
      },
    },

    {
      name: 'qs-depth-floor',
      description: 'deterministic deep-[0]-nesting ladders (query + urlencoded POST) must stay under the fuzz floor - never 5xx, never an uncaught throw; a parser without a depth cap dies in recursion',
      async run(harness, ctx = {}) {
        const { declared, sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - depth-floor skipped', { skipped: true });
        }
        const ladder = [64, 256, 1024, 4096, 20000]; // fixed, deterministic depths
        const violations = [];
        const fired = [];
        for (const route of sweep) {
          for (const depth of ladder) {
            const deep = `q${'[0]'.repeat(depth)}`;
            // GET wire: the extended QUERY parser shape; POST wire: urlencoded
            // body parser shape. Both are the two places express hands qs.
            // Route dispatch is name-keyed; the query rides a neutral path so
            // the URL never depends on the route's own name/string.
            const recGet = await harness.run(route, { method: 'GET', url: `/?${deep}=x` });
            const violationGet = fuzzFloorViolation(recGet);
            if (violationGet) {
              violations.push({ route, depth, wire: 'GET query', violation: violationGet });
              break;
            }
            fired.push(`${route}:GET#${depth}`);
            const recPost = await harness.run(route, {
              method: 'POST',
              body: `${deep}=x`,
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
            });
            const violationPost = fuzzFloorViolation(recPost);
            if (violationPost) {
              violations.push({ route, depth, wire: 'POST urlencoded', violation: violationPost });
              break;
            }
            fired.push(`${route}:POST#${depth}`);
          }
        }
        if (violations.length) {
          const v = violations[0];
          return exploited(
            `deep nesting broke the floor on "${v.route}" at bracket depth ${v.depth} (${v.wire}) - ${v.violation}; the parser has no depth cap`,
            { violations: violations.slice(0, 5), fired: fired.length },
          );
        }
        return refused(
          `the full depth ladder held on ${sweep.length} route(s) (${fired.length} fires) - never 5xx, never an uncaught throw`,
          { routes: sweep.length, fired: fired.length },
        );
      },
    },
  ],
};
