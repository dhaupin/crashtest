---
permalink: playbooks/raw-node
layout: default
title: Raw Node Servers
description: Framework-less http.createServer handlers get per-route adapters.
---

# Raw Node Servers

For an undecorated Node server - the shape everything on `http.createServer`
and its wrappers uses - point crashtest at the dispatch function directly:

```js
// crashtest.config.js
import { Server } from './lib/server.js';
import { dispatchNodeRequest } from 'crashtest/adapters';

const myServer = new Server();

// One alias per scenario surface: rewrite the URL onto the real path, then
// hand the WHATWG Request through the adapter's one-shot dispatcher.
const via = (path, method = 'POST') => async ({ request }) => {
  const inBody = request.method === 'GET' ? null : await request.text();
  const probe = new Request(`https://target.local${path}`, {
    method, body: inBody,
    headers: [...request.headers],
  });
  return dispatchNodeRequest((nr, res) => myServer._handleRequest(nr, res), probe);
};

export default {
  routes: {
    enroll:  via('/call'),
    burst:   via('/call'),
    kvwrite: via('/call'),
    admin:   via('/call'),
    device:  via('/streams/probe', 'GET'),
  },
  env: { secrets: { CRASHTEST_SECRET: 'fake-secret-not-real-42' } },
  seed: 0xC0FFEE,
};
```

## What `dispatchNodeRequest` gives raw handlers

- A **real `streams.Readable` req** (method/url/headers/socket) that supports
  both consumer archetypes: `req.on('data'/'end')` listeners **and** async
  iteration - plus `req.setTimeout(ms, cb)` and a working `req.destroy()`.
- A **`FakeRes`** carrying the Node response verbs your server touches
  (`writeHead`, `setHeader`, `write`, `end`, `json`, `send`, …).
- A bounded settle: the returned Response is collected when the handler
  actually ends (or throws loudly past the timeout - never a phantom 200).

## Single-dispatch vs multi-route

- `adapters: { node: { handle, name } }` registers **one** named route off
  your handler - good when scenarios and your handler agree on the surface.
- Multi-route servers (every real one) use the pattern above: one helper per
  surface, reusing `dispatchNodeRequest`. It's the same door vant's own
  server code is attacked through.

## It is genuinely in-process

No `listen()`, no `localhost`, no sockets - the fake transport is the point.
Same commit, same attack, same verdict, forever.
