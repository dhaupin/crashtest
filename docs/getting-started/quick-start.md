---
permalink: getting-started/quick-start
layout: default
title: Quick Start
description: From npx to a hardening report in about two minutes.
---

# Quick Start

## 1 · Init

```console
$ npx crashtest init
```

This writes a `crashtest.config.js` skeleton plus `labs/` for the ledger and
reports.

## 2 · Point it at your handlers

Plain handlers — the Cloudflare Pages Functions shape
(`ctx => Response`, receiving `{ request, env, params, data }`) is the
native format:

```js
// crashtest.config.js
import { enrollHandler, deviceHandler } from './src/handlers.js';

export default {
  baseUrl: 'https://dogfood.myapp.local',
  routes: { enroll: enrollHandler, device: deviceHandler },
  env: {
    d1:  { DB: { tables: { devices: { rows: [], uniques: { key_unique: ['key'] } } } } },
    kv:  { DEVICE_CACHE: {} },
    // Fake secrets — the watermark probe is armed by these keys. Never
    // commit real ones; the point is watching whether they ever LEAK.
    secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' },
  },
  seed: 0xC0FFEE,     // deterministic runs
};
```

Framework apps dispatch through adapters instead:

```js
export default {
  adapters: { hono: honoApp,   // or express / fastify / node
              express: expressApp },
  routeAliases: {               // map scenario names onto real paths
    enroll: { route: 'app', path: '/enroll' },
    device: { route: 'app', path: '/device' },
  },
  env: { secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' } },
};
```

## 3 · Run

```console
$ npx crashtest run
```

- Exit `0` — everything REFUSED (or BOUNDED with a real owner+bound). Holds.
- Exit `1` — a NEW ⚡ EXPLOITED finding, or a REGRESSION of something that
  held before. CI treats this as failure.
- Exit `2` — config problem (say, missing config file). Fix the config.

## 4 · Adopt the baseline

The first green run commits `labs/crashledger.json`. From then on, CI compares
every run against it: new weak spots show up as findings, old strong spots
can't quietly rot. [`hardening.md`](/crashtest/reference/ledger) attaches to
the PR — reviewers see exactly what was probed and what the responses said.

## What "run" does to your code

Nothing side-effectful outside your process. Every request is an in-process
`Request` to a handler the config registered; the only files touched are
under `labs/`.
