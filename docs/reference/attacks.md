---
permalink: reference/attacks
layout: default
title: The Attack Catalog
description: Every shipped scenario module and attack, what it does, and what verdicts it can produce.
---

# The Attack Catalog

Thirteen attacks across five modules ship in the core package. Each returns
exactly one verdict per run: 🛡 REFUSED, ⚡ EXPLOITED, or 🔒 BOUNDED
(BOUNDED requires an owner + bound or it demotes to EXPLOITED — loudly).

## `auth` — identity and secrets

| Attack | What it does |
|---|---|
| `identity-spoof-headers` | Fires a 54-header identity matrix (`x-is-admin`, `x-user-role`, `x-forwarded-for`, …) at your privileged route. A spoof that flips an authorized action = EXPLOITED; all denied/ignored = REFUSED. |
| `secret-watermark` | Plants fake secrets in the fake env, then walks error paths. A probe that echoes one back = EXPLOITED. |
| `privilege-escalation` | Replays writes where `owner` names someone else (victim pairs: attacker→victim, attacker→admin). An accepted write = EXPLOITED. |

## `guards` — hygiene and load

| Attack | What it does |
|---|---|
| `hygiene-no-store` | Every 2xx write must carry a store class (`no-store`, `private`, or explicit cache bounds). Missing = EXPLOITED — shared caches may replay a write. |
| `burst-wall` | 50 requests at sustained pace. Absence of a wall is fine if nothing breaks; 5xx storms or timeouts = EXPLOITED (honest 429s with Retry-After = the good shape). |

## `input` — payloads

| Attack | What it does |
|---|---|
| `proto-pollution-body` | `__proto__`/`constructor` keys through JSON bodies (JSON.stringify drops them, so the transport replays them raw). State changed after a write = EXPLOITED. |
| `never-fail-mutations` | 64 hostile bodies (huge ids, nested types, unicode tricks). Any landing past 4xx — a 500, a crash, a hang — = EXPLOITED per-case with the first offender named. |
| `oversized-field` | 1MB fields, deep nesting, giant arrays. A shaped enforcement (413/400) = REFUSED. |

## `state` — data you don't own

| Attack | What it does |
|---|---|
| `enumeration-oracle` | Arms `mustDenyIds` and probes each (query or body). A 200 (or a response ripple) for a foreign id = EXPLOITED. |
| `id-collision-alias` | Two owners claim the same id. The env snapshot decides: owner-a's row silently overwritten in place = EXPLOITED. Needs an `env.DB` binding (skips politely without one). |

## `volume` — economics

| Attack | What it does |
|---|---|
| `credential-stuffing` | 60 credential shapes in sequence. Crashing = EXPLOITED; shaped 4xx = REFUSED. |
| `storage-fill` | 30 rounds of 8KB unique writes through a kv-backed route. Tracks ops AND storage growth per round. |
| `cost-amplification` | 40 identical replays against a cost ceiling (`maxOpsPerRequest`). Over the bound with measurable per-request economics = EXPLOITED with numbers. |

## Writing your own

Any module with the same contract loads from
`labs/scenarios/` (or any dir via `scenarioDirs`). Full contract in
[`src/scenarios/contract.js`](https://github.com/dhaupin/crashtest/blob/main/src/scenarios/contract.js) —
`name`, `description`, `attacks: [{ name, run(harness, ctx) => one verdict }]`.
