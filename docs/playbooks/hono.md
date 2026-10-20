---
permalink: playbooks/hono
layout: default
title: Hono
description: Dispatch through app.request() — Hono's own test entry point.
---

# Hono

Hono ships an in-process harness itself (`app.request()`), and crashtest
wraps exactly that door: production semantics without `serve()`.

```js
// crashtest.config.js
import { Hono } from 'hono';
const app = new Hono();
// ... register your real routes on app. Do NOT call serve()/fire().

export default {
  adapters: { hono: app },
  routeAliases: {
    enroll:  { route: 'app', path: '/enroll' },
    device:  { route: 'app', path: '/device' },
    burst:   { route: 'app', path: '/enroll' },
    admin:   { route: 'app', path: '/enroll' },
    kvwrite: { route: 'app', path: '/enroll' },
  },
  moduleCtx: {
    // GET-by-id oracle against a query-parameter route:
    state: { route: 'device', query: true, mustDenyIds: ['ghost-1', 'ghost-2'] },
  },
  env: { secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' } },
  seed: 0xC0FFEE,
};
```

## Context notes that changed verdicts (real behavior, not lore)

- **Read the oracle id from `query`** — the scenario appends `?key=<id>` to
  probe foreign rows; a route that takes `:id` as a path param still works
  through the alias, but mount the scenario's `query: true` to match.
- **Throw shapes become findings.** If your frequently-hit route lets a
  hostile body crash it into a 500, `never-fail-mutations` marks the route
  EXPLOITED — that's the finding working, not the adapter.
- **cache-control counts.** `guards/hygiene-no-store` reads 2xx write
  responses for store directives; return `{ 'cache-control': 'no-store' }`
  with your writes and the check turns green.
