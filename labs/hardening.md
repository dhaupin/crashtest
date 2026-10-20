# Hardening report

> crashtest v0.0.1 · 2026-10-20T01:24:23.582Z · seed 12648430
> CI rule: fail on a NEW EXPLOITED finding, or a REGRESSION of anything previously REFUSED.

## Findings

### 🛡 REFUSED (8)
- auth/identity-spoof-headers: all 54 identity-header spoofs denied or ignored on "admin"
- auth/secret-watermark: 4 routes × 3 error-path probes: no fake secret ever left the env
- auth/privilege-escalation: ownership mutations rejected by "device" (baseline 403)
- guards/hygiene-no-store: "enroll" write responses marked no-store
- guards/burst-wall: no wall under 50-burst on "burst" (0 client errors) — wall presence optional, breakage none
- input/proto-pollution-body: payload to "enroll" did not pollute state (status 400)
- input/never-fail-mutations: 64 hostile bodies all under the floor on "enroll" (seed 3650991062)
- input/oversized-field: oversized body handled on "enroll" (status 400)

### ⚡ EXPLOITED (0)

### 🔒 BOUNDED (0)

## Cost economics
- total: 190 backend ops across 377 in-process requests from 8 attacks
  - auth/identity-spoof-headers: 55 ops · 55 requests
  - auth/secret-watermark: 12 ops · 67 requests
  - auth/privilege-escalation: 4 ops · 71 requests
  - guards/hygiene-no-store: 3 ops · 1 requests
  - guards/burst-wall: 50 ops · 51 requests
  - input/proto-pollution-body: 1 ops · 1 requests
  - input/never-fail-mutations: 64 ops · 65 requests
  - input/oversized-field: 1 ops · 66 requests

## Baseline diff
- NEW: none · REGRESSED: none
