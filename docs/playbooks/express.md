---
permalink: playbooks/express
layout: default
title: Express
description: Dispatch through app.handle() with real ServerResponse semantics.
---

# Express

The express adapter dispatches in-process through `app.handle(req, res)` —
no `listen()`. Behind the curtain it builds a real
`http.ServerResponse` against a real `Readable` request on a no-op socket,
so express internals (body parser, `finalhandler`, its response prototype
stack) behave exactly as in production.

```js
// crashtest.config.js
import express from 'express';
const app = express();
// ... register your real routes/middleware on app. Do NOT call app.listen().

export default {
  adapters: { express: app },
  routeAliases: {
    enroll:  { route: 'app', path: '/enroll' },
    device:  { route: 'app', path: '/device' },
    burst:   { route: 'app', path: '/enroll' },
    admin:   { route: 'app', path: '/enroll' },
    kvwrite: { route: 'app', path: '/enroll' },
  },
  env: { secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' } },
  seed: 0xC0FFEE,
};
```

Adapters register one route named `app`; `routeAliases` maps the scenario
vocabulary (`enroll`, `device`, `admin`, `burst`, `kvwrite`) onto your real
paths. Query strings pass through; bodies are passed through untouched.

## Notes from the wire (real quirks we hit and fixed)

- Routes must end their response — a handler that never responds surfaces
  as a hang finding ("handler hung past timeout"), not a fake 200.
- `app.listen()` must NOT be called anywhere in the config import path.
- Error paths are exercised through real semantics: a throw becomes a real
  express 500 from `finalhandler`, which is exactly what the
  `never-fail-mutations` attack wants to observe.

## Prefer one route? Alias per path — never re-register

If two adapters (or a route and an alias) claim the same harness name, the
harness throws at startup. Names are unique on purpose: the alternative is
attacks leaking to the wrong handler.
