---
permalink: playbooks/run-roots
layout: default
title: Run Roots &amp; Recipes
description: Attack a repo you don't modify — cross-repo run roots, CI artifacts with run --json, and feeding the dashboard.
---

# Run roots & recipes

A **run root** is a directory OUTSIDE the target repo that holds the config,
scenarios, and the ledger. Nothing installs into the repo you're attacking;
everything stays local and offline. This is the pattern the WP spike
formalized (see the [WordPress playbook](/crashtest/playbooks/wordpress))
— and it generalizes to ANY target, JS or PHP.

## 1. The cross-repo run root

```
~/mytarget-crashrun/
├── crashtest.config.js   # the target declaration (points AT the target)
├── scenarios/            # your attack packs for this target (optional)
└── labs/                 # THIS run's ledger + report land here
```

```js
// crashtest.config.js — nothing installs into the target repo
export default {
  baseUrl: 'https://mytarget.sandbox.local',
  adapters: { express: (await import('./target/app.js')).default }, // or routes:, or the wordpress adapter
  scenarioDirs: ['~/mytarget-crashrun/scenarios'],
  seed: 0xC0FFEE,
};
```

```bash
cd ~/mytarget-crashrun
npx crashtest run
# → prints verdicts live; writes labs/hardening.md + labs/crashledger.json
# → exit 0 unless a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression
```

The target repo stays untouched — commit `labs/` from the run root (or a
dedicated baseline repo) instead. Route names the scenario vocabulary needs
(`enroll`, `burst`, …) map onto real paths with `routeAliases` — see
[Configuration](/crashtest/getting-started/config).

## 2. CI recipe: the run blob artifact

`run --json` prints the full machine run blob as the **last stdout line** —
the exact shape the [dashboard](https://crashtest.creadev.org/dashboard)
renders (run shape: `rows[]`, `tally`, `cost`). CI can capture it cheaply:

```yaml
# .github/workflows/ci.yml (alongside the composite gate)
- run: npx crashtest run --json | tee /tmp/full.log | tail -1 > run.json
# the LAST stdout line is the JSON blob; /tmp/full.log keeps the human verdicts
- uses: actions/upload-artifact@v4
  with:
    name: crashtest-run
    path: |
      run.json
      labs/hardening.md
      labs/crashledger.json
```

Then paste `run.json` into the dashboard (or host it and let the dashboard
fetch the raw URL) — the gate banner, module cards, and cost bars render
from the same artifact CI tripped on. One artifact, one truth.

## 3. Where the platform thread lives

The run root + artifact contract is the seed of PRD **§14 — crashtest as a
CI runner** (a greptile-style review lane: hosted run roots, org dashboards,
ledger-bound sign-off UX). The CLI stays the zero-dep drone engine; the
service reads the artifacts, it never becomes a runtime. Read the full
thread in [`labs/prd-crashtest.md`](https://github.com/dhaupin/crashtest/blob/main/labs/prd-crashtest.md) §14.

## Rules that keep run roots honest

- **The target repo owns its baseline.** A run root never overwrites the
  target's `labs/` — diff against a ledger you pass in, never rewrite the
  target's files.
- **Restore what you touch** (the WP spike's cross-repo rule): scenario
  fixtures and shared settings get snapshot + tear-down inside the attack.
- **No sockets, ever** — a run root resolves local paths/imports; if it
  needs the network, it's the wrong shape.
