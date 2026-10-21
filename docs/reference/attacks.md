---
permalink: reference/attacks
layout: default
title: The Attack Catalog
description: Every shipped scenario module and attack, what it does, and what verdicts it can produce.
---

# The Attack Catalog

Thirty attacks across twelve modules ship in the core package. Each returns
exactly one verdict per run: 🛡 REFUSED, ⚡ EXPLOITED, or 🔒 BOUNDED
(BOUNDED requires an owner + bound or it demotes to EXPLOITED - loudly).

## `auth` - identity and secrets

| Attack | What it does |
|---|---|
| `identity-spoof-headers` | Fires a 54-header identity matrix (`x-is-admin`, `x-user-role`, `x-forwarded-for`, ...) at your privileged route. A spoof that flips an authorized action = EXPLOITED; all denied/ignored = REFUSED. |
| `secret-watermark` | Plants fake secrets in the fake env, then walks error paths. A probe that echoes one back = EXPLOITED. |
| `privilege-escalation` | Replays writes where `owner` names someone else (victim pairs: attacker->victim, attacker->admin). An accepted write = EXPLOITED. |

## `authz` - the privilege decision

Where `auth` attacks who you claim to be, `authz` attacks the privilege
DECISION itself - how a handler's admin gate gets flipped without touching
the owner field. All three skip politely when their routes are undeclared.

| Attack | What it does |
|---|---|
| `method-matrix-privileged` | The privileged route must deny ON EVERY HTTP METHOD (GET/POST/PUT/PATCH/DELETE, bare + with bodies). A gate that only trips on the method the developer tested = EXPLOITED with the winning method named. |
| `role-body-spoof-family` | Self-declared role bodies never route: the role-word field family (`role`, `isAdmin`, `is_admin`, `scope`, `permissions`, nested `user.role`, ...) fired at the privileged route must not flip a deny. Any grant = the classic "trust the body's role field" draft. |
| `handler-alias-confusion` | A second route performing the same privileged action (the dev/debug leftover) must deny identically to the primary - unauthenticated AND under identity-header spoofing. An alias that honors what the primary ignores is the trapdoor. |

## `guards` - hygiene and load

| Attack | What it does |
|---|---|
| `hygiene-no-store` | Every 2xx write must carry a store class (`no-store`, `private`, or explicit cache bounds). Missing = EXPLOITED - shared caches may replay a write. |
| `burst-wall` | 50 requests at sustained pace. Absence of a wall is fine if nothing breaks; 5xx storms or timeouts = EXPLOITED (honest 429s with Retry-After = the good shape). |

## `input` - payloads

| Attack | What it does |
|---|---|
| `proto-pollution-body` | `__proto__`/`constructor` keys through JSON bodies (JSON.stringify drops them, so the transport replays them raw). State changed after a write = EXPLOITED. |
| `never-fail-mutations` | 64 hostile bodies (huge ids, nested types, unicode tricks). Any landing past 4xx - a 500, a crash, a hang - = EXPLOITED per-case with the first offender named. |
| `oversized-field` | 1MB fields, deep nesting, giant arrays. A shaped enforcement (413/400) = REFUSED. |

## `state` - data you don't own

| Attack | What it does |
|---|---|
| `enumeration-oracle` | Arms `mustDenyIds` and probes each (query or body). A 200 (or a response ripple) for a foreign id = EXPLOITED. |
| `id-collision-alias` | Two owners claim the same id. The env snapshot decides: owner-a's row silently overwritten in place = EXPLOITED. Needs an `env.DB` binding (skips politely without one). |

## `volume` - economics

| Attack | What it does |
|---|---|
| `credential-stuffing` | 60 credential shapes in sequence. Crashing = EXPLOITED; shaped 4xx = REFUSED. |
| `storage-fill` | 30 rounds of 8KB unique writes through a kv-backed route. Tracks ops AND storage growth per round. |
| `cost-amplification` | 40 identical replays against a cost ceiling (`maxOpsPerRequest`). Over the bound with measurable per-request economics = EXPLOITED with numbers. |

