// v0.2 — express adapter. Express apps dispatch in-process via
// `app.handle(req, res)` — no listen() needed. The WHATWG Request the
// harness hands the handler is translated to a Node-style req, a FakeRes
// shells collects whatever the app streams/routs, and the whole thing is
// synthesized back into a Response.
//
// Dispatch is sync-resolved by draining until express flushes headers AND
// payload (or a route erroneously never responds — the harness surfaces
// that as a harness-wide throw in the usual way).

import { Readable } from 'node:stream';

class FakeRes {
  constructor() {
    this.statusCode = 200;
    this._headers = new Map();
    this._chunks = [];
    this._done = false;
    // Node surface bits express touches:
    this.writableEnded = false;
  }
  setHeader(name, value) { this._headers.set(String(name).toLowerCase(), value); }
  getHeader(name) { return this._headers.get(String(name).toLowerCase()); }
  removeHeader(name) { this._headers.delete(String(name).toLowerCase()); }
  writeHead(status, headers) {
    this.statusCode = status;
    if (headers) for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
  }
  write(chunk) { this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); return true; }
  end(chunk) {
    if (chunk) this.write(chunk);
    this.writableEnded = true;
    this._done = true;
  }
  status(code) { this.statusCode = code; } // express .status exists on res chain too
  json(body) {
    this.setHeader('content-type', 'application/json');
    this.end(JSON.stringify(body));
    return this;
  }
  send(body) {
    if (typeof body === 'object' && body !== null) return this.json(body);
    this.end(body ?? '');
    return this;
  }
  headers() { return { ...Object.fromEntries(this._headers) }; }
  bodyText() { return Buffer.concat(this._chunks).toString('utf8'); }
}

/** Translate a WHATWG Request into a Node-ish req (the bits express reads). */
function toNodeReq(request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    // WHATWG bodies yield Uint8Array views; Node consumers expect Buffers —
    // always re-wrap so `String(chunk)` / piping behaves like a server.
    : Readable.from((async function* () {
      if (request.body) for await (const chunk of request.body) yield Buffer.from(chunk);
    })());
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    // express/Node standard fields apps and routers touch:
    httpVersion: '1.1',
    socket: { remoteAddress: '127.0.0.1' },
    connection: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]() {
      return body ? body[Symbol.asyncIterator]() : [][Symbol.iterator]();
    },
  };
}

/**
 * Drain the dispatch loop. Express settles req/res synchronously for the
 * routing decision, but handler promises may resolve after handle() returns;
 * poll until the res is truly done (bounded so never-ending routes error out
 * and land in the harness's threw lane).
 */
async function dispatch(app, nodeReq, res) {
  app.handle(nodeReq, res);
  for (let i = 0; i < 200 && !res._done; i++) {
    await new Promise(r => setImmediate(r));
  }
  if (!res._done) {
    // A route that never ends the response is itself a finding-class fault —
    // surface it instead of synthesizing a phantom 200.
    throw new Error('express adapter: handler never ended the response');
  }
}

export function registerExpress(harness, { app, name = 'app', timeout = 2000 } = {}) {
  if (!app || typeof app.handle !== 'function') {
    throw new TypeError('registerExpress: express app needs .handle(req, res)');
  }
  harness.registerRoute(name, async ({ request }) => {
    const res = new FakeRes();
    const nodeReq = toNodeReq(request);
    // Hard cap: a route that never ends must fail loudly (task-time bounded).
    const done = dispatch(app, nodeReq, res);
    const timer = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`express adapter: route hung past ${timeout}ms`)), timeout));
    await Promise.race([done, timer]);
    return new Response(res.bodyText() || null, { status: res.statusCode, headers: res.headers() });
  });
  return harness;
}
