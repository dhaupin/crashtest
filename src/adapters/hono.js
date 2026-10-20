// v0.2 — framework adapters. The harness's route contract is one function:
//   (ctx) => Response
// Each adapter wraps a framework app object that ALREADY DISPATCHES
// IN-PROCESS (no server), exposing it as a harness route so every scenario
// library works against it unchanged. Zero deps: the app's own runtime
// provides the dispatch surface.
//
// hono: `app.request(input, requestInit)` — Hono's built-in in-process
// dispatcher (works without a server; stable since hono v3/v4). It returns
// a Response directly, so the adapter is one glue line.

/** Register a hono app as harness route `name` (default 'app'). */
export function registerHono(harness, { app, name = 'app' } = {}) {
  if (!app || typeof app.request !== 'function') {
    throw new TypeError('registerHono: hono app needs .request(input, requestInit)');
  }
  harness.registerRoute(name, async ({ request }) => app.request(request));
  return harness;
}
