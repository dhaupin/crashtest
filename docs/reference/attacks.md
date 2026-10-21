---
permalink: reference/attacks
layout: default
title: The Attack Catalog
description: Every shipped scenario module and attack, what it does, and what verdicts it can produce.
---

# The Attack Catalog

Twenty-one attacks across eight modules ship in the core package. Each returns
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

## Writing your own

Any module with the same contract loads from
`labs/scenarios/` (or any dir via `scenarioDirs`). Full contract in
[`src/scenarios/contract.js`](https://github.com/dhaupin/crashtest/blob/main/src/scenarios/contract.js) -
`name`, `description`, `attacks: [{ name, run(harness, ctx) => one verdict }]`.
