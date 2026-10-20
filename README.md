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

## Status: 0.0.x (name-stake + scaffolding release)

The full pipeline (harness → scenario libraries → campaigns → report lands
**0.1**). This early release exists to claim the name and ship the skeleton:

```bash
npx crashtest init             # writes labs/crashledger.json + labs/hardening.md stub
npx crashtest --version
```

`crashtest run` honestly refuses until 0.1 (exit 2, with roadmap).

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
