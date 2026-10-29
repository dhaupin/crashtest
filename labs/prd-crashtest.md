# PRD: crashtest (adversarial QA for agent-built software)

**Status:** v0.2 - current (2026-10-29) · Owner: rook · Sponsor: dhaupin
**Role:** arm - the attack arm. It owns adversarial in-process QA and the verdict vocabulary.
**Package:** `crashtest` @ 1.2.0 (node >=18.17, ESM, zero runtime deps). npm latest is 1.1.0; 1.2.0 is committed and pending push.
**Core law:** we break it so they can not. Refused, exploited, bounded - and a
baseline ledger so CI fails only on regressions.
**Family:** the five arms are **govstruct** (govern), **packstruct** (spec),
**crashtest** (attack), **eyestruct** (watch), **poststruct** (audit). crashtest
owns the attack arm and the shared verdict vocabulary; it never opens a socket.
The forges are **monoforge** (the repo stamp) and **coreforge** (the site rig);
**railyard** is the composer that holds them. The interop law: no host imports a
sibling to check a sibling; it invokes the sibling's public CLI.

> **We break it so they can not.**
> Adversarial QA for agent-built software - in-process, no network, no bans.

---

## 1. One-line pitch

Crashtest is an npm CLI plus library that takes a software project and attacks
its **real code in-process** - the way a security engineer would, minus the live
server, the network traffic, and the invoice. It runs four kinds of campaigns
against the application's actual handlers and ends with a hardening report and a
baseline ledger so CI fails only on regressions.

## 2. What it is

It runs four kinds of campaigns against your application's actual handlers:

1. **Redteam** - logic attacks: takeover attempts, capability races, replay,
   identity spoofing, secret handling.
2. **Fuzz** - thousands of mutated, malformed, hostile bodies against every
   input surface, asserting only "never 500, never uncaught throws".
3. **Barrage** - volume campaigns: bursts, identity rotation, credential
   stuffing, storage fill - each with **cost accounting** (backend ops per
   admitted vs refused request).
4. **Guard checks** - rate-limit walls, breaker behavior, response hygiene.

And it ends with a **hardening report**: what was refused, what was exploited
(and whether that risk is accepted, with its bound), and a baseline ledger so CI
fails only on regressions.

**The invariant that makes it safe:** crashtest never opens a socket. Every
request is an in-process `Request` object through the app's own routing, against
an in-memory backend. That single invariant is the whole safety story.

## 3. Why it exists (the evidence)

Crashtest exists because we did this by hand and it worked absurdly well.
Gistory - an E2E-encrypted sync app - was hardened by hand in one pass:

- 17 red-team scenarios found 1 real bug and 6 accepted risks (now documented
  with bounds), refused 11 attacks.
- 6 barrage campaigns / 8,000+ in-process requests: zero 500/503, walls held,
  cost per attack measured.
- All of it against the real handlers on an in-memory database - **zero network
  requests, zero Cloudflare bans, zero risk to prod**.

That toolchain (harness plus scenarios plus campaigns) is the product. The
gistory suites ship as the first proof and the seed scenario library.

## 4. The problem it answers

Agent-built software (Lovable, Bolt, Replit, v0, Codebuff, Cursor) ships in
hours. What it almost never gets:

