---
permalink: reference/module-plan
layout: default
title: Module Plans
description: The coverage dry-run - which attack ids WOULD fire against your target before any request is made, and what to do about the ones that would not.
---

# Module plans (`run --module-plan`)

A **module plan** answers one question before any request fires: which attack
ids WOULD this target's run carry, and which of those are not actually armed
yet. It attacks nothing, writes nothing, and always exits 0 - it is
informational, never a gate.

```bash
npx crashtest run --module-plan              # human output
npx crashtest run --module-plan --json       # machine plan blob (last stdout line)
```

Plans resolve through the SAME loaders and filter semantics as a real run,
so a plan cannot drift from what a run would actually fire.

## The three statuses

Per module (and inherited by every attack id in it):

| Status | Meaning | What to do |
|---|---|---|
| `WILL-FIRE` | Loads, and its config vocabulary is in place | Nothing - this attack is in the campaign |
| `NEEDS-ARMING` | The module or pack declares `armedByKey` and your `moduleCtx` lacks that key | Set `moduleCtx['<key>']` in `crashtest.config.js` |
| `SKIPPED-FILTER` | The module name is not in the config `modules` filter | Expected if you filtered on purpose |

```console
$ npx crashtest run --module-plan
> wp-money-shapes [pack:public @0.3.0] 3 attack(s) - NEEDS-ARMING: vocabulary rides moduleCtx['wp-money-shapes'] - set it in crashtest.config.js to arm (at run time these attacks REFUSE-skip, never false-positive)
>     wp-money-shapes/nonce-less-volley - NEEDS-ARMING
>     wp-money-shapes/payment-replay - NEEDS-ARMING
>     wp-money-shapes/gate-burst - NEEDS-ARMING
> auth [library] 3 attack(s) - WILL-FIRE
>     auth/identity-spoof-headers - WILL-FIRE
>     auth/secret-watermark - WILL-FIRE
>     auth/privilege-escalation - WILL-FIRE
> plan: 13 attack ids - 10 WILL-FIRE - 3 NEEDS-ARMING - 0 SKIPPED-FILTER
```

## Why NEEDS-ARMING exists

An un-armed pack's attacks REFUSE-skip at run time (skip-parity: never a
false positive). The trouble is a green tally can hide those skips - six
modules report REFUSED, but two of them never fired a request. The plan
surfaces that BEFORE you trust the gate verdict: `NEEDS-ARMING` names the
exact `moduleCtx` key to set, and the pack guides you from there.

## The plan blob (`--json`)

The last stdout line is a machine-plan object:

| Field | Shape |
|---|---|
| `schemaVersion` | `1` |
| `modules[]` | `{ name, origin, source, version, armedKey, status, reason, attacks[] }` |
| `packs[]` | `{ name, visibility, version, origin, attacks, armedByKey, package }` |
| `totals` | `{ attacks, willFire, needsArming, skippedFilter }` |

The dashboard (web/src/lib/ledgerModel.js) renders this shape natively -
paste it in like a run blob or a ledger. Plans get NO gate verdict by
design: they attack nothing, so they never pass or fail CI.

## Where it fits the workflow

1. Adopt a target: `crashtest run --module-plan` first - see the coverage
   and arming gaps before spending a run
2. Arm what needs arming in `crashtest.config.js` (`moduleCtx`)
3. Re-plan until every attack you want is `WILL-FIRE`
4. Run for real: `crashtest run` (see [Quick Start](/crashtest/getting-started/quick-start))