## `taxonomy` - honest refusal

| Attack | What it does |
|---|---|
| `abuse-not-5xx` | Fires abuse shapes (garbage + truncated JSON, wrong/absent content types, oversized strings) at your route. Every one must come back as an honest 4xx-class refusal - a 5xx or an uncaught throw = EXPLOITED. Same fuzz-floor oracle the input module uses, on the raw-garbage payload family. |
| `errors-stay-impersonal` | The sad path is infrastructure, not an inspector: error bodies must not parrot attacker-planted canaries (fields echoed back with their own values or names) or stack fragments (V8 frames, `node:internal`, file:line:col). A leak = EXPLOITED with the fleeing named. |

## `session` - how the session behaves on the wire

Where `auth` attacks who you claim to be (headers) and what you own (owner
writes), `session` attacks the cookie itself. All three skip politely when
their routes are undeclared; a cookie-less (bearer-token) login honestly
skips the hygiene gradings (armed=false) - the route must mint a cookie for
this module to assess it.

| Attack | What it does |
|---|---|
| `cookie-hygiene` | The auth transition (login) must mint a `Set-Cookie` carrying `Secure`, `HttpOnly`, and a `SameSite` policy. Any missing flag = EXPLOITED with the flag named. |
| `session-fixation` | Two logins must mint DIFFERENT session ids (a shared sid across the privilege transition is the fixation classic), and a forged canary sid must never authenticate - `me()` honoring an unknown cookie = EXPLOITED. |
| `logout-invalidates` | A logged-out sid must be dead on arrival: `me()` with the pre-logout cookie must deny (4xx class). Still-200 = EXPLOITED - the server kept the session alive. |
| `token-replay-deny` | The PRD's replay window: no login may ever re-issue a sid it already issued. Four logins (account A, B, A again, C) must mint pairwise-distinct sids, and the A-again re-login must not resurrect its original sid - a reused sid makes every expired-but-known token replayable forever. |

## `proto-hygiene` - bare request geometry

The guards extension from the PRD's cheap/low-false-positive slot: how the
request's bare geometry is met, before any payload matters. Both attacks
sweep every declared route (narrow with `ctx.routes`).

| Attack | What it does |
|---|---|
| `head-get-parity` | HEAD must be the cheap mirror of GET: no throw, no status drift where GET answered 2xx (only an honest 405 is excusable). HEAD body bytes are an INFO note, never a finding - wire runtimes usually strip them, so grading that in-process would false-positive correct handlers. |
| `request-shape-flood` | The bare shapes attackers fire before payloads: duplicate query keys, malformed separators, embedded control bytes, dot-segment/double-slash path shapes, and identity headers in three casings. No 5xx, no uncaught throw, and answers must not change when only the spelling did. This probe graded a real 204-with-body bug in this repo's own demo fixture on its first dogfood run. |

Scope note: header CASE is a transport invariant here (the in-process WHATWG
`Headers` normalizes names by construction), so the case axis pins the
invariant rather than grading handler choices - differential control, exactly
why the PRD filed it under cheap.

## `recursion` - loops without a guard

The agentic-work dimension: the two unbounded-work bugs agent-authored
handlers write constantly - recursive JSON walkers and validation regexes
written on the first attempt.

| Attack | What it does |
|---|---|
| `deep-nest-stack-overflow` | A JSON structure nested thousands deep meets the handler: V8's `JSON.parse` is iterative and survives, so any RECURSIVE walk over the structure (merges, flatteners, normalizers) is where the call stack explodes - an uncaught `RangeError` = EXPLOITED; a depth guard answering 4xx = REFUSED. |
| `redos-catastrophic-pattern` | Validation regexes behind attacker-controlled strings must backtrack linearly. The library's ONE timing-relative probe by design: evil-vs-benign pairs that differ only in their last character walk the SAME handler, and only a SELF-relative ratio (40x) plus a substantial absolute bucket decide - no host clock ever does. Shapes are verified against V8's irregexp: matching suffixes terminate fast, so the evil probe FAILS the regex, which is what detonates the backtrack. |

