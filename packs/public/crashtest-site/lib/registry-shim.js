// packs/public/crashtest-site/lib/registry-shim.js — the in-process registry
// double, carried by the pack so the pack is self-contained (the fixtures/
// copy stays for that run root; this is the pack's own lifeline).
//
// Rule: attack code, not people. Nothing dials out — fetch is replaced with
// a hostile-reply hook scenarios can rewrite per-attack (and MUST restore:
// restore-what-you-touch). Any other URL gets an honest 418 marker.

export const registry = {
  /** Healthy npm-registry response, shape-equal to the real one. */
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

export function installRegistryShim() {
  if (savedFetch === undefined) savedFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    if (String(url).includes('registry.npmjs.org')) return registry.reply(url, init);
    return Promise.resolve(new Response('crashtest-site: no registry route for ' + String(url), {
      status: 418,
      headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
    }));
  };
}

export function restoreFetch() {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
}
