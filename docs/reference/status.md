---
permalink: reference/status
layout: default
title: Family Status
description: crashtest serves /status.json from its committed ledgers (family-status@1) - the shape, the PASS rule, and how to verify it.
---

# Family Status

Crashtest serves a machine-readable status file at the fixed path
[`/status.json`](https://crashtest.creadev.org/status.json), on the
family-status@1 dialect the struct family agreed on (worked example:
[eyestruct](https://github.com/dhaupin/eyestruct) - served there first,
adoption receipts chronicled in
[the pack reference's family lanes](/crashtest/reference/packs)).

## Where the numbers come from

Nobody hand-types it. The emitter regenerates the file from the repo's own
**committed** ledgers on every web build: the CI web lane runs the emitter
before the site package, so the served dialect can never lag the ledgers it
reports, and `web/public/status.json` is gitignored - a committed copy would
be exactly the stale-snapshot drift the family kills elsewhere.
Run it by hand with:

```bash
node web/scripts/build-status.mjs
```

## The shape

```json
{ "schema": 1, "contract": "family-status@1", "repo": "dhaupin/crashtest",
  "site": "...", "docs": "...", "asOf": "<short HEAD sha or worktree>",
  "legs":  [{ "leg": "crashtest", "verdict": "PASS|RED", "cases": N,
              "counts": {"REFUSED": n}, "ledger": "labs/crashledger.json" }],
  "packs": [{ "name": "<slug>", "spec": "packstruct@1",
              "manifest": "packs/public/<slug>/pack.json", "cases": N }] }
```

Crashtest ships ONE committed ledger with the dogfood campaign, so the legs
array carries the `crashtest` leg only - no leg is claimed for a ledger the
repo does not carry. The packs rows carry each pack's declared attack count,
derived from the pack bank itself; the battery cross-checks that derivation
against the CLI's machine inventory (`crashtest packs --json`), so the two
sources can never disagree silently. The ledgers themselves are documented
in [the hardening ledger](/crashtest/reference/ledger) - regeneration IS the
freshness there too, by law.

## The verdict rule

Additive-first, never a fake pass:

- every case verdict in `{REFUSED, PASSED, BOUNDED}` is a **PASS** - the
  same verdict set the [attack catalog](/crashtest/reference/attacks) and
  the [exit rules](/crashtest/reference/exit-rules) census.
- anything else degrades the leg to **RED**. A `PASSED` row that flips to
  `EXPLOITED` says "the safe path got struck", which is a RED by the same
  rule the ledger already uses.

## The reader rule

The [dashboard's](https://crashtest.creadev.org/dashboard) family island
fetches every sibling's `/status.json` and **refuses on missing or renamed
schema/contract** - a member not serving the dialect yet renders its own
empty "not serving" row, never a guessed number. One bad sibling degrades
only its own row.

## Verify an install

Two pins, every time - `schema === 1` and
`contract === "family-status@1"`, plus `asOf` naming the real HEAD (or
honestly saying `worktree`). Anything else is not the dialect this page
describes.
