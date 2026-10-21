// crashtest self-dogfood - the SITE surface.
//
// The proof of concept the product demands: crashtest attacks a REAL component
// of crashtest - the shipped Cloudflare Pages Function
// (`web/functions/api/version.js`, the endpoint behind the npm badge).
// Nothing here is a stand-in toy: the `/version` route below CALLS the actual
// function code. The only piece that is faked is the function's external
// dependency (the npm registry) - the same rule that lets the fake d1 mirror
// a database: dependencies get doubles, sockets get confiscated; the code
// under attack stays real.
//
// Used by a run-root config (this run's labs live in the config's directory,
// NOT the repo's committed demo ledger - two targets, two baselines).
// `test/self-site.test.js` pins the CLI-level run in a temp cwd.

import { onRequestGet } from '../../web/functions/api/version.js';

// In-process registry shim. Hostile scenarios override `registry.reply` and
// RESTORE it inside their own teardown (restore-what-you-touch - the WP
// spike's cross-repo rule, in-repo edition).
export const registry = {
  /** Healthy npm-registry response, byte-equal in shape to the real one. */
  reply: async () => new Response(
    JSON.stringify({
      name: 'crashtest',
      version: '9.9.9-crashprobe',
      dist: { attestations: { provenance: { keyid: 'sigstore-canary' } } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ),
};

let savedFetch = undefined;

/** Swap the registry in. Idempotent; rememberRestore() returns the undo. */
export function installRegistryShim() {
  if (savedFetch === undefined) savedFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes('registry.npmjs.org')) return registry.reply(url, init);
    // There is no such route on this surface: any other URL is a socket-shaped
    // move - return an honest, loud marker instead of dialing out.
    return Promise.resolve(new Response('crashtest-site-target: no registry route for ' + String(url), {
      status: 418,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    }));
  };
}

/** Undo installRegistryShim() - the attack/config's own cleanup hook. */
export function restoreFetch() {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
}

/** Routes for a crashtest.config.js: { version } - the REAL function code. */
export function siteRoutes() {
  installRegistryShim();
  return {
    version: async (ctx) => onRequestGet(ctx),
  };
}
