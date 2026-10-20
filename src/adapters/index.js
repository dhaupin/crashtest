// v0.2 — adapter registry. crashtest.config.js can declare:
//   adapters: { hono: app, express: app2, fastify: app3 }   // default route 'app'
//   adapters: { hono: { app, name: 'api' } }                // explicit route names
// One dispatching app per route — adapters compose with plain `routes`.

import { registerHono } from './hono.js';
import { registerExpress, registerNodeDispatch, dispatchNodeRequest } from './express.js';
import { registerFastify } from './fastify.js';
import { registerWordPress } from './wordpress.js';

// `node` takes a raw (nodeReq, nodeRes) => void handler — the shape of
// undecorated http.createServer handlers (vant Server._handleRequest, etc.).
const REGISTRY = { hono: registerHono, express: registerExpress, fastify: registerFastify, node: registerNodeDispatch, wordpress: registerWordPress };

// Convenience re-exports — `require('crashtest/adapters')` gives power users
// direct access without filename spelunking.
export { registerHono, registerExpress, registerNodeDispatch, registerFastify, dispatchNodeRequest, registerWordPress };

/** Apply every adapter from a config's `adapters` map onto a harness. */
export function registerAdapters(harness, adapters = {}) {
  for (const [kind, spec] of Object.entries(adapters)) {
    const register = REGISTRY[kind];
    if (!register) {
      throw new TypeError(`unknown adapter kind "${kind}" (have: ${Object.keys(REGISTRY).join(', ')})`);
    }
    // Options shape = { app, name? } — detected by an own 'app'/'name' key, so
    // bare apps (express/hono/fastify instances are plain objects with their
    // own verbs, never own 'app'/'name' keys in practice) pass through clean.
    const isOptions = spec !== null && typeof spec === 'object'
      && (Object.hasOwn(spec, 'app') || Object.hasOwn(spec, 'name'));
    register(harness, isOptions ? spec : { app: spec });
  }
  return harness;
}
