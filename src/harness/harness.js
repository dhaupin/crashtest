// S1.1 — the Harness: explicit route table + in-process transport.
//
// The invariant (PRD principle 2): never a socket. run() builds a WHATWG
// Request the way the Edge runtime would, hands it to the target's handler
// with a fake env/ctx, and returns a verdict-ready record:
//
//   { status, ok, response?, threw?, error?, ops, durationMs }
//
// Uncaught handler errors are NOT converted into fake 500s — fuzz/guard
// campaigns must see the throw itself ("never uncaught throws"), so threw is
// a first-class field.

import { newBackendCounter } from './counters.js';
import { buildEnv } from './env.js';

export class Harness {
  /**
   * @param {object} opts
   * @param {object} opts.env       env spec: { kv, d1, secrets, var } (see env.js)
   * @param {object} [opts.cost]    { opName: costPerOp } — extra/cheaper ops for cost accounting
   * @param {string} [opts.baseUrl] base URL for synthesized requests (default https://crashtest.local)
   */
  constructor({ env: envSpec = {}, cost = {}, baseUrl = 'https://crashtest.local' } = {}) {
    this._counter = newBackendCounter(cost);
    this.env = buildEnv(envSpec, this._counter);
    this.baseUrl = baseUrl;
    this._routes = new Map(); // name -> handler(ctx) => Response
    this._log = [];           // per-run records, oldest first
  }

  /**
   * Explicit route registration (v0.1 DISCOVER contract; sniffing comes in 0.2).
   * Duplicate names fail loudly — a silent overwrite would make a two-adapter
   * or double-aliased config leak requests to the wrong handler with no error.
   */
  registerRoute(name, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`harness: route "${name}" needs a (ctx) => Response handler`);
    }
    if (this._routes.has(name)) {
      throw new TypeError(`harness: route "${name}" already registered${this._routes.get(name) === handler ? ' (same handler)' : ''} — names must be unique; rename one or register an alias instead`);
    }
    this._routes.set(name, handler);
    return this;
  }

  /**
   * Alias one registered route under a scenario-facing name, rewriting only
   * the URL path (query string passes through) and optionally the method —
   * the body stream survives (deep copy not needed; a Request body is not
   * consumed by the rewrite). The early adopters (vant box, framework smoke
   * configs) proved the friction: one raw/framework app registers ONE route
   * while scenarios call enroll/device/admin/kvwrite/burst — aliases map the
   * scenario vocabulary onto real paths without touching the app.
   */
  aliasRoute(name, source, { path, method } = {}) {
    const base = this._routes.get(source);
    if (typeof base !== 'function') {
      throw new TypeError(`harness: aliasRoute "${name}" needs a registered source route (have: ${this.listRoutes().join(', ') || 'none'})`);
    }
    return this.registerRoute(name, ({ request, env, params, data }) => base({
      request: rewriteRequest(request, path, method),
      env, params, data,
    }));
  }

  listRoutes() {
    return [...this._routes.keys()];
  }

  /**
   * Fire one in-process request at a registered route.
   * @param {string} name            route name (from the route table)
   * @param {Request|object} reqInit either a Request, or { method, url path, headers, body, params, data }
   */
  async run(name, reqInit = {}) {
    const handler = this._routes.get(name);
    if (!handler) {
      throw new Error(`harness: no route registered as "${name}" (have: ${this.listRoutes().join(', ') || 'none'})`);
    }

    let request;
    if (reqInit instanceof Request) {
      request = reqInit;
    } else {
      const url = reqInit.url?.startsWith('http')
        ? reqInit.url
        : `${this.baseUrl}${reqInit.url ?? reqInit.path ?? '/'}`;
      request = new Request(url, {
        method: reqInit.method ?? 'GET',
        headers: reqInit.headers ?? {},
        body: reqInit.body ?? undefined,
      });
    }

    const ctx = {
      request,
      env: this.env,
      params: reqInit.params ?? {},
      data: reqInit.data ?? {},
    };

    const before = this._counter.snapshot();
    const at = new Date().toISOString();
    const started = performance.now();
    this._counter.increment('route.invoke');

    let record;
    try {
      const response = await handler(ctx);
      if (typeof response?.status !== 'number' || typeof response?.headers?.get !== 'function') {
        throw new Error(`harness: handler "${name}" did not return a Response (got ${typeof response})`);
      }
      record = {
        route: name,
        at,
        status: response.status,
        ok: response.ok,
        response,
        threw: false,
        durationMs: Math.round(performance.now() - started),
        ops: this._counter.deltaFrom(before),
      };
    } catch (error) {
      record = {
        route: name,
        at,
        status: null,
        ok: false,
        response: null,
        threw: true,
        error,
        durationMs: Math.round(performance.now() - started),
        ops: this._counter.deltaFrom(before),
      };
    }

    this._log.push(record);
    return record;
  }

  /** Full log of every in-process request this harness instance served. */
  log() {
    return [...this._log];
  }

  /** Absolute cost totals across the whole run (campaign-level accounting). */
  costTotals() {
    return this._counter.snapshot();
  }
}

/**
 * Rewrite only what an alias needs: the path (query string preserved) and
 * optionally the method. Body/headers pass through untouched — a prefix-path
 * alias is a routing redirect, not a content transform.
 */
export function rewriteRequest(request, path, method) {
  if (path === undefined && method === undefined) return request;
  const src = new URL(request.url);
  const url = path === undefined ? request.url : `${src.origin}${path}${src.search}`;
  return new Request(url, {
    method: method ?? request.method,
    headers: request.headers,
    // `duplex: 'half'` is mandatory in WHATWG fetch whenever a request body is
    // a stream (strict in Node/undici, optional elsewhere) — harmless when the
    // body is a string, required for alias-rewritten streamed bodies.
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    duplex: request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : (request.body != null ? 'half' : undefined),
  });
}

/** Build a harness for a target app: explicit table of named handlers. */
export function buildHarness(routeTable, opts = {}) {
  const h = new Harness(opts);
  for (const [name, handler] of Object.entries(routeTable)) h.registerRoute(name, handler);
  return h;
}
