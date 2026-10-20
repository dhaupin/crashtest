---
permalink: playbooks/fastify
layout: default
title: Fastify
description: Dispatch through app.inject() - routes exist only after the app is ready.
---

# Fastify

Fastify's own `app.inject()` is the door: real serialization, real schema
validation, real error handling production sees - just no network.

```js
// crashtest.config.js
import Fastify from 'fastify';
const app = Fastify();
// ... register your real routes/plugins on app. Do NOT call app.listen().

export default {
  adapters: { fastify: { app: await app.ready() } },
  routeAliases: {
    enroll:  { route: 'app', path: '/enroll' },
    device:  { route: 'app', path: '/device' },
    burst:   { route: 'app', path: '/enroll' },
    admin:   { route: 'app', path: '/enroll' },
    kvwrite: { route: 'app', path: '/enroll' },
  },
  moduleCtx: {
    state: { route: 'device', query: true, mustDenyIds: ['ghost-1', 'ghost-2'] },
  },
  env: { secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' } },
  seed: 0xC0FFEE,
};
```

## Notes

- **`await app.ready()` is required** - Fastify routes exist only after the
  app is ready; injecting earlier throws (by Fastify's own design, same as
  its test docs).
- The adapter accepts **the plain app or a spec object**; the spec form lets
  you pass options through the same way the registry handles other adapters.
- Fastify's schema validation gives `never-fail-mutations` genuinely shaped
  400s when your schemas are real (e.g. JSON schemas with `type: 'string'`
  field constraints) - that's REFUSED, as it should be. Without schemas,
  crashes pass through hostile shapes and the attack catches them.
- Runs happen against the app as-is. Plugins that need a listening socket do
  not fit the in-process rule - the socket is the only thing we refuse
  to synthesize.
