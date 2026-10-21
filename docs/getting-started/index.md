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

Start with the [Quick Start](/crashtest/getting-started/quick-start) - `init`,
edit, `run`. Then wire the
[CI gate](/crashtest/playbooks/github-action) so the report becomes
enforcement.

## Which path describes your app?

| Your app looks like... | Playbook |
|---|---|
| Plain handler functions (`({ request, env }) => Response`) | [Plain Handlers](/crashtest/playbooks/plain-handlers) |
| An Express app | [Express](/crashtest/playbooks/express) |
| A Hono app | [Hono](/crashtest/playbooks/hono) |
| A Fastify app | [Fastify](/crashtest/playbooks/fastify) |
| A framework-less `http.createServer` server | [Raw Node Servers](/crashtest/playbooks/raw-node) |

## What a run looks like

```console
$ node bin/crashtest.js run --expect-baseline labs/crashledger.json   # against the vulnerable fixture variant
⚡ guards/hygiene-no-store: 2xx write from "enroll" has NO Cache-Control - shared caches may replay the write
⚡ input/proto-pollution-body: canary planted on Object.prototype via payload to "enroll" (status 200)
🛡 input/oversized-field: oversized body handled on "enroll" (status 200)
⚡ authz/role-body-spoof-family: body-declared role claims flipped the privilege decision on "admin": role via POST (status 200) | role via PUT (status 200) | role via PATCH (status 200)
⚡ proto-hygiene/request-shape-flood: request-shape flood broke 31 probe(s) across 8 route(s) - first: enroll duplicate key (2x): 500
⚡ session/cookie-hygiene: login cookie on "login" misses 3 hygiene flag(s): Secure (cookie must never ride plain http on a real surface); HttpOnly (script-readability = one XSS harvests every session); SameSite=Lax (or Strict) (un-padded cross-site carrying)
⚡ taxonomy/abuse-not-5xx: 7/10 abuse shapes escalated on "enroll" - first: truncated-object (5xx: 500)
⚡ taxonomy/errors-stay-impersonal: 1/10 error paths leak on "enroll" - first: not-json (canary echo (handler parroting attacker-controlled data))
🛡 volume/storage-fill: route "kvwrite" not declared on this target - fill check skipped (declare a KV-writing route)

tally: {"TOTAL":23,"REFUSED":9,"EXPLOITED":14,"BOUNDED":0} / cost: 672 ops / 722 requests
baseline: 0 new / 14 regressed / 0 accepted hits
exit: 1  (REFUSED->EXPLOITED regressions - fix it or bound it, then re-run)
```

Nothing about these lines is aspirational - they are the real output of this
repo's own vulnerable fixture variant (the bench-check in the quick start).
The full attack surface each line summarizes is in the [attack catalog](/crashtest/reference/attacks).
