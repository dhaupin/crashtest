# DEPLOY.md — install, adopt, publish

> The user path (I. Install, II. Adopt) takes ~10 minutes. Maintainer path
> (III. Publish, IV. Release) is the OIDC release flow this repo runs itself.
> Product overview: [README.md](./README.md). Full docs:
> [docs.creadev.org/crashtest](https://docs.creadev.org/crashtest/). Agent conventions:
> [AGENTS.md](./AGENTS.md). Maintainer token policy notes: [docs/publish.md](./docs/publish.md).

## I. Install

```bash
npm install crashtest        # or: npx crashtest …
crashtest --version          # 0.1.1 at time of writing
```

Every install ships with **signed provenance automatically** (the package is
published from its public GitHub repo via npm Trusted Publishing — verify the
"Provenance" badge on the [npm page](https://www.npmjs.com/package/crashtest)
or the attestation in Sigstore's transparency log). Zero runtime dependencies.

Requirements: Node ≥ 18.17 (any 20/22/24 works; the npm publish flow itself
requires Node ≥ 22.14 / npm ≥ 11.5.1).

## II. Adopt into your project

Crashtest attacks *your repo* from *your repo*. Three steps:

### 1. Scaffold

```bash
npx crashtest init
```
Creates `labs/` with:
- `crashledger.json` — machine ledger (schema v1: findings, acceptedRisks,
  baseline). **Commit it** — this is your CI regression baseline.
- `hardening.md` — human-first report stub that every run overwrites.

### 2. Declare a target — `crashtest.config.js` at your repo root

The target is *your real handler code*, in-process:

```js
import { buildRoutes, ENV_SPEC } from './src/app.js';

export default {
  // Plain handlers — matches the Cloudflare Pages Functions shape:
  // ctx => Response, receiving { request, env, params, data }.
  routes: buildRoutes(),

  // Or any framework that dispatches in-process (all fire without a socket):
  // adapters: {
  //   hono: honoApp,                 // via app.request()
  //   express: expressApp,           // via app.handle(); routes must end their response
  //   fastify: await fastifyApp.ready(), // via app.inject() — routes exist only after ready()
  //   // Raw http.createServer handlers (no framework) via 'node':
  //   //   adapters: { node: { handle: (nodeReq, nodeRes) => myServer._handleRequest(nr, res) } }
  //   // Multi-route servers: import dispatchNodeRequest from 'crashtest/adapters'
  //   //   and declare plain `routes:` entries that rewrite the path onto the
  //   //   real endpoints, then call dispatchNodeRequest(handle, request).
  // },

  // Fake backend mirrors what ctx.env carries — D1 tables (seed rows +
  // uniques), KV namespaces, secrets, vars:
  env: ENV_SPEC,

  // Optional knobs:
  // seed: 0xC0FFEE,              // deterministic runs
  // modules: ['auth', 'input'],  // subset of scenario modules
  // moduleCtx: { input: { route: 'enroll', iterations: 32 } },
  // attackCtx: { 'volume/cost-amplification': { maxOpsPerRequest: 6 } },
  // scenarioDirs: ['test/attacks'],  // extra scenario modules
  // routeAliases: {                // map scenario vocabulary onto real paths
  //   enroll:  { route: 'app', path: '/enroll' },   // of ONE dispatching
  //   device:  { route: 'app', path: '/device' },   // app (raw Node or a
  //   kvwrite: { route: 'app', path: '/enroll' },   // framework adapter)
  // },
```

**Seeding the env** is the security-sensitive part: declare tables with the
rows/uniques your real schema would have (`uniques` drive D1-shaped
`UNIQUE constraint failed: t.col` errors that takeover/aliasing campaigns
chain on), and plant **fake** secrets under `secrets` (e.g. `CRASHTEST_SECRET`)
— the `auth/secret-watermark` probe verifies no response ever leaks them.
Never put real secrets in the config; the harness never needs them because
nothing leaves the process.

**Byo-scenarios:** drop ESM modules into `labs/scenarios/` (or any dir listed
in `scenarioDirs`) — the contract is `{ name, description, attacks:
[{ name, run(harness, ctx) → one verdict record }] }`. An accepted risk
(BOUNDED) requires `owner` + `bound`, or it counts as a finding.

### 3. Run, and cut your baseline

```bash
npx crashtest run
```
Prints every verdict live (`🛡 REFUSED` / `⚡ EXPLOITED` / `🔒 BOUNDED`), writes
`labs/hardening.md` + updates `labs/crashledger.json`, and exits **non-zero
only on a NEW EXPLOITED finding or a REFUSED→EXPLOITED regression** — accepted
risks with owner+bound on file never re-alarm. An exit 1 means the CI rule
tripped: something real got exploited; fix it (or bound it in the ledger),
rerun until green, then commit the updated `labs/` as your baseline.

This repo gate-gates itself the same way — see `crashtest.config.js`,
`fixtures/demo/app.js` (hardened + deliberately-broken draft variants), and
the committed `labs/` baseline.

### 4. CI gate

Use the composite action (currently `dhaupin/crashtest@v0.1.0`; a moving
`v0` major tag is planned — pin as below until then):

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dhaupin/crashtest@v0.1.0
        with:
          config: crashtest.config.js     # default
          run-tests: 'true'               # optional: also run your npm test
```

Same exit semantics; the hardening run is uploaded as an artifact.

## III. Publish (maintainers — one-time setup, then automatic)

The release flow uses **npm Trusted Publishing (OIDC)** — the repo holds
**no publish tokens** (`.github/workflows/publish.yml`, permissions
`id-token: write`).

**One-time (package `crashtest` on npmjs.com → Settings → Trusted Publisher):**
GitHub Actions / owner `dhaupin` / repository `crashtest` / workflow filename
`publish.yml` / direct `npm publish` allowed. ⚠️ Configs created after
2026-09-03 **default to `npm stage publish` only** — leave the direct-publish
switch ON or tag publishes fail with `E404 … you do not have permission`
(exactly how our first release attempt failed; see below).

**Every release after that:**
```bash
# 1) bump the version (two places, keep them equal):
#    package.json "version" + VERSION in src/cli.js
# 2) commit, tag, push:
git tag -a v0.2.0 -m "release notes …"
git push origin main --follow-tags
```
The workflow runs tests, then `npm publish` via OIDC — provenance is signed
and attached automatically. First publish of a NEW package still needs one
session/token-authenticated bootstrap (OIDC cannot create a package):
either `npm publish` once from a logged-in machine, or `npm stage publish`
(name visible instantly; contents released after 2FA approval). The full
runbook with the staged route: [docs/publish.md](./publish.md).

## IV. Troubleshooting (from real run logs)

| Symptom | Cause | Fix |
|---|---|---|
| CI publish: `E404 … crashtest@X — could not be found or you do not have permission` | Trusted Publisher is missing, or is stage-only (the post-2026-09-03 default) | enable **direct `npm publish`** in package settings; confirm owner/repo/workflow-filename fields exactly |
| Integration can't re-run a failed tag workflow (`Resource not accessible by integration`) | GH Apps can't `rerun` others' runs | re-push the tag: `git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z` |
| `crashtest run` exits 2 with "no crashtest.config.js" | honest no-op — a target must be declared | write the config (§II-2); `init` alone doesn't create one |
| express adapter returns a phantom 200 | a route never ended its response | the adapter fails loudly past the drain window ("handler never ended the response") — fix the route; never test it away |
| `git status` shows labs churn after every run | timestamps in the snapshot files | expected; commit only when the *ledger* changed |
| proto-pollution attack returns REFUSED on code you suspect is vulnerable | the handler does a **shallow** copy — shallow assignment can't globally pollute | look for recursive merges; see `fixtures/demo/app.js` for the classic pattern |

## V. House invariants (for anyone touching the pipeline)

- **No sockets.** Attack code, not people (PRD §10) — a scenario that needs a
  network is wrong twice.
- **Determinism:** run twice, expect identical rows; anything time-derived is
  a bug.
- **Registry check before naming** anything (rook lesson: `agent-crashtest`
  shares the niche) — `[check]` always `npm` + GitHub search before picking
  package or org names.

Questions/bugs: [issues](https://github.com/dhaupin/crashtest/issues).
