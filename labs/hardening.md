# Hardening report

> crashtest v1.2.0 / seed 12648430
> cut stamp: labs/run-meta.json (wall clock, deliberately outside this file).
> CI rule: fail on a NEW EXPLOITED finding, or a REGRESSION of anything previously REFUSED.

## Findings

### 🛡 REFUSED (49)
- auth/identity-spoof-headers: all 54 identity-header spoofs denied or ignored on "admin"
- auth/secret-watermark: 12 routes x 3 error-path probes: no fake secret ever left the env
- auth/privilege-escalation: ownership mutations rejected by "device" (baseline 403)
- authz/method-matrix-privileged: 5 methods (bare + bodies where the method carries one) all denied on "admin" - the gate is method-blind
- authz/role-body-spoof-family: 8 role-word claims x 3 methods all denied on "admin" - identity lives in the request the server derives, not in the body the attacker owns
- authz/handler-alias-confusion: alias "dev-check" denies identically to "admin" - no unauthenticated grant, no identity-header trapdoor (3 spoof vectors probed)
- governance/succession-trust-floor: vocabulary knob(s) "grantsRoute", "resolveRoute" not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage) (skipped)
- governance/succession-single-heir: vocabulary knob(s) "grantsRoute", "resolveRoute" not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage) (skipped)
- governance/succession-revocation-carry: vocabulary knob(s) "grantsRoute", "resolveRoute" not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage) (skipped)
- governance/escrow-two-key-release: vocabulary knob(s) "escrowRoute" not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage) (skipped)
- governance/escrow-expiry-is-fail-closed: vocabulary knob(s) "escrowRoute" not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage) (skipped)
- governance/escrow-refusal-is-typed: vocabulary knob(s) "escrowRoute" not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage) (skipped)
- governance/grant-conflict-deterministic: vocabulary knob(s) "grantsRoute", "resolveRoute" not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage) (skipped)
- governance/capability-no-sideways: vocabulary knob(s) "grantsRoute", "resolveRoute" not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage) (skipped)
- governance/lock-ttl-honesty: governance knob(s) "locksRoute", "ttlMode" not declared on this target - lock-ttl-honesty skipped (declare locksRoute + the DOCUMENTED ttlMode for coverage) (skipped)
- governance/lock-owner-fencing: governance knob(s) "locksRoute", "staleToken" not declared on this target - fencing skipped (declare locksRoute + staleToken for coverage) (skipped)
- guards/hygiene-no-store: "enroll" write responses marked no-store
- guards/burst-wall: no wall under 50-burst on "burst" (0 client errors) - wall presence optional, breakage none
- input/proto-pollution-body: payload to "enroll" did not pollute state (status 400)
- input/never-fail-mutations: 64 hostile bodies all under the floor on "enroll" (seed 3650991062)
- input/oversized-field: oversized body handled on "enroll" (status 400)
- memory/drift-silent-overwrite: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/drift-stale-poisons-fresh: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/drift-contradiction-carry: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/hallucinated-fact-probe: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/citation-drift: vocabulary knob(s) "writeRoute", "readRoute", "deleteRoute" not declared on this target - citation drift skipped (export moduleCtx['memory'].writeRoute/readRoute/deleteRoute for coverage) (skipped)
- memory/phantom-scope: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/identity-merge-collision: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/resolution-order-stability: vocabulary knob(s) "writeRoute", "readRoute" not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage) (skipped)
- memory/delete-is-loud: vocabulary knob(s) "writeRoute", "readRoute", "deleteRoute" not declared on this target - delete skip (export moduleCtx['memory'].writeRoute/readRoute/deleteRoute for coverage) (skipped)
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
- volume/storage-fill: route "kvwrite" not declared on this target - fill check skipped (declare a KV-writing route) (skipped)
- volume/cost-amplification: "enroll" held the amplification bound: 2.02 ops/request over 40 identical replays (bound 12)

### ⚡ EXPLOITED (0)

### 🔒 BOUNDED (0)

## Cost economics
- total: 842 backend ops across 647 in-process requests from 49 attacks
  - auth/identity-spoof-headers: 55 ops / 55 requests
  - auth/secret-watermark: 36 ops / 36 requests
  - auth/privilege-escalation: 4 ops / 4 requests
  - authz/method-matrix-privileged: 9 ops / 9 requests
  - authz/role-body-spoof-family: 24 ops / 24 requests
  - authz/handler-alias-confusion: 8 ops / 8 requests
  - governance/succession-trust-floor: 0 ops / 0 requests
  - governance/succession-single-heir: 0 ops / 0 requests
  - governance/succession-revocation-carry: 0 ops / 0 requests
  - governance/escrow-two-key-release: 0 ops / 0 requests
  - governance/escrow-expiry-is-fail-closed: 0 ops / 0 requests
  - governance/escrow-refusal-is-typed: 0 ops / 0 requests
  - governance/grant-conflict-deterministic: 0 ops / 0 requests
  - governance/capability-no-sideways: 0 ops / 0 requests
  - governance/lock-ttl-honesty: 0 ops / 0 requests
  - governance/lock-owner-fencing: 0 ops / 0 requests
  - guards/hygiene-no-store: 3 ops / 1 requests
  - guards/burst-wall: 50 ops / 50 requests
  - input/proto-pollution-body: 1 ops / 1 requests
  - input/never-fail-mutations: 64 ops / 64 requests
  - input/oversized-field: 1 ops / 1 requests
  - memory/drift-silent-overwrite: 0 ops / 0 requests
  - memory/drift-stale-poisons-fresh: 0 ops / 0 requests
  - memory/drift-contradiction-carry: 0 ops / 0 requests
  - memory/hallucinated-fact-probe: 0 ops / 0 requests
  - memory/citation-drift: 0 ops / 0 requests
  - memory/phantom-scope: 0 ops / 0 requests
  - memory/identity-merge-collision: 0 ops / 0 requests
  - memory/resolution-order-stability: 0 ops / 0 requests
  - memory/delete-is-loud: 0 ops / 0 requests
  - proto-hygiene/head-get-parity: 24 ops / 24 requests
  - proto-hygiene/request-shape-flood: 216 ops / 216 requests
  - race/double-submit-idempotency: 9 ops / 3 requests
  - race/concurrent-write-lost-update: 20 ops / 2 requests
  - recursion/deep-nest-stack-overflow: 1 ops / 1 requests
  - recursion/redos-catastrophic-pattern: 4 ops / 4 requests
  - session/cookie-hygiene: 7 ops / 1 requests
  - session/session-fixation: 16 ops / 3 requests
  - session/token-replay-deny: 28 ops / 4 requests
  - session/logout-invalidates: 12 ops / 3 requests
  - state/enumeration-oracle: 0 ops / 0 requests
  - state/id-collision-alias: 5 ops / 2 requests
  - taxonomy/abuse-not-5xx: 12 ops / 10 requests
  - taxonomy/errors-stay-impersonal: 11 ops / 10 requests
  - upload/filename-traversal-family: 18 ops / 9 requests
  - upload/mime-polyglot-family: 2 ops / 2 requests
  - volume/credential-stuffing: 121 ops / 60 requests
  - volume/storage-fill: 0 ops / 0 requests
  - volume/cost-amplification: 81 ops / 40 requests

## Baseline diff
- NEW: none / REGRESSED: none
