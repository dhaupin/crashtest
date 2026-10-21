// packs/public/next-middleware-shapes/index.js - the Next.js middleware lane.
// Next.js middleware has its own wire signature generic attacks cannot
// emit: the `x-middleware-subrequest` header, whose value grammar (the
// middleware file id, historically repeated as a chain) asks the runtime to
// treat the request as an internal nested subrequest - and older/broken
// builds then SKIP the middleware entirely, handing out gated routes.
// Two attacks, both INSIST on the wire truth (the router's own answers):
//
//   mw-bypass-grammar   - the differential: the SAME route bare must be
//     gated (4xx/3xx); if a KNOWN subrequest grammar turns that denial into
//     a 2xx with body, the middleware was skipped. An always-2xx route is
//     honestly REFUSED (nothing gated to bypass).
//   mw-value-blindness  - gate strength: a canary value that is NOT a
//     known grammar must never unlock a gated route. Bare gated +
//     canary-value 2xx = the gate keys on header PRESENCE, not the
//     certified chain - a weaker (real-world) break of its own.
//
// Sweep semantics (cve-feed style): every declared route fired; optional
// `ctx.routes` whitelist. Offline, no version claims: the router's answers
// decide. Vocabulary: ctx.routes (optional route list).

import { refused, exploited } from '../../../src/scenarios/contract.js';

// The documented subrequest-value grammars across middleware generations:
// the plain middleware id, the id repeated as a colon chain (longer builds
// append the name once per traversal), the src/ layout variant, and the
// legacy pages-shape.
const MW_GRAMMARS = [
  'middleware',
  'middleware:middleware:middleware:middleware:middleware',
  'src/middleware',
  'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware',
  'pages/_middleware',
];
const BWOGUS = 'crashtest-bogus-subrequest-not-a-chain';
const HEADER = 'x-middleware-subrequest';

const gated = (status) => status >= 300;
const served = (status, bodyLength) => status >= 200 && status < 300 && bodyLength > 0;

function routesFor(harness, ctx) {
  const declared = harness.listRoutes();
  if (!declared.length) return { sweep: null, skipped: true };
  const pinned = Array.isArray(ctx.routes) ? ctx.routes.filter((r) => declared.includes(r)) : null;
  return { sweep: pinned ?? declared, skipped: false };
}

export default {
  name: 'next-middleware-shapes',
  description: 'Next.js middleware wire shapes: x-middleware-subrequest bypass grammars and a value-blindness probe over every declared route (zero sockets; differential oracle, never fake verdicts)',

  attacks: [
    {
      name: 'mw-bypass-grammar',
      description: 'bare route gated + known subrequest-grammar served -> middleware skipped (EXPLOITED); always-open routes honestly REFUSED (nothing to bypass)',
      async run(harness, ctx = {}) {
        const { sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - mw-bypass-grammar skipped', { skipped: true });
        }
        const bypassed = [];
        const ungated = [];
        for (const route of sweep) {
          const bare = await harness.run(route, { method: 'GET' });
          const bareStatus = bare.threw ? 500 : bare.status;
          if (!gated(bareStatus)) {
            ungated.push(route);
            continue;
          }
          for (const grammar of MW_GRAMMARS) {
            const rec = await harness.run(route, {
              method: 'GET',
              headers: { [HEADER]: grammar },
            });
            const status = rec.threw ? 500 : rec.status;
            const bodyLen = rec.threw ? 0 : (await rec.response.text()).length;
            if (served(status, bodyLen)) {
              bypassed.push(`${route} (${grammar})`);
              break;
            }
          }
        }
        if (bypassed.length) {
          return exploited(
            `middleware skipped: "${bypassed[0]}" was gated bare but served through a known subrequest grammar (+${bypassed.length - 1} more) - the gate does not authenticate its internal callers`,
            { routes: bypassed.slice(0, 6), ungated: ungated.length },
          );
        }
        return refused(
          `${sweep.length} route(s): no grammar differential (bare answers carried to every subrequest shape${ungated.length ? `; ${ungated.length} route(s) ungated bare - posture note, nothing to bypass` : ''})`,
          { routes: sweep.length, ungated: ungated.length },
        );
      },
    },

    {
      name: 'mw-value-blindness',
      description: 'bare route gated + a NON-grammar canary value served -> the gate keys on header presence, not the certified chain (EXPLOITED); canary gated like bare is honest REFUSED',
      async run(harness, ctx = {}) {
        const { sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - mw-value-blindness skipped', { skipped: true });
        }
        const blind = [];
        const ungated = [];
        for (const route of sweep) {
          const bare = await harness.run(route, { method: 'GET' });
          const bareStatus = bare.threw ? 500 : bare.status;
          if (!gated(bareStatus)) {
            ungated.push(route);
            continue;
          }
          const rec = await harness.run(route, {
            method: 'GET',
            headers: { [HEADER]: BWOGUS },
          });
          const status = rec.threw ? 500 : rec.status;
          const bodyLen = rec.threw ? 0 : (await rec.response.text()).length;
          if (served(status, bodyLen)) {
            blind.push(route);
          }
        }
        if (blind.length) {
          return exploited(
            `gate is value-blind: "${blind[0]}" was gated bare but served for "${BWOGUS}" (+${blind.length - 1} more) - header presence alone unlocks the middleware`,
            { routes: blind.slice(0, 6), ungated: ungated.length },
          );
        }
        return refused(
          `${sweep.length} route(s): canary value stayed gated like bare (the gate verifies its callers, not just the header)${ungated.length ? `; ${ungated.length} route(s) ungated bare - posture note` : ''}`,
          { routes: sweep.length, ungated: ungated.length },
        );
      },
    },
  ],
};
