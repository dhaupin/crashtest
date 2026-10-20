---
permalink: playbooks/github-action
layout: default
title: CI Gate (GitHub Action)
description: One composite step turns the committed hardening ledger into branch enforcement.
---

# CI Gate (GitHub Action)

Crashtest ships as a composite action for other repositories. One step:

```yaml
- uses: dhaupin/crashtest@v0.1.1
  with:
    config: crashtest.config.js   # path, relative to repo root
    run-tests: 'false'            # 'true' also runs npm test before the gate
    node-version: '22'
```

## What it does

1. Installs `crashtest` (no save, no side effects on your lockfile)
2. Optionally runs your own `npm test` first
3. Runs the gate: `npx crashtest run --config <path>`
4. Uploads the run as the `hardening-report` artifact (always)
5. **Exits with the gate result** — your workflow blocks on it

Committed in your repo: `labs/crashledger.json` (from your first — adopted —
run). CI compares against it. Exit `1` means:

- a NEW ⚡ EXPLOITED finding appeared, or
- a previously 🛡 REFUSED surface regressed to EXPLOITED.

Exit `0` reads: nothing new weak, nothing old broke. Exit `2` reads:
configuration is wrong — the workflow should fail too, but visibly.

## Adopting in steps (no-change path)

The gate only bites on **delta**, so a legacy repo can adopt safely:

1. Run locally, review the found weaknesses, fix the cheap ones
2. Where a risk is deliberate, bound it in scenario ctx (BOUNDED needs an
   owner + bound — without both it's a finding)
3. Commit the ledger → CI is now the memory that forgets nothing
