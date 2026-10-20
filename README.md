# crashtest

> **We break it so they can't.**
> In-process adversarial QA for agent-built software — no network, no bans, no invoice.
>
> [`npmjs.com/package/crashtest`](https://www.npmjs.com/package/crashtest) · MIT · v0.1.0

Crashtest attacks your project's **real handlers** — the way a security engineer
would, minus the live server. Every attack is an in-process `Request` through
your own routing, against an in-memory backend, with op counters attached. It
never opens a socket. That invariant is the whole safety story.

## 60-second usage

```bash
npx crashtest init                 # labs/crashledger.json + labs/hardening.md stub — commit them
# write crashtest.config.js: routes (your real handlers) + fake env   (see docs/DEPLOY.md)
npx crashtest run                  # verdicts print live; report + ledger update
# exit 0 unless a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression
```

```js
// crashtest.config.js — the shape
import { buildRoutes, ENV_SPEC } from './src/app.js';

export default {
  routes: buildRoutes(),           // (ctx) => Response handlers (Pages-Functions shape)
  env: ENV_SPEC,                   // fake backend: D1 tables, KV, fake secrets
  adapters: { /* hono: app, express: app, fastify: await app.ready() */ },
  seed: 0xC0FFEE,                  // deterministic: same commit → same findings
};
```

## Seed campaigns (built in)

| Library | Attacks shipped |
|---|---|
| **auth** | identity-spoof-headers (54-spoof matrix: denied→allowed flip = bypass) · secret-watermark (fake env secrets must never leak) · privilege-escalation (denied writes must not flip on field mutations) |
| **input** | proto-pollution-body (Object.prototype canary via hostile JSON keys) · never-fail-mutations (seeded hostile bodies; floor = never 500, never an uncaught throw) · oversized-field (1 MiB bodies) |
| **guards** | hygiene-no-store (surviving 2xx writes need explicit Cache-Control) · burst-wall (walls must carry Retry-After; any break is a finding) |
| **state** | enumeration-oracle (foreign ids must deny — no cross-tenant reads) · id-collision-alias (second owner same key must conflict or fork — overwrites caught by DB snapshot diff) |
| **volume** | credential-stuffing · storage-fill · cost-amplification — every attack reports **backend ops/request** (bound via config, default 12) |

Verdicts: **REFUSED** (defense held) · **EXPLOITED** (you got hit) ·
**BOUNDED** (accepted risk — requires `owner` + `bound` or it's a finding).

Reports: `labs/hardening.md` (human-first) + `labs/crashledger.json`
(CI gate: fail **only** on a new EXPLOITED or a regression of something
previously REFUSED — accepted risks never re-alarm you).

## Framing the working shape

Bring your own scenarios (ESM modules in `labs/scenarios/` or listed in
`scenarioDirs`) — contract:
`{ name, description, attacks: [{ name, run(harness, ctx) → verdict }] }`.

Framework dispatch targets work in-process — no server, no sockets, ever:

```js
adapters: {
  hono: honoApp,                     // app.request()
  express: expressApp,               // app.handle() (routes must end their response)
  fastify: await fastifyApp.ready(), // app.inject() (routes exist post-ready)
  // wordpress: { wpRoot },           // v0.3 spike — PHP worker, NDJSON stdio, no sockets
}
```

## CI as a GitHub Action

```yaml
- uses: dhaupin/crashtest@v0.1.0   # composite: install + run + gate
  with:
    config: crashtest.config.js
    run-tests: 'true'              # optional: also run your own tests
```

Fails on a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression — never
on accepted risks. (A moving `v0` major tag is planned; pin the version for
now.)

## This repo dogfoods itself

`npx crashtest run` attacks [`fixtures/demo/`](./fixtures/demo/app.js)
(hardened + the deliberately-broken draft), gated in CI against the committed
[`labs/crashledger.json`](./labs/crashledger.json). The committed
[`labs/hardening.md`](./labs/hardening.md) is the live report; provenance on
every npm release traces package → commit (verify the badge on npm).

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

## Docs map

- **Full docs** → [docs.creadev.org/crashtest](https://docs.creadev.org/crashtest/) (quick start, playbooks, catalog, ledger format — the same content crosslinked from the CLI help)
- **Site** → [crashtest.creadev.org](https://crashtest.creadev.org) (sourced from this repo's `/web`, prerendered by prestruct)
- **Dashboard** → [crashtest.creadev.org/dashboard](https://crashtest.creadev.org/dashboard) (render any ledger or run in-browser — same §7 rule, zero backend)
- **Adopting / releasing** → [`DEPLOY.md`](./DEPLOY.md) (install → adopt → publish runbook → troubleshooting)
- **Agent/human contributor conventions** → [`AGENTS.md`](./AGENTS.md)
- **Publish internals** (npm Trusted Publishing, staged route, token policy) → [`docs/publish.md`](./docs/publish.md)
- **Contract + task log** → [`labs/prd-crashtest.md`](./labs/prd-crashtest.md) + [`labs/TASKS.md`](./labs/TASKS.md)

License: MIT.
