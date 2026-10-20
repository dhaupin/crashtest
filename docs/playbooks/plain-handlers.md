---
permalink: playbooks/plain-handlers
layout: default
title: Plain Handlers
description: Handler functions shaped like Pages Functions are the native crashtest format - usually zero glue.
---

# Plain Handlers

If your handlers look like this (Cloudflare Pages Functions shape):

```js
async function enroll({ request, env, params, data }) {
  const body = await request.json();
  // ... validate, insert ...
  return Response.json({ ok: true }, { status: 201 });
}
```

then your config is nearly free:

```js
// crashtest.config.js
import { enroll, device } from './src/handlers.js';

export default {
  baseUrl: 'https://dogfood.myapp.local',
  routes: { enroll, device },
  env: {
    d1: { DB: { tables: { devices: {
      rows: [/* real-shape seed rows */],
      uniques: { key_unique: ['key'] },
    } } } },
    secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' },
  },
  seed: 0xC0FFEE,
};
```

That's it. Every scenario now attacks `enroll` and `device` by name.

## Shapes the harness recognizes

Handlers receive `{ request, env, params, data }`:

- `request` - a real WHATWG `Request` (the same class the Edge runtime gives
  you), built from the attack's method/url/headers/body
- `env` - the fake backend from `config.env`
- `params` / `data` - whatever the attack passes in `harness.run()`

## Return contract

Return a `Response` (status numbers and headers are read from it). Returning
anything else surfaces as a finding-class fault
(`harness: handler "x" did not return a Response`) - by design, a missing
Response is behavior, not a test problem.
