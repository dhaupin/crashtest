# Crashtest — Product Requirements Document

> **We break it so they can't.**
> Adversarial QA for agent-built software — in-process, no network, no bans.

Status: v0.1 draft · Owner: rook (Rook) · Sponsor: dhaupin · License: MIT

---

## 1. What Crashtest is

Crashtest is an npm CLI + library that takes a software project and attacks
its **real code in-process** — the way a security engineer would, minus the
live server, the network traffic, and the invoice.

It runs four kinds of campaigns against your application's actual handlers:

1. **Redteam** — logic attacks: takeover attempts, capability races, replay,
   identity spoofing, secret handling.
2. **Fuzz** — thousands of mutated, malformed, hostile bodies against every
   input surface, asserting only "never 500, never uncaught throws".
3. **Barrage** — volume campaigns: bursts, identity rotation, credential
   stuffing, storage fill — each with **cost accounting** (backend ops per
   admitted vs refused request).
4. **Guard checks** — rate-limit walls, breaker behavior, response hygiene.

And it ends with a **hardening report**: what was refused, what was exploited
(and whether that risk is accepted, with its bound), and a baseline ledger
so CI fails only on *regressions*.

## 2. Origin story (the evidence)

Crashtest exists because we did this by hand and it worked absurdly well.
Gistory — an E2E-encrypted sync app — was hardened by hand in one pass:

- 17 red-team scenarios found 1 real bug and 6 accepted risks (now
  documented with bounds), refused 11 attacks.
- 6 barrage campaigns / 8,000+ in-process requests: zero 500/503, walls
  held, cost per attack measured.
- All of it against the real handlers on an in-memory database — **zero
  network requests, zero Cloudflare bans, zero risk to prod**.

That toolchain (harness + scenarios + campaigns) is the product. The
gistory suites ship as the first proof and the seed scenario library.

## 3. Problem

Agent-built software (Lovable, Bolt, Replit, v0, Codebuff, Cursor…) ships
in hours. What it almost never gets:

