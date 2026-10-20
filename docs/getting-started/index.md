---
permalink: getting-started/
layout: default
title: Getting Started
description: What crashtest is, what it needs, and which path to take first.
---

# Getting Started

Crashtest runs against **your real code** in **your own process**. The three
prerequisites:

1. Node 22+ (`node --version`)
2. A `crashtest.config.js` describing your routes or app + a fake backend
3. Two minutes

Start with the [Quick Start](/crashtest/getting-started/quick-start) — `init`,
edit, `run`. Then wire the
[CI gate](/crashtest/playbooks/github-action) so the report becomes
enforcement.

## Which path describes your app?

| Your app looks like… | Playbook |
|---|---|
| Plain handler functions (`({ request, env }) => Response`) | [Plain Handlers](/crashtest/playbooks/plain-handlers) |
| An Express app | [Express](/crashtest/playbooks/express) |
| A Hono app | [Hono](/crashtest/playbooks/hono) |
| A Fastify app | [Fastify](/crashtest/playbooks/fastify) |
| A framework-less `http.createServer` server | [Raw Node Servers](/crashtest/playbooks/raw-node) |

## What a run looks like

```console
$ npx crashtest run
🛡 auth/secret-watermark: 5 routes × 3 error-path probes: no fake secret ever left the env
⚡ guards/hygiene-no-store: 2xx write from "enroll" has NO Cache-Control — shared caches may replay the write
🛡 state/enumeration-oracle: all 3 foreign ids denied on "device" (no ripple, no oracle)

tally: {"TOTAL":13,"REFUSED":12,"EXPLOITED":1,"BOUNDED":0}
ledger: labs/crashledger.json · report: labs/hardening.md
exit: 1  (a NEW exploited finding — fix it or bound it, then re-run)
```

Nothing about these lines is aspirational — they are from real runs, including
one against an external, unaudited repo. The full attack surface each line
summarizes is in the [attack catalog](/crashtest/reference/attacks).