- an adversarial pass (pentests cost more than the app),
- volume and DoS testing (nobody fakes prod traffic into a dev server),
- an accepted-risk ledger (risks live in one person's head),
- a CI gate that catches security *regressions*.

Generic pentest tools (ffuf, nuclei, ZAP) need a live server and network
traffic - wrong shape for a solo dev or an agent loop, and banned by every
host's rate limiter. SAST tools (semgrep, CodeQL) read code but never *run* it,
so behavioral holes pass review.

## 5. How it works - the pipeline

```text
crashtest run [target]
  1. DISCOVER  detect entrypoints: Pages Functions, express/fastify/hono
               routers, env bindings (D1/KV/...), data layer shape.
  2. HARNESS   generate an instrumented in-process harness: real handlers +
               fake transport (Request/Response) + in-memory backend
               (SQLite / mock adapters) + op counters + cost meters.
  3. SCENARIOS run pluggable scenario libraries against the harness.
  4. CAMPAIGNS aggregate scenarios into campaigns (fuzz / barrage /
               redteam / guards) with verdicts:
               REFUSED (defense held) / EXPLOITED / BOUNDED (accepted risk).
  5. REPORT    write labs/hardening.md + update labs/crashledger.json;
               exit non-zero only on new EXPLOITED findings or ledger
               regressions.
```

## 6. The CLI surface

```
crashtest init                 # labs/crashledger.json + labs/hardening.md stub
crashtest run                  # verdicts print live; report + ledger update
crashtest run --module-plan    # dry-run: which attacks WILL fire? which packs need arming?
crashtest list                 # the loaded scenario libraries and packs
crashtest packs                # the pack surface (public + local lanes)
```

Exit contract: `0` unless a NEW EXPLOITED finding or a REFUSED to EXPLOITED
regression. The ledger is the memory; the exit code is the gate.

## 7. Scenario libraries (v1 catalog)

| Library | Attacks | Seeded from |
|---|---|---|
| `auth` | takeover, capability races, secret variants, spoofed identity, privilege confusion | gistory write-auth suite |
| `input` | mutation fuzz, prototype keys, duplicate keys, type confusion, hostile params, oversized fields | gistory WAF suite |
| `state` | cross-tenant reads, id enumeration oracles, row-move/aliasing bugs, watermark/pin analogues | gistory devices-PK + oracle findings |
| `volume` | burst, rotation, stuffing, storage fill, amplification (with cost accounting) | gistory barrage |
| `guards` | throttle walls, breaker behavior, response hygiene (no-store, Retry-After) | gistory guards tests |
| `taxonomy` | honest-refusal semantics: abuse answers 4xx, never 5xx or uncaught; error bodies stay impersonal | the response-shape dimension |
| `session` | cookie hygiene (Secure/HttpOnly/SameSite), fixation (sid rotation + forged-id rejection), logout invalidation | the cookie dimension `auth` left alone |
| `authz` | route x method matrix on privileged paths, self-declared role bodies, handler alias confusion | the privilege DECISION, not the owner field |
| `proto-hygiene` | HEAD/GET parity, duplicate query keys, dot-segment and double-slash paths, header case chaos | the cheap, low-false-positive layer |
| `recursion` | deep-nest stack exhaustion on recursive JSON walkers, catastrophic-backtracking patterns (redos) | the loop-without-a-guard class |
| `upload` | multipart shapes: filename traversal, double extensions, null-byte names, polyglot content types | the STORE, not the request |
| `race` | concurrent pairs: double-submit idempotency, concurrent partial writes (lost-update window) | interleaved scheduling in the harness |

Libraries are plain JS/TS modules with a tiny contract:
`{ name, attacks: [{ name, run(harness) -> { verdict, detail } }] }`. Third
parties (and the posse) can ship their own.

## 8. The report - labs/hardening.md

Human-first markdown, machine-checkable companion (`crashledger.json`):

```md
## Findings
### REFUSED (11)
- takeover-via-join-secret: push 403, hash unchanged
### EXPLOITED (1)
- watermark-pinning (ACCEPTED, bound: retried never skipped) - owner: dhaupin
## Cost economics
- refused request: ~1.4 backend ops / admitted: ~10 / fuzz rejection: ~0
## Baseline diff
- NEW: none / REGRESSED: none
```

CI rule: **fail on new EXPLOITED or on a regression of a previously REFUSED
check.** Accepted risks live in the ledger with owners and bounds - an accepted
risk without a bound is a finding.

## 9. Packs (the packstruct contract)

Crashtest is a `scenario`-profile host of the shared packstruct SPEC v1. Its
`packs/public/<name>/` packs ship 8 today (crashtest-site, cve-feed,
next-middleware-shapes, qs-shapes, vite-dev-shapes, wp-money-shapes, wp-roles,
wp-stock-smoke), each with `pack.json` plus an entry exporting
`{ register(ctx) }`. Arming: a pack may carry `armedByKey`; the host config
enumerates the pack, so opt-in is the arm.

The extended-source lane (external vulnerability corpora as packs) keeps the one
law: **no sockets at run time.** A maintainer-side sync step pulls a curated,
budget-capped snapshot ONCE and commits it into a pack (`cve-feed` ships this
way: <= 12 rows, <= 4200 bytes, two-way teeth pinned). Run time reads only the
committed snapshot; freshness is a CI join, never a runtime dial.

## 10. The family: who crashtest works with

| sibling | the crossing |
|---|---|
| **packstruct** | crashtest is a `scenario` host; `packstruct lint --deep` gates its packs |
| **poststruct** | shares the pack convention; crashtest attacks the loader, poststruct audits the bake |
| **eyestruct** | the WP service-thread precedent (subprocess, NDJSON on stdio, not a transport) is the shape the browser lane copies |
| **govstruct** | the suite roll-up consumes crashtest verdicts; the verdicts stay crashtest's |

**The interop law:** no host imports a sibling to check a sibling; it invokes
the sibling's public CLI. crashtest owns the attack arm and the verdict
vocabulary (`REFUSED` / `EXPLOITED` / `BOUNDED`); it does not audit bakes, judge
pixels, or govern the roster.

## 11. The browser lane (designed, deliberately not built)

The ask: scenarios for the DOM dimension - attacks that only make sense against
rendered pages (DOM clobbering, form-action/base hijack, postMessage origin
confusion, storage fingerprinting, CSP proof-by-render, clickjacking
visibility). Rule 1 is law: zero runtime dependencies in the core. The design
answers both: browser capability ships as a separate optional lane (a peer
package or a pack declaring its own `plugins`/deps), and the two honest
execution lanes stay socket-free at the run layer (a DOM-sim lane, and a
browser-thread lane using pipe transport like the WP worker precedent).

Status: designed, planned - not started. Whether DOM-sim lands first or the CDP
pipe lane does is a build-order question, not a design question.

## 12. The WordPress packs (state of the lane)

- **Shipped:** `wp-money-shapes` (write-volley / txn-replay / gate-burst) and
  `wp-stock-smoke` (inventory, option gates, call whitelist, cost meters - the
  shape that degrades to honest skipped-REFUSED on every non-WP run root).
- **The adapter:** `src/adapters/wordpress.js` is the subprocess spike - the WP
  worker runs as a subprocess, the wire is NDJSON on stdio (a wire format, not a
  transport).
- **Gap check (closed):** the stub WP core, the `wp-roles` pack, and the armed
  CI exercise all landed. The real-WP e2e still lives in target run roots.

## 13. Milestones

- **v0.1 - the gistory extraction.** Harness (Pages Functions plus in-memory
  D1); libraries auth, input, guards; report plus ledger plus CLI; dogfood.
  **DONE.**
- **v0.2 - everyone's backend.** Adapters express, fastify, hono; volume/state
  libraries; GitHub Action; harness memory reuse. **DONE.**
- **v0.3 - the ecosystem.** Plugin API; config surface; WP/PHP subprocess spike
  (experimental); framework recipes. **DONE** (WP lane shipped, experimental).
- **v1.x - the pack lane and the walk.** 8 public packs; the cve-feed snapshot;
  the browser lane designed. **IN PROGRESS.**

## 14. Non-goals (v1)

- **No live-fire testing** against deployed URLs (that is what got banned).
- **No browser/UI testing** in the core (playwright-land; a different gauntlet).
- **No runtime protection** after deploy (audithole's honeypot territory -
  complementary: audithole watches strangers outside, crashtest breaks things
  inside before strangers arrive).
- **No fixing the bugs.** Crashtest reports; the agent or human fixes.

## 15. Open questions

- **The hosted lane (v0.4 sketch).** A gated hosted runner is a planning sketch
  only; nothing shipped. The safety invariant (no sockets at run time) is what
  any hosted shape must preserve.
- **Snapshot refresh automation (cve-feed).** The refresh runbook is unwritten
  and the refresh is manual until the automation lands; the candidate is a
  scheduled CI job that opens a PR carrying the new snapshot, never a silent
  runtime dial.
- **Browser lane build order.** DOM-sim first or the CDP pipe lane first.
