// v0.2 - express adapter. Express apps dispatch in-process via
// `app.handle(req, res)` - no listen() needed. The WHATWG Request the
// harness hands the handler is translated to a Node-style req, a FakeRes
// shells collects whatever the app streams/routs, and the whole thing is
// synthesized back into a Response.
//
// Dispatch is sync-resolved by draining until express flushes headers AND
// payload (or a route erroneously never responds - the harness surfaces
// that as a harness-wide throw in the usual way).

import { Readable, PassThrough } from 'node:stream';
import { ServerResponse } from 'node:http';

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

/**
 * Translate a WHATWG Request into a Node-ish req - the surfaces real
 * servers touch, split by consumer archetype:
 *  - stream-style (express, got/undici internals) settle via the async
 *    iterator over the body;
 *  - event-style (raw http.createServer handlers - vant's _handleRequest
 *    found this the hard way) attach `on('data')/on('end')` listeners
 *    before dispatch and call `req.setTimeout(ms, cb)` as an idle guard.
 *  - express's error path (finalhandler) unpipe()s the request - that reads
 *    Readable stream state directly; an EventEmitter stand-in crashes there
 *    (found against a REAL express app in the 0.2 adoption wave).
 * A genuine streams.Readable gives every archetype native truth: events,
 * iterator, pipe/unpipe, destroy, `destroyed`. Body chunks are PUSHED on a
 * process.nextTick so the handler can attach consumers first; the end of
 * the body arrives as a native push(null) => 'end'.
 */
function toNodeReq(request) {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  const req = new Readable({ read() {} });
  req.method = request.method;
  req.url = url.pathname + url.search;
  req.headers = headers;
  // express/Node standard fields apps and routers touch. The socket must be
  // a REAL stream - express re-prototypes the fake req onto IncomingMessage,
  // whose _destroy runs end-of-stream against the socket (so a plain object
  // crashes cleanup; found against a real express app). A PassThrough is
  // the honest no-op socket: it can be destroy()ed but nothing pretending
  // to go over a wire ever does.
  req.httpVersion = '1.1';
  req.socket = Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1' });
  req.connection = req.socket;

  const withBody = !(request.method === 'GET' || request.method === 'HEAD');

  // Idle guard: a real socket fires this when the peer stops sending, but
  // an in-process handler has no socket to go idle on - the dispatch race
  // timer (timeout option) is the honest equivalent, so record-and-forget
  // here. Handlers that rely on the callback firing for progress signaling
  // are out of scope on purpose (no-lie rule: we synthesize a wire, not
  // phantom timeouts).
  req.setTimeout = (_ms, _cb) => req;

  // Feed the body once through native Readable machinery (both archetypes
  // see it): events for on('data')/on('end'), native asyncIterator + piping
  // for stream consumers. push(null) is the canonical stream end.
  process.nextTick(() => {
    (async () => {
      if (withBody && request.body) {
        for await (const chunk of request.body) {
          req.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
      }
      req.push(null);
    })().catch((err) => req.destroy(err));
  });

  return req;
}

/**
 * Express fixture (0.2 adoption wave - all learned against a REAL express
 * app): express re-prototypes the req/res onto its own IncomingMessage /
 * response chain and its error path (finalhandler) touches raw stream +
 * header internals, so the adapter no longer fakes them - it builds a
 * REAL http.ServerResponse against the real-Readable req, assigns a
 * PassThrough socket (the honest no-op wire), and reassembles the wire
 * bytes (native status + res.getHeaders()) into a WHATWG Response.
 * Settles on the native 'finish' event, hard-capped by the timeout race.
 */
async function dispatchExpressHandle(app, request, timeout) {
  const nodeReq = toNodeReq(request);
  // A real req can emit 'error' (finalhandler's cleanup path); in-process
  // the error was already surfaced via the throw race - never let it crash
  // the process as an unhandled 'error' event on the synthetic Incoming.
  nodeReq.on('error', () => {});
  // The res gets its OWN socket stream: this mirrors real HTTP (request
  // bytes arrive on the readable side, response bytes leave on the write
  // side of one stream) while keeping the req's feed and the res's flush
  // accounting independent - sharing one PassThrough stalls
  // OutgoingMessage._writeRaw's flush tracking (found against a real
  // express 404 path in the adoption wave).
  const resSocket = Object.assign(new PassThrough(), { remoteAddress: '127.0.0.1' });
  const res = new ServerResponse(nodeReq);
  res.assignSocket(resSocket);
  const wire = [];
  resSocket.on('data', (c) => wire.push(c));
  const settled = new Promise((resolve, reject) => {
    res.on('finish', () => resolve());
    res.on('error', reject);
  });
  let timerId;
  const timer = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`express adapter: handler hung past ${timeout}ms`)), timeout);
  });
  try {
    await Promise.race([Promise.resolve(app.handle(nodeReq, res)).then(() => settled), timer]);
  } finally {
    clearTimeout(timerId); // a loser timer must not become an unhandled rejection
  }
  // Split the raw wire: status/headers live in res (native truth), the body
  // is everything after the first \r\n\r\n.
  const raw = Buffer.concat(wire);
  const sep = raw.indexOf('\r\n\r\n');
  const body = sep >= 0 ? raw.subarray(sep + 4) : Buffer.alloc(0);
  const headers = {};
  for (const [k, v] of Object.entries(res.getHeaders())) headers[k.toLowerCase()] = v;
  return new Response(body.length ? body : null, { status: res.statusCode, headers });
}

