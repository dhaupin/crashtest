---
permalink: reference/exit-rules
layout: default
title: Exit Rules
description: 0 holds, 1 finding, 2 config - and why baselines only bite on delta.
---

# Exit Rules

The exit contract is the CI interface. Three values, exactly:

| Exit | Reads as | CI behavior |
|---|---|---|
| **0** | Nothing new weak, nothing old broke | Pass |
| **1** | A NEW 🛡→⚡ change: either a fresh EXPLOITED finding, or a previously-REFUSED surface that regressed | Fail the PR |
| **2** | Configuration problem (missing/bad config, unreachable handlers table) | Fail loudly and visibly - it's a real gap in adoption, not a "skip" |

## The delta principle

Your committed `labs/crashledger.json` is the *baseline*, not the goal. CI
compares the fresh run against it:

- **NEW** - a weakness found for the first time. Even if your app had it for
  years, the ledger is where every weakness first enters recorded history.
- **REGRESSED** - something previously REFUSED that now EXPLOITEDs. Old wins
  can't quietly rot.
- **Undeclared routes degrade to skipped-REFUSED** (`skipped: true` - the run
  tells you what to declare for coverage). They never count as findings.

## Read-only diffs: `run --expect-baseline <path>`

By default `crashtest run` rewrites `labs/crashledger.json` +
`labs/hardening.md` (that's how you *cut* a baseline). In CI/hosted lanes the
runner must be able to attack a repo it has no write access to:

```bash
crashtest run --config ../mytarget/crashtest.config.js \
              --expect-baseline ../mytarget/labs/crashledger.json
```

- Diffs the fresh run against the ledger you hand it. Same exit table as
  above, unchanged.
- Writes **nothing**: no `labs/` touches, no ledger churn, no report. The
  caller owns the baseline.
- A missing or non-schema-1 baseline file is honest exit 2 ("the run could
  not be trusted", same bucket as a missing config).
- `run --json` still prints the run blob as the last stdout line - the diff
  verdict lives in the same artifact the dashboard renders.

## Why config errors exit 2, not 1

`session: config file missing - exit 2` - the distinction matters:
harness-wide faults report as findings on the *attack* level (loudly, with
cause), but a misconfigured repo is not evidence about your code. It's
evidence about the run. Exit-2 keeps "your app is weak" semantically very far
from "the run could not be trusted."

## Bounded verdicts

🔒 BOUNDED = "deliberate risk, named owner, explicit bound." Without the
owner/bound pair, the runner demotes it to EXPLOITED and surfaces the reason -
an accepted risk with no accountability matrix is a finding (PRD principle 6).

## Same commit → same findings

The seeded RNG and in-process transport make every run deterministic: gone
is the flaky security suite. One surface cherry-ticks once, then holds its
verdict across your CI forever.
