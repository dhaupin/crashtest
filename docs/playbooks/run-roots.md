---
permalink: playbooks/run-roots
layout: default
title: Run Roots &amp; Recipes
description: Attack a repo you don't modify - cross-repo run roots, CI artifacts with run --json, and feeding the dashboard.
---

# Run roots & recipes

A **run root** is a directory OUTSIDE the target repo that holds the config,
scenarios, and the ledger. Nothing installs into the repo you're attacking;
everything stays local and offline. This is the pattern the WP spike
formalized (see the [WordPress playbook](/crashtest/playbooks/wordpress))
- and it generalizes to ANY target, JS or PHP.

## 1. The cross-repo run root

```text
~/mytarget-crashrun/
+-- crashtest.config.js   # the target declaration (points AT the target)
+-- scenarios/            # your attack packs for this target (optional)
`-- labs/                 # THIS run's ledger + report land here
```

The config that runs the whole run root (nothing installs into the target
repo - the config lives in the run root and imports the target by path):

```js
// crashtest.config.js - nothing installs into the target repo
export default {
  baseUrl: 'https://mytarget.sandbox.local',
  adapters: { express: (await import('./target/app.js')).default }, // or routes:, or the wordpress adapter
  scenarioDirs: ['~/mytarget-crashrun/scenarios'],
  seed: 0xC0FFEE,
};
```

Then run the attack from the run root itself:

```bash
cd ~/mytarget-crashrun
npx crashtest run
# -> prints verdicts live; writes labs/hardening.md + labs/crashledger.json
# -> exit 0 unless a NEW EXPLOITED finding or a REFUSED->EXPLOITED regression
```

The target repo stays untouched - commit `labs/` from the run root (or a
dedicated baseline repo) instead. Route names the scenario vocabulary needs
(`enroll`, `burst`, ...) map onto real paths with `routeAliases` - see
[Configuration](/crashtest/getting-started/config).

## 2. Framework adapter recipe: raw-node servers (van-style)

Vant-style undecorated `http.createServer` handlers mount in-process via the
`node` adapter - no socket, no changes to the target repo:

```js
// run-root crashtest.config.js
import { createRequire } from 'node:module';
const vantReq = createRequire('/path/to/vant/package.json');
const { Server } = vantReq('./lib/server.js');
const server = new Server({ port: 3456 }); // only the handler - never .listen()
export default {
  adapters: { node: { name: 'app', handle: (req, res) => server._handleRequest(req, res) } },
  routeAliases: {   // the seeded-library vocabulary rides real endpoints
    enroll: { route: 'app', path: '/call' }, admin: { route: 'app', path: '/call' },
    burst:  { route: 'app', path: '/call' }, kvwrite: { route: 'app', path: '/call' },
  },
  seed: 0xC0FFEE,
};
```

A real run of exactly this shape against the vant Server (its VAF -> QoS ->
auth chain in-process) held 13/13 REFUSED - burst walls carried
`Retry-After` on all 50 throttles, oversized bodies got honest 413s, and
credential stuffing was refused 60/60. Note: `name` in the node spec is
required (the registry's options-shape heuristic keys on it).

Express/hono/fastify targets swap the one adapter line - same shape as the
[per-framework playbooks](/crashtest/playbooks/); nothing about the pack or
the ledger changes.

## 3. CI recipe: the run blob artifact

`run --json` prints the full machine run blob as the **last stdout line** -
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
fetch the raw URL) - the gate banner, module cards, and cost bars render
from the same artifact CI tripped on. One artifact, one truth.

For service-style targets the artifact capture is built into the runner:
`crashtest run --out-dir <dir>` writes `run-blob.json`, `crashledger.json`,
and `hardening.md` copies into a distinct directory (the target repo's
`labs/` stays untouched at the repo root; the flag refuses the repo root
itself). Same gate artifacts, no `tee`/`tail` plumbing - pick the one that
fits the job: `--json` when stdout is the transport, `--out-dir` when a
directory of artifacts is.

## 4. Where the platform thread lives

The run root + artifact contract is the seed of PRD **section 14 - crashtest as a
CI runner** (a greptile-style review lane: hosted run roots, org dashboards,
ledger-bound sign-off UX). The CLI stays the zero-dep drone engine; the
service reads the artifacts, it never becomes a runtime. Read the full
thread in [`labs/prd-crashtest.md`](https://github.com/dhaupin/crashtest/blob/main/labs/prd-crashtest.md) section 14.

## Rules that keep run roots honest

- **The target repo owns its baseline.** A run root never overwrites the
  target's `labs/` - diff against a ledger you pass in, never rewrite the
  target's files.
- **Restore what you touch** (the WP spike's cross-repo rule): scenario
  fixtures and shared settings get snapshot + tear-down inside the attack.
- **No sockets, ever** - a run root resolves local paths/imports; if it
  needs the network, it's the wrong shape.