/** Bounded drain until the handler has truly ended (event-style handlers
 * settle async - `handle()` returning is not the response being done). */
async function drainUntil(res, what) {
  for (let i = 0; i < 200 && !res._done; i++) await new Promise(r => setImmediate(r));
  if (!res._done) {
    // A route that never ends the response is a finding-class fault -
    // surface it instead of synthesizing a phantom 200.
    throw new Error(`${what}: handler never ended the response`);
  }
}

export function registerExpress(harness, { app, name = 'app', timeout = 2000 } = {}) {
  if (!app || typeof app.handle !== 'function') {
    throw new TypeError('registerExpress: express app needs .handle(req, res)');
  }
  return harness.registerRoute(name, ({ request }) => dispatchExpressHandle(app, request, timeout));
}

/**
 * Raw Node-style dispatch: register a (nodeReq, nodeRes) => void|Promise
 * handler directly - the surface of undecorated `http.createServer` handlers
 * (vant's Server._handleRequest, legacy middlewares, wire-level mocks).
 * FakeRes supplies the Node res verbs (writeHead/setHeader/end/...) so plain
 * server code runs unchanged.
 */
export function registerNodeDispatch(harness, { handle, name = 'app', timeout = 2000 } = {}) {
  if (!handle || typeof handle !== 'function') {
    throw new TypeError('registerNodeDispatch: needs handle(nodeReq, nodeRes)');
  }
  // ~L8: route handlers are `async ({ request }) => Response` - wrap the
  // generic request-level dispatch (exported below) as a named route. The
  // registry calls this once per adapter spec, so configs that need several
  // routes off one raw handler (path-rewritten, per-endpoint) just list
  // multiple specs and rewrite urls in their own helpers.
  return harness.registerRoute(name, ({ request }) =>
    dispatchNodeRequest(handle, request, { timeout }));
}

/**
 * Dispatch ONE WHATWG Request through a raw (nodeReq, nodeRes) => void
 * handler and get the settled Response back - the building block for
 * configs that map several crashtest route names onto one Node server
 * (each route handler rewrites the path, then calls this). Also handy for
 * one-off probes. Throws on hang/never-ended just like the adapter does.
 */
export async function dispatchNodeRequest(handle, request, { timeout = 2000 } = {}) {
  if (!handle || typeof handle !== 'function') {
    throw new TypeError('dispatchNodeRequest: needs handle(nodeReq, nodeRes)');
  }
  const res = new FakeRes();
  const nodeReq = toNodeReq(request);
  // Race the WHOLE settle (handler promise + drain to res.end) against the
  // hard cap - handle() itself resolves early for event-style handlers, so
  // racing it alone would read the res before the handler ever ends it.
  const done = Promise.resolve(handle(nodeReq, res)).then(() => drainUntil(res, 'dispatchNodeRequest'));
  let timerId;
  const timer = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`dispatchNodeRequest: hung past ${timeout}ms`)), timeout);
  });
  try {
    await Promise.race([done, timer]);
  } finally {
    clearTimeout(timerId); // a loser timer must not become an unhandled rejection
  }
  return new Response(res.bodyText() || null, { status: res.statusCode, headers: res.headers() });
}
