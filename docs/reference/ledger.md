---
permalink: reference/ledger
layout: default
title: The Hardening Ledger
description: labs/crashledger.json and labs/hardening.md — what each record means and how CI uses them.
---

# The Hardening Ledger

Two files carry the memory of a run:

- **`labs/crashledger.json`** — the machine baseline CI gates on
- **`labs/hardening.md`** — the human report reviewers read

## crashledger.json

One record per (module, attack), created on the first green run and updated
on every run after:

```json
{
  "id": "guards/hygiene-no-store",
  "module": "guards",
  "attack": "hygiene-no-store",
  "verdict": "EXPLOITED",
  "detail": "2xx write from \"enroll\" has NO Cache-Control — shared caches may replay the write",
  "evidence": { "route": "enroll" },
  "costDelta": { "route.invoke": 1 },
  "requests": 1
}
```

`verdict` is one of `REFUSED` · `EXPLOITED` · `BOUNDED`. Bounded records carry
`owner` and `bound` — the named owner of a deliberate, explicit risk. A
verdict without its owner/bound pair is a finding by definition.

## hardening.md

The report joins every verdict with its evidence and the run's cost
economics (`total: 271 backend ops across 510 in-process requests …`) plus a
**baseline diff** — `NEW: n` and `REGRESSED: m` lines that are exactly what
CI reads to gate.

## How CI reads the frame

The gate is delta-only: `exit 1` on a NEW exploited finding, or on a
REFUSED→EXPLOITED regression of anything previously held. Old wins can't
quietly rot; new weakness can't slip in labeled "pre-existing."

## Reviewing by verdict, not by count

A tall REFUSED column is good, but the number to care about is 0 next to
EXPLOITED and 0 next to REGRESSED. [Exit rules](/crashtest/reference/exit-rules)
spell out exactly how the process encodes that.
