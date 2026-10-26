---
permalink: getting-started/config
layout: default
title: Configuration
description: Every knob in crashtest.config.js, with the shape and what it controls.
---

# Configuration

Everything lives in one ESM default export. Config files can import your own
modules - they are your code, loaded from your repo.

## Full knob map

```js
export default {
  baseUrl: 'https://dogfood.myapp.local', // base for synthesized requests

  // EITHER handlers (name => fn)...
  routes: {
    enroll: async ({ request, env, params, data }) => Response,
    device: deviceHandler,
  },

  // ...OR a framework/raw app via adapters (default route name: 'app')
  adapters: {
    hono:    honoApp,                  // via app.request()
    express: expressApp,               // via app.handle(); real ServerResponse
    fastify: await fastifyApp.ready(), // via app.inject(); routes exist after ready()
    node:    { handle: (nodeReq, nodeRes) => myServer._handleRequest(nodeReq, nodeRes) },
  },

  // Aliases: map scenario vocabulary onto real paths of ONE dispatching app.
  routeAliases: {
    enroll:  { route: 'app', path: '/enroll' },
    device:  { route: 'app', path: '/device' },
    kvwrite: { route: 'app', path: '/enroll' },
    burst:   { route: 'app', path: '/enroll' },
    admin:   { route: 'app', path: '/enroll' },
  },

  // Fake backend mirrors what ctx.env carries in production.
  env: {
    d1: { DB: { tables: { devices: { rows: [], uniques: {} } } } },
    kv: { DEVICE_CACHE: {} },
    secrets: { CRASHTEST_SECRET: 'fake-not-real' },
    vars: { LOG_LEVEL: 'debug' },
  },

  // Tuning
  seed: 0xC0FFEE,                       // deterministic runs (any number)
  modules: ['auth', 'input'],           // subset of scenario modules
                                        // (a filter that matches NOTHING fails
                                        // loudly - a typo can never silently
                                        // green a zero-row run)
  moduleCtx: { state: { mustDenyIds: ['ghost-1'] } },   // module-level ctx
  attackCtx: { 'volume/cost-amplification': { maxOpsPerRequest: 12 } }, // per-attack
  scenarioDirs: ['test/attacks'],       // extra module dirs - REQUIRED paths, a
                                        // missing one fails loudly naming it
                                        // (only labs/scenarios/ is optional)
  cost: { opName: 1 },                  // extra ops for cost accounting
};
```

## Rules the runner enforces so you don't have to

- **Route names must be unique.** Registering a name twice throws at startup -
  a silent overwrite would leak attacks to the wrong handler.
- **`routeAliases` takes `{ route, path, method? }`.** Only the path is
  rewritten (query string survives); bodies are passed through untouched.
- **A `BOUNDED` verdict needs `owner` and `bound`.** Without them it demotes
  to EXPLOITED, loudly - accepted risk has no meaning otherwise.

## Where the fake env comes from

`env.d1` wants real-shape tables: seed rows in `rows:` and your actual unique
constraints in `uniques:` - attacks chain on real constraint behavior
(`UNIQUE constraint failed: t.col`). Fake secrets under
`env.secrets` arm the watermark probe; use obviously fake values.

## Per-module context cheat sheet

| Module | Useful ctx |
|---|---|
| `auth` | `{ route: 'admin' }` - the privileged surface to spoof at |
| `state` | `{ route: 'device', mustDenyIds: [...], query: true }` - arm the id oracle |
| `input` | `{ route: 'enroll' }` - the mutation surface |
| `volume` | `{ rounds: 30, payloadSize: 8192, maxOpsPerRequest: 12 }` - economics bounds |
| `guards` | `{ route: 'burst' }` - the burst target |

Every knob above matches the shipped CLI - and the [attack
catalog](/crashtest/reference/attacks) explains what each module actually
does with them.
