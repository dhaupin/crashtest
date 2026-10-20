---
permalink: playbooks/
layout: default
title: Playbooks
description: One page each for wiring crashtest onto your app's actual dispatch surface.
---

# Playbooks

Crashtest never opens a socket — it hands handlers in-process `Request`s. So
the only thing a playbook needs to answer is: **how does my app receive a
request without `listen()`?**

Every playbook produces a config that supports:

```console
$ npx crashtest run    # exit 0 holds, 1 finding, 2 config problem
```

Pick yours:

- [Plain Handlers](/crashtest/playbooks/plain-handlers) — handler functions
  already shaped like Pages Functions (the fastest path: usually zero glue)
- [Express](/crashtest/playbooks/express) — real `app.handle()` dispatch
- [Hono](/crashtest/playbooks/hono) — via `app.request()`
- [Fastify](/crashtest/playbooks/fastify) — via `app.inject()`, after `ready()`
- [Raw Node Servers](/crashtest/playbooks/raw-node) — undecorated
  `http.createServer` handlers, per-route adapter
- [CI Gate](/crashtest/playbooks/github-action) — one composite step that
  turns the ledger into branch enforcement
