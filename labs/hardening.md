# Hardening report

> crashtest v0.1.0 · 2026-10-20T02:02:43.135Z · seed 12648430
> CI rule: fail on a NEW EXPLOITED finding, or a REGRESSION of anything previously REFUSED.

## Findings

### 🛡 REFUSED (13)
- auth/identity-spoof-headers: all 54 identity-header spoofs denied or ignored on "admin"
- auth/secret-watermark: 4 routes × 3 error-path probes: no fake secret ever left the env
- auth/privilege-escalation: ownership mutations rejected by "device" (baseline 403)
- guards/hygiene-no-store: "enroll" write responses marked no-store
- guards/burst-wall: no wall under 50-burst on "burst" (0 client errors) — wall presence optional, breakage none
- input/proto-pollution-body: payload to "enroll" did not pollute state (status 400)
- input/never-fail-mutations: 64 hostile bodies all under the floor on "enroll" (seed 3650991062)
- input/oversized-field: oversized body handled on "enroll" (status 400)
- state/enumeration-oracle: no mustDenyIds configured — declare ids the CURRENT identity must never read to arm the oracle
- state/id-collision-alias: owner-b's claim on [alias-48430] by "enroll" stayed separate (status 409; owner-a row intact)
- volume/credential-stuffing: enroll held 60 stuffing attempts (1 admitted, 59 refused) · 121 ops total · ~2.02 ops/request
- volume/storage-fill: route "kvwrite" not declared on this target — fill check skipped (declare a KV-writing route)
- volume/cost-amplification: "enroll" held the amplification bound: 2.02 ops/request over 40 identical replays (bound 12)

### ⚡ EXPLOITED (0)

### 🔒 BOUNDED (0)

## Cost economics
- total: 397 backend ops across 599 in-process requests from 13 attacks
  - auth/identity-spoof-headers: 55 ops · 55 requests
  - auth/secret-watermark: 12 ops · 67 requests
  - auth/privilege-escalation: 4 ops · 71 requests
  - guards/hygiene-no-store: 3 ops · 1 requests
  - guards/burst-wall: 50 ops · 51 requests
  - input/proto-pollution-body: 1 ops · 1 requests
  - input/never-fail-mutations: 64 ops · 65 requests
  - input/oversized-field: 1 ops · 66 requests
  - state/enumeration-oracle: 0 ops · 0 requests
  - state/id-collision-alias: 5 ops · 2 requests
  - volume/credential-stuffing: 121 ops · 60 requests
  - volume/storage-fill: 0 ops · 60 requests
  - volume/cost-amplification: 81 ops · 100 requests

## Baseline diff
- NEW: none · REGRESSED: none