- an adversarial pass (pentests cost more than the app),
- volume/DoS testing (nobody fakes prod traffic into a dev server),
- an accepted-risk ledger (risks live in one person's head),
- a CI gate that catches security *regressions*.

Meanwhile generic pentest tools (ffuf, nuclei, ZAP) need a **live server and
network traffic** — wrong shape for a solo dev or an agent loop, and banned
by every host's rate limiter. SAST tools (semgrep, CodeQL) read code but
never *run* it, so behavioral holes pass review.

## 4. Users

- **Agent developers** (primary) — the posse: AI agents building web apps
  who want a hardening pass as part of "done".
- **Solo/small OSS maintainers** — adversarial QA without a security team.
- **Security-minded teams** — a first-pass filter before human review.

## 5. How it works — the pipeline

```
crashtest run [target]
  1. DISCOVER  detect entrypoints: Pages Functions, express/fastify/hono
               routers, env bindings (D1/KV/…), data layer shape.
  2. HARNESS   generate an instrumented in-process harness: real handlers +
               fake transport (Request/Response) + in-memory backend
               (SQLite / mock adapters) + op counters + cost meters.
  3. SCENARIOS run pluggable scenario libraries against the harness.
  4. CAMPAIGNS aggregate scenarios into campaigns (fuzz / barrage /
               redteam / guards) with verdicts:
               REFUSED (defense held) · EXPLOITED · BOUNDED (accepted risk).
  5. REPORT    write labs/hardening.md + update labs/crashledger.json;
               exit non-zero only on new EXPLOITED findings or ledger
               regressions.
```

**The invariant that makes it safe:** Crashtest never opens a socket. Every
request is an in-process `Request` object through the app's own routing.

## 6. Scenario libraries (v1 catalog)

| Library | Attacks | Seeded from |
|---|---|---|
| `auth` | takeover, capability races, secret variants, spoofed identity, privilege confusion | gistory write-auth suite |
| `input` | mutation fuzz, prototype keys, duplicate keys, type confusion, hostile params, oversized fields | gistory WAF suite |
| `state` | cross-tenant reads, id enumeration oracles, row-move/aliasing bugs, watermark/pin analogues | gistory devices-PK + oracle findings |
| `volume` | burst, rotation, stuffing, storage fill, amplification (with cost accounting) | gistory barrage |
| `guards` | throttle walls, breaker behavior, response hygiene (no-store, Retry-After) | gistory guards tests |

Libraries are plain JS/TS modules with a tiny contract:
`{ name, attacks: [{ name, run(harness) → { verdict, detail } }] }`.
Third parties (and the posse) can ship their own.

## 7. The report — labs/hardening.md

Human-first markdown, machine-checkable companion (`crashledger.json`):

```md
## Findings
### 🛡 REFUSED (11)
- takeover-via-join-secret: push 403, hash unchanged
...
### ⚡ EXPLOITED (1)
- watermark-pinning (ACCEPTED, bound: retried never skipped) — owner: dhaupin
...
## Cost economics
- refused request: ~1.4 backend ops · admitted: ~10 · fuzz rejection: ~0
## Baseline diff
- NEW: none · REGRESSED: none
```

CI rule: **fail on new EXPLOITED or on a regression of a previously REFUSED
check.** Accepted risks live in the ledger with owners and bounds — an
accepted risk without a bound is a finding.

## 8. Goals

**v0.1 — "the gistory extraction"**
- Harness: Cloudflare Pages Functions + in-memory D1 (the proven path).
- Libraries: auth, input, guards (ported from gistory).
- Report + ledger + CLI (`crashtest run`, `crashtest init`).
- Dogfood: crashtest attacks its own test fixtures; gistory adopts it.

**v0.2 — "everyone's backend"**
- Adapters: express, fastify, hono (in-process supertest-style transport).
- volume/state libraries ported; GitHub Action (`crashtest/action`).
- Harness memory reuse for sub-second repeat runs.

**v0.3 — "the ecosystem"**
- Plugin API for community libraries; config surface (crashtest.config).
- WP/PHP feasibility spike (subprocess harness — explicitly experimental).
- Framework recipes: one-line presets for Lovable/Bolt/Replit exports.

## 9. Non-goals (v1)

- ❌ Live-fire testing against deployed URLs (that's what got banned).
- ❌ Browser/UI testing (playwright-land; a different gauntlet).
- ❌ Runtime protection after deploy (audithole's honeypot territory —
  complementary: audithole watches strangers outside; Crashtest breaks
  things inside before strangers arrive).
- ❌ Fixing the bugs. Crashtest reports; the agent (or human) fixes.

## 10. Principles

1. **Attack code, not people.** No live-fire, no third-party targets, ever.
2. **In-process or nothing.** If it needs a socket, it's out of scope.
3. **Deterministic.** Same commit → same findings (seeded randomness).
4. **Markdown is the interface.** Reports a human reads, JSON a CI reads.
5. **Zero dependencies by default.** The attacker ships light.
6. **Accepted risks must have owners and bounds.**

## 11. Landscape

| Tool | Mode | Gap Crashtest fills |
|---|---|---|
| ffuf / nuclei / ZAP | live network | needs a server + traffic; banned by hosts |
| semgrep / CodeQL | static | never runs the code; behavioral holes pass |
| audit**hole** | runtime honeypot (post-deploy, outside-in) | complementary, not competing |
| **Crashtest** | **behavioral, in-process, pre-deploy** | — |

## 12. Success metrics

- Finds ≥1 real bug on the first run of an unaudited agent-built repo.
- Default run < 60s on a small API.
- Zero false-positive CI failures after the baseline is accepted.
- Gistory's suites ported and passing as the seed library.

## 13. Open questions

- Harness discovery: static import analysis vs runtime registration hooks?
  (v0.1: explicit route tables; v0.2: convention sniffing.)
- How do Windows agents run in-memory SQLite? (better-sqlite3 vs node:sqlite
  — node:sqlite is experimental; decide at first Windows report.)
- Ledger ownership UX: who "accepts" a risk in a purely agentic repo?

## 14. The platform thread (v0.4+): crashtest as a CI runner

**Vision.** The lane is not just "a CLI you run" — it is **a greptile-style
review service that replaces home-brew test suites as the quality gate for
agent-built repos**: point crashtest at a repo (or a run root beside it),
and every push gets the seeded adversarial suite, a diff against the
committed ledger, and a shareable finding report — without the repo
carrying its own test rig.

The pieces this PRD builds toward, aligned to today's ships + thread:

1. **CLI = drone engine.** The CLI stays zero-dep and offline; the service
   shells it, it never becomes a runtime. Every future flag must keep a
   story in both worlds:
   - shipped 2026-10: `crashtest run --json` — the full run blob on stdout
     (machine artifact for CI + paste-into-dashboard), humans keep the
     verdict stream.
   - next: `--out-dir` (artifact fan-out), `--expect-baseline <path>`
     (diff against a given ledger without touching labs/ — the piece that
     makes a hosted run read-only), `--module-plan` (dry-run: which attack
     ids WOULD fire against this target).
2. **Adapters = target surface.** The adapter registry (hono / express /
   fastify / node / **wordpress spike**) is what lets the service attack
   repos with zero changes to them — run roots OUTSIDE the target repo
   (the WP issue-#1/#2 pattern is already the template for cross-repo
   adoption: config + scenarioDirs + a read-only CI identity).
3. **Ledger = the artifact contract.** schemaVersion 1 (findings /
   acceptedRisks / baseline) is the API between drone, service, and
   dashboard. Every consumer (CI gate, dashboard bridge, future web
   service) reads the same JSON; the §7 exit rule has exactly one
   implementation (`src/report.js`) and everything else imports it.
4. **Dashboard = the human surface, headless-first.** The shipped
   `/dashboard` (web/src/lib/ledgerModel.js) already renders any ledger or
   run blob the way the service eventually will; the service adds: remote
   run roots (cron/PR-triggered), org dashboards, and ledger-hosting with
   owner+bound sign-off UX (§13's ownership question must be answered
   BEFORE hosted accepted-risks exist).

**Still true when it's a service (no drift from principles):**
- No sockets, ever — the drone runs in your runner/namespace; it never
  dials anything. The service collects ARTIFACTS (ledger, run blob),
  not traffic.
- Deterministic: a service rerun of the same commit must reproduce the
  same findings — §7's diff semantics make that auditable replay.
- The repo owns its baseline; the service never overwrites `labs/` of a
  target repo — hosted runs diff against the committed ledger and hand
  the user the diff, never a rewritten file.

**Sequencing (rough):** v0.3 = WP spike stabilization + recipes (the
current thread); v0.4 = service-shaped flags (above) + GitHub Action
rerunability (re-push-tag workaround retired); v0.5 = hosted run roots +
service ledger reads; then the org tier.

**Success metric for the thread** (extends §12): an agent-built repo with
NO test suite of its own gets its first ledger + CI gate in <5 minutes
without installing anything beyond the drone.
