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
    "generatedAt": "2026-10-21T04:35:37.930Z",
    "findings": [
      {
        "id": "auth/identity-spoof-headers",
        "verdict": "REFUSED",
        "detail": "all 54 identity-header spoofs denied or ignored on \"admin\""
      },
      {
        "id": "auth/secret-watermark",
        "verdict": "REFUSED",
        "detail": "4 routes x 3 error-path probes: no fake secret ever left the env"
      },
      {
        "id": "auth/privilege-escalation",
        "verdict": "REFUSED",
        "detail": "ownership mutations rejected by \"device\" (baseline 403)"
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
      "guards/hygiene-no-store",
      "guards/burst-wall",
      "input/proto-pollution-body",
      "input/never-fail-mutations",
      "input/oversized-field",
      "state/enumeration-oracle",
      "state/id-collision-alias",
      "taxonomy/abuse-not-5xx",
      "taxonomy/errors-stay-impersonal",
      "volume/credential-stuffing",
      "volume/storage-fill",
      "volume/cost-amplification"
    ]
  },
  "cost": {
    "totals": {
      "ops": 420,
      "requests": 629,
      "distinctAttacks": 15
    },
    "perAttack": [
      {
        "id": "auth/identity-spoof-headers",
        "ops": 55,
        "requests": 55
      },
      {
        "id": "auth/secret-watermark",
        "ops": 12,
        "requests": 67
      },
      {
        "id": "auth/privilege-escalation",
        "ops": 4,
        "requests": 71
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
    "startedAt": "2026-10-21T04:35:37.863Z",
    "seed": 12648430
  }
};
