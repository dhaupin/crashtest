// v0.2 - fastify adapter. Fastify ships an in-process injection surface
// (`app.inject()`, powered by light-my-request inside fastify itself), so a
// fastify app dispatches without listening. Map WHATWG Request -> inject
// options -> Response.
//
// NOTES for fastify targets:
//   - fastify must be `await app.ready()` in the target config BEFORE
//     crashtest run - routes only exist after ready resolves.

export function registerFastify(harness, { app, name = 'app' } = {}) {
  if (!app || typeof app.inject !== 'function') {
    throw new TypeError('registerFastify: fastify app needs await app.ready() + .inject()');
  }
  harness.registerRoute(name, async ({ request }) => {
    const url = new URL(request.url);
    const payload = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(await request.arrayBuffer());
    const res = await app.inject({
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      ...(payload ? { payload } : {}),
    });
    return new Response(res.body ?? null, {
      status: res.statusCode,
      headers: res.headers,
    });
  });
  return harness;
}
