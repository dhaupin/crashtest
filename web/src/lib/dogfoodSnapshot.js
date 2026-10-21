/**
 * src/lib/dogfoodSnapshot.js - GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Snapshot of crashtest's own dogfood run, produced by
 * `node web/scripts/make-ledger-snapshot.mjs` from the committed artifacts:
 *   labs/crashledger.json (the ledger) + labs/hardening.md (cost economics).
 * Re-run the generator after a dogfood run changes labs/, then commit.
 *
 * The dashboard renders this snapshot as its default, honest view:
 * a real ledger cut v1.0.0 - not demo data hand-typed for the page.
 */

export const dogfood = {
  "ledger": {
    "schemaVersion": 1,
    "generatedAt": "2026-10-21T07:19:02.073Z",
    "findings": [
      {
        "id": "auth/identity-spoof-headers",
        "verdict": "REFUSED",
        "detail": "all 54 identity-header spoofs denied or ignored on \"admin\""
      },
      {
        "id": "auth/secret-watermark",
        "verdict": "REFUSED",
        "detail": "12 routes x 3 error-path probes: no fake secret ever left the env"
      },
      {
        "id": "auth/privilege-escalation",
        "verdict": "REFUSED",
        "detail": "ownership mutations rejected by \"device\" (baseline 403)"
      },
      {
        "id": "authz/method-matrix-privileged",
        "verdict": "REFUSED",
        "detail": "5 methods (bare + bodies where the method carries one) all denied on \"admin\" - the gate is method-blind"
      },
      {
        "id": "authz/role-body-spoof-family",
        "verdict": "REFUSED",
        "detail": "8 role-word claims x 3 methods all denied on \"admin\" - identity lives in the request the server derives, not in the body the attacker owns"
      },
      {
        "id": "authz/handler-alias-confusion",
        "verdict": "REFUSED",
        "detail": "alias \"dev-check\" denies identically to \"admin\" - no unauthenticated grant, no identity-header trapdoor (3 spoof vectors probed)"
      },
      {
        "id": "guards/hygiene-no-store",
        "verdict": "REFUSED",
        "detail": "\"enroll\" write responses marked no-store"
      },
      {
        "id": "guards/burst-wall",
        "verdict": "REFUSED",
        "detail": "no wall under 50-burst on \"burst\" (0 client errors) - wall presence optional, breakage none"
      },
      {
        "id": "input/proto-pollution-body",
        "verdict": "REFUSED",
        "detail": "payload to \"enroll\" did not pollute state (status 400)"
      },
      {
        "id": "input/never-fail-mutations",
        "verdict": "REFUSED",
        "detail": "64 hostile bodies all under the floor on \"enroll\" (seed 3650991062)"
      },
      {
        "id": "input/oversized-field",
        "verdict": "REFUSED",
        "detail": "oversized body handled on \"enroll\" (status 400)"
      },
      {
        "id": "proto-hygiene/head-get-parity",
        "verdict": "REFUSED",
        "detail": "12 route(s): HEAD mirrors GET (no throws, no status drift beyond honest 405) + 11 info note(s)"
      },
      {
        "id": "proto-hygiene/request-shape-flood",
        "verdict": "REFUSED",
        "detail": "12 route(s) x 18 bare shapes (query chaos, path shapes, header casings) all landed 4xx-or-cleaner with case-parity intact"
      },
      {
        "id": "race/double-submit-idempotency",
        "verdict": "REFUSED",
        "detail": "3-way same-key burst on \"charge\" landed exactly one acknowledged effect + 2 honest 409(s); the store held 1 row(s)"
      },
      {
        "id": "race/concurrent-write-lost-update",
        "verdict": "REFUSED",
        "detail": "concurrent field-split pair both landed on \"profile\" - all four submitted fields present in the store; no silent stomp"
      },
      {
        "id": "recursion/deep-nest-stack-overflow",
        "verdict": "REFUSED",
        "detail": "deep-nested body (12000 levels) answered honestly on \"enroll\" (400) - a depth guard or flat processing refused it"
      },
      {
        "id": "recursion/redos-catastrophic-pattern",
        "verdict": "REFUSED",
        "detail": "2 evil/benign backtracking pairs walked linearly through \"validate\" - no self-relative ratio crossed the bucket"
      },
      {
        "id": "session/cookie-hygiene",
        "verdict": "REFUSED",
        "detail": "login cookie on \"login\" carries the full hygiene set: Secure + HttpOnly + SameSite policy"
      },
      {
        "id": "session/session-fixation",
        "verdict": "REFUSED",
        "detail": "session rotation + forged-id rejection hold on \"login\"/\"me\" (two distinct sids, forged sid denied with 401)"
      },
      {
        "id": "session/logout-invalidates",
        "verdict": "REFUSED",
        "detail": "logout invalidation holds on \"logout\" - me() with the logged-out sid denies (status 401)"
      },
      {
        "id": "state/enumeration-oracle",
        "verdict": "REFUSED",
        "detail": "no mustDenyIds configured - declare ids the CURRENT identity must never read to arm the oracle"
      },
      {
        "id": "state/id-collision-alias",
        "verdict": "REFUSED",
        "detail": "owner-b's claim on [alias-48430] by \"enroll\" stayed separate (status 409; owner-a row intact)"
      },
      {
        "id": "taxonomy/abuse-not-5xx",
        "verdict": "REFUSED",
        "detail": "10 abuse shapes answered honestly on \"enroll\" (statuses: 400/201)"
      },
      {
        "id": "taxonomy/errors-stay-impersonal",
        "verdict": "REFUSED",
        "detail": "10 abuse shapes answered impersonally on \"enroll\" - no canary echo, no stack frames"
      },
      {
        "id": "upload/filename-traversal-family",
        "verdict": "REFUSED",
        "detail": "9 hostile filename shapes through \"upload\" left nothing but safe basenames (or honest 4xx refusals) in \"UPLOADS\""
      },
      {
        "id": "upload/mime-polyglot-family",
        "verdict": "REFUSED",
        "detail": "2 polyglot shapes (svg+script, text/html) refused honestly through \"upload\" - an allow-list discipline holds"
      },
      {
        "id": "volume/credential-stuffing",
        "verdict": "REFUSED",
        "detail": "enroll held 60 stuffing attempts (1 admitted, 59 refused) / 121 ops total / ~2.02 ops/request"
      },
      {
        "id": "volume/storage-fill",
        "verdict": "REFUSED",
        "detail": "route \"kvwrite\" not declared on this target - fill check skipped (declare a KV-writing route)"
      },
      {
        "id": "volume/cost-amplification",
        "verdict": "REFUSED",
        "detail": "\"enroll\" held the amplification bound: 2.02 ops/request over 40 identical replays (bound 12)",
        "bound": 12
      }
    ],
    "acceptedRisks": [],
    "baseline": [
      "auth/identity-spoof-headers",
      "auth/secret-watermark",
      "auth/privilege-escalation",
      "authz/method-matrix-privileged",
      "authz/role-body-spoof-family",
      "authz/handler-alias-confusion",
      "guards/hygiene-no-store",
      "guards/burst-wall",
      "input/proto-pollution-body",
      "input/never-fail-mutations",
      "input/oversized-field",
      "proto-hygiene/head-get-parity",
      "proto-hygiene/request-shape-flood",
      "race/double-submit-idempotency",
      "race/concurrent-write-lost-update",
      "recursion/deep-nest-stack-overflow",
      "recursion/redos-catastrophic-pattern",
      "session/cookie-hygiene",
      "session/session-fixation",
      "session/logout-invalidates",
      "state/enumeration-oracle",
      "state/id-collision-alias",
      "taxonomy/abuse-not-5xx",
      "taxonomy/errors-stay-impersonal",
      "upload/filename-traversal-family",
      "upload/mime-polyglot-family",
      "volume/credential-stuffing",
      "volume/storage-fill",
      "volume/cost-amplification"
    ]
  },
  "cost": {
    "totals": {
      "ops": 814,
      "requests": 1070,
      "distinctAttacks": 29
    },
    "perAttack": [
      {
        "id": "auth/identity-spoof-headers",
        "ops": 55,
        "requests": 55
      },
      {
        "id": "auth/secret-watermark",
        "ops": 36,
        "requests": 91
      },
      {
        "id": "auth/privilege-escalation",
        "ops": 4,
        "requests": 95
      },
      {
        "id": "authz/method-matrix-privileged",
        "ops": 9,
        "requests": 9
      },
      {
        "id": "authz/role-body-spoof-family",
        "ops": 24,
        "requests": 33
      },
      {
        "id": "authz/handler-alias-confusion",
        "ops": 8,
        "requests": 41
      },
      {
        "id": "guards/hygiene-no-store",
        "ops": 3,
        "requests": 1
      },
      {
        "id": "guards/burst-wall",
        "ops": 50,
        "requests": 51
      },
      {
        "id": "input/proto-pollution-body",
        "ops": 1,
        "requests": 1
      },
      {
        "id": "input/never-fail-mutations",
        "ops": 64,
        "requests": 65
      },
      {
        "id": "input/oversized-field",
        "ops": 1,
        "requests": 66
      },
      {
        "id": "proto-hygiene/head-get-parity",
        "ops": 24,
        "requests": 24
      },
      {
        "id": "proto-hygiene/request-shape-flood",
        "ops": 216,
        "requests": 240
      },
      {
        "id": "race/double-submit-idempotency",
        "ops": 9,
        "requests": 3
      },
      {
        "id": "race/concurrent-write-lost-update",
        "ops": 20,
        "requests": 5
      },
      {
        "id": "recursion/deep-nest-stack-overflow",
        "ops": 1,
        "requests": 1
      },
      {
        "id": "recursion/redos-catastrophic-pattern",
        "ops": 4,
        "requests": 5
      },
      {
        "id": "session/cookie-hygiene",
        "ops": 7,
        "requests": 1
      },
      {
        "id": "session/session-fixation",
        "ops": 16,
        "requests": 4
      },
      {
        "id": "session/logout-invalidates",
        "ops": 12,
        "requests": 7
      },
      {
        "id": "state/enumeration-oracle",
        "ops": 0,
        "requests": 0
      },
      {
        "id": "state/id-collision-alias",
        "ops": 5,
        "requests": 2
      },
      {
        "id": "taxonomy/abuse-not-5xx",
        "ops": 12,
        "requests": 10
      },
      {
        "id": "taxonomy/errors-stay-impersonal",
        "ops": 11,
        "requests": 20
      },
      {
        "id": "upload/filename-traversal-family",
        "ops": 18,
        "requests": 9
      },
      {
        "id": "upload/mime-polyglot-family",
        "ops": 2,
        "requests": 11
      },
      {
        "id": "volume/credential-stuffing",
        "ops": 121,
        "requests": 60
      },
      {
        "id": "volume/storage-fill",
        "ops": 0,
        "requests": 60
      },
      {
        "id": "volume/cost-amplification",
        "ops": 81,
        "requests": 100
      }
    ]
  },
  "meta": {
    "version": "1.0.0",
    "startedAt": "2026-10-21T07:19:01.960Z",
    "seed": 12648430
  }
};
