# Hardening report

> crashtest v1.0.0 / 2026-10-21T12:19:32.134Z / seed 12648430
> CI rule: fail on a NEW EXPLOITED finding, or a REGRESSION of anything previously REFUSED.

## Findings

### 🛡 REFUSED (30)
- auth/identity-spoof-headers: all 54 identity-header spoofs denied or ignored on "admin"
- auth/secret-watermark: 12 routes x 3 error-path probes: no fake secret ever left the env
- auth/privilege-escalation: ownership mutations rejected by "device" (baseline 403)
- authz/method-matrix-privileged: 5 methods (bare + bodies where the method carries one) all denied on "admin" - the gate is method-blind
- authz/role-body-spoof-family: 8 role-word claims x 3 methods all denied on "admin" - identity lives in the request the server derives, not in the body the attacker owns
- authz/handler-alias-confusion: alias "dev-check" denies identically to "admin" - no unauthenticated grant, no identity-header trapdoor (3 spoof vectors probed)
- guards/hygiene-no-store: "enroll" write responses marked no-store
- guards/burst-wall: no wall under 50-burst on "burst" (0 client errors) - wall presence optional, breakage none
- input/proto-pollution-body: payload to "enroll" did not pollute state (status 400)
- input/never-fail-mutations: 64 hostile bodies all under the floor on "enroll" (seed 3650991062)
- input/oversized-field: oversized body handled on "enroll" (status 400)
- proto-hygiene/head-get-parity: 12 route(s): HEAD mirrors GET (no throws, no status drift beyond honest 405) + 11 info note(s)
- proto-hygiene/request-shape-flood: 12 route(s) x 18 bare shapes (query chaos, path shapes, header casings) all landed 4xx-or-cleaner with case-parity intact
- race/double-submit-idempotency: 3-way same-key burst on "charge" landed exactly one acknowledged effect + 2 honest 409(s); the store held 1 row(s)
- race/concurrent-write-lost-update: concurrent field-split pair both landed on "profile" - all four submitted fields present in the store; no silent stomp
- recursion/deep-nest-stack-overflow: deep-nested body (12000 levels) answered honestly on "enroll" (400) - a depth guard or flat processing refused it
- recursion/redos-catastrophic-pattern: 2 evil/benign backtracking pairs walked linearly through "validate" - no self-relative ratio crossed the bucket
- session/cookie-hygiene: login cookie on "login" carries the full hygiene set: Secure + HttpOnly + SameSite policy
- session/session-fixation: session rotation + forged-id rejection hold on "login"/"me" (two distinct sids, forged sid denied with 401)
- session/token-replay-deny: 4 logins across 3 accounts minted pairwise-distinct sids on "login" - no token is ever re-issued, so expired-and-known tokens cannot replay
- session/logout-invalidates: logout invalidation holds on "logout" - me() with the logged-out sid denies (status 401)
- state/enumeration-oracle: no mustDenyIds configured - declare ids the CURRENT identity must never read to arm the oracle
- state/id-collision-alias: owner-b's claim on [alias-48430] by "enroll" stayed separate (status 409; owner-a row intact)
- taxonomy/abuse-not-5xx: 10 abuse shapes answered honestly on "enroll" (statuses: 400/201)
- taxonomy/errors-stay-impersonal: 10 abuse shapes answered impersonally on "enroll" - no canary echo, no stack frames
- upload/filename-traversal-family: 9 hostile filename shapes through "upload" left nothing but safe basenames (or honest 4xx refusals) in "UPLOADS"
- upload/mime-polyglot-family: 2 polyglot shapes (svg+script, text/html) refused honestly through "upload" - an allow-list discipline holds
- volume/credential-stuffing: enroll held 60 stuffing attempts (1 admitted, 59 refused) / 121 ops total / ~2.02 ops/request
- volume/storage-fill: route "kvwrite" not declared on this target - fill check skipped (declare a KV-writing route)
- volume/cost-amplification: "enroll" held the amplification bound: 2.02 ops/request over 40 identical replays (bound 12)

### ⚡ EXPLOITED (0)

### 🔒 BOUNDED (0)

## Cost economics
- total: 842 backend ops across 1082 in-process requests from 30 attacks
  - auth/identity-spoof-headers: 55 ops / 55 requests
  - auth/secret-watermark: 36 ops / 91 requests
  - auth/privilege-escalation: 4 ops / 95 requests
  - authz/method-matrix-privileged: 9 ops / 9 requests
  - authz/role-body-spoof-family: 24 ops / 33 requests
  - authz/handler-alias-confusion: 8 ops / 41 requests
  - guards/hygiene-no-store: 3 ops / 1 requests
  - guards/burst-wall: 50 ops / 51 requests
  - input/proto-pollution-body: 1 ops / 1 requests
  - input/never-fail-mutations: 64 ops / 65 requests
  - input/oversized-field: 1 ops / 66 requests
  - proto-hygiene/head-get-parity: 24 ops / 24 requests
  - proto-hygiene/request-shape-flood: 216 ops / 240 requests
  - race/double-submit-idempotency: 9 ops / 3 requests
  - race/concurrent-write-lost-update: 20 ops / 5 requests
  - recursion/deep-nest-stack-overflow: 1 ops / 1 requests
  - recursion/redos-catastrophic-pattern: 4 ops / 5 requests
  - session/cookie-hygiene: 7 ops / 1 requests
  - session/session-fixation: 16 ops / 4 requests
  - session/token-replay-deny: 28 ops / 8 requests
  - session/logout-invalidates: 12 ops / 11 requests
  - state/enumeration-oracle: 0 ops / 0 requests
  - state/id-collision-alias: 5 ops / 2 requests
  - taxonomy/abuse-not-5xx: 12 ops / 10 requests
  - taxonomy/errors-stay-impersonal: 11 ops / 20 requests
  - upload/filename-traversal-family: 18 ops / 9 requests
  - upload/mime-polyglot-family: 2 ops / 11 requests
  - volume/credential-stuffing: 121 ops / 60 requests
  - volume/storage-fill: 0 ops / 60 requests
  - volume/cost-amplification: 81 ops / 100 requests

## Baseline diff
- NEW: none / REGRESSED: none
