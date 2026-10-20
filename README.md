# crashtest

> **We break it so they can't.**
> In-process adversarial QA for agent-built software — no network, no bans, no invoice.

Crashtest attacks your project's **real handlers** — the way a security engineer
would, minus the live server. Every attack is an in-process `Request` through
your own routing, against an in-memory backend, with op counters attached. It
never opens a socket. That invariant is the whole safety story.

## Campaigns (v0.1)

| Campaign | What it does |
|---|---|
| **redteam** | logic attacks: takeover, capability races, replay, identity spoofing, secret handling |
| **fuzz** | mutated/malformed/hostile bodies against every input surface; asserts "never 500, never uncaught" |
| **barrage** | volume campaigns with **cost accounting** (backend ops per admitted vs refused request) |
| **guards** | rate-limit walls, breaker behavior, response hygiene |

Verdicts: **REFUSED** (defense held) · **EXPLOITED** (you got hit) ·
**BOUNDED** (accepted risk, with owner + bound).

It ends with `labs/hardening.md` (human-first) and `labs/crashledger.json`
(CI gate: fail **only** on a new EXPLOITED or a regression of something
previously REFUSED — accepted risks never re-alarm you).

## Status: v0.1 in flight (pipeline works end-to-end)

The campaign pipeline runs against a declared target:

```bash
crashtest init               # writes labs/crashledger.json + labs/hardening.md stub
crashtest run                # attacks the target from crashtest.config.js
# → prints verdicts live, writes labs/hardening.md + labs/crashledger.json
# → exit 0 unless a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression
```

This repo dogfoods itself: `crashtest run` attacks `fixtures/demo/` and CI
gates on the committed `labs/crashledger.json` baseline. Seed campaigns:
`auth` (identity spoofing, secret watermark, privilege escalation), `input`
(proto-pollution, mutation fuzz floor, oversized fields), `guards`
(cache hygiene, burst walls + Retry-After), `state` (cross-tenant reads, id
collision/alias overwrite), `volume` (stuffing, storage fill, cost
amplification — every campaign reports backend ops/request). Bring your own
scenarios by dropping ESM modules into `labs/scenarios/`.

## Framework targets (v0.2)

The target config can dispatch **any framework that can fire in-process** —
no server, no sockets, ever:

```js
// crashtest.config.js
import { ENV_SPEC, buildRoutes } from './fixtures/demo/app.js';
export default {
  env: ENV_SPEC,
  routes: buildRoutes(),          // plain (ctx) => Response handlers
  adapters: { hono: honoApp, express: expressApp, fastify: await fastifyApp.ready() },
  seed: 0xC0FFEE,
};
```

Adapters dispatch through the framework's own in-process surface (`hono.request`,
`app.handle`, `fastify.inject`) and expose the app as a harness route named
`app` (configurable) — every scenario library runs against it unchanged.

## CI as a GitHub Action (v0.2)

```yaml
- uses: dhaupin/crashtest@v0   # composite: install + run + gate
  with:
    config: crashtest.config.js
    run-tests: 'true'          # optional: also run the target's own tests
```

Fails on a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression — never
on accepted risks.

## Landscape

| Tool | Mode | Gap crashtest fills |
|---|---|---|
| ffuf / nuclei / ZAP | live network | needs a server + traffic; banned by hosts |
| semgrep / CodeQL | static | never *runs* the code; behavioral holes pass review |
| **crashtest** | behavioral, in-process, pre-deploy | — |

## Principles

1. **Attack code, not people.** No live-fire, no third-party targets, ever.
2. **In-process or nothing.** If it needs a socket, it's out of scope.
3. **Deterministic.** Same commit → same findings (seeded randomness).
4. **Markdown is the interface.** Reports a human reads, JSON a CI reads.
5. **Zero dependencies by default.** The attacker ships light.
6. **Accepted risks must have owners and bounds.**

License: MIT. PRD and task log: [`labs/`](./labs/) in the repo.