## `upload` - multipart shapes

Upload handlers are where agent-authored storage code trusts the client the
hardest, because the filename and content type look like ordinary strings.
Both attacks verdict off the STORE: what the handler derives and persists is
the wire truth. ctx: `route` (default `upload`) and `store` (default
`UPLOADS`, a fake-KV namespace mounted at `env.<store>`); undeclared routes
or stores skip honestly.

| Attack | What it does |
|---|---|
| `filename-traversal-family` | Attacker-shaped filenames (unix/windows traversal, percent-dots, null-byte splits, double extensions, absolute paths, dotfiles) ride a multipart POST. Any derived storage key that escapes the safe-name grammar = EXPLOITED with the key named - the measured wire truth, parsed from the storage layer after the write. |
| `mime-polyglot-family` | Content types that lie: an SVG with a script inside and a text/html document are canonical XSS carriers. Stored verbatim = EXPLOITED; refused with an honest 4xx = REFUSED. The implied fix is an allow-list discipline on the content type, the same allow-list the demo fixture hardened the week it shipped. |

## `race` - concurrency

In-process synchronization comes free: handlers under one burst interleave
at every await boundary (the fake D1/KV calls are async), which is exactly
the read-before-write / write-after-read window the classic races live in.
Bursts are deterministic by microtask order - same inputs, same schedule.

| Attack | What it does |
|---|---|
| `double-submit-idempotency` | N concurrent POSTs with the SAME idempotency key must land exactly ONE side effect. Two acknowledged-and-stored = the double-charge class; an uncaught same-key throw (storage wall without a shaped answer) is also a finding; one row + shaped 409s = REFUSED. |
| `concurrent-write-lost-update` | Two concurrent writers submit DIFFERENT fields into the same record; after both land, every field must be present. A record holding only the last writer's fields (or a writer lost to an uncaught unique row conflict) = the silent-stomp lost-update class, EXPLOITED with what dropped named. Per-field storage or conflict-detecting writes = REFUSED. |

## Shipped packs (belt with suspenders)

The core package also ships two public packs, loaded per run root with
`packs:` and enumerated with `crashtest packs` - they ride the same
contract, so their verdicts land in the same ledger:

- `crashtest-site` (18 attacks) - the self-check every crashtest release
  must survive: it sweeps everything the project itself ships
  (sitemap truth, robots.txt self-sabotage, secret leakage in HTML). It
  is the pack that caught a real bug on its first run: a malformed
  version payload once answered 200, and the validation floor now
  pays for itself in CI.
- `cve-feed` (2 attacks: `kev-banner-audit`, `kev-version-range-audit`) -
  known-vulnerability awareness against a curated KEV/NVD snapshot of 12
  entries, budget-capped (12 rows / 4200 bytes). Run time reads only the
  committed `snapshot.json` - no sockets, same commit -> same findings;
  refresh is a maintainer-side sync plus a CI-side byte-integrity join.
  `kev-banner-audit` sweeps every declared route for disclosure culture
  (`Server`, `X-Powered-By`, stack-tell bodies spelled like shipped
  CVEs) - any hit is EXPLOITED; a quiet surface is REFUSED.
  `kev-version-range-audit` reads disclosed versions from the surface
  and refuses any that sit in an entry's vulnerable set. Match tokens
  are word-boundary-disciplined, so `ws` never matches inside
  `answer` - both teeth and the no-false-positive case are pinned in
  `test/cve-feed.test.js`.

## Writing your own

Any module with the same contract loads from
`labs/scenarios/` (or any dir via `scenarioDirs`). Full contract in
[`src/scenarios/contract.js`](https://github.com/dhaupin/crashtest/blob/main/src/scenarios/contract.js) -
`name`, `description`, `attacks: [{ name, run(harness, ctx) => one verdict }]`.
