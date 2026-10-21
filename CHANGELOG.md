# Changelog

Notable changes to the `crashtest` package. The released version lives in
`package.json` + `VERSION` in `src/cli.js` (kept equal by
`test/version.test.js`); releases go out on `vX.Y.Z` git tags via npm
Trusted Publishing (see [docs/publish.md](./docs/publish.md)).

## 1.0.0 (unreleased)

- cve-feed snapshot refresh: 12 -> 27 verified KEV/NVD rows (pack 0.1.1 ->
  0.2.0; one row corrected: CVE-2022-0235 is the node-fetch npm package,
  not a Node.js runtime CVE) plus a boundary fix in
  `kev-version-range-audit` (post-fix releases of a listed major.minor no
  longer false-positive); roundtrip lens file (`test/cve-feed-roundtrip.test.js`)
  pins every snapshot row end to end (snapshot -> token -> route -> verdict).

The pre-1.0 lineage shipped the full QA surface; note this repo's docs
narrated v0.2-v0.4 features (packs, plugins, presets, `--out-dir`) while
`package.json` lagged at 0.1.1 - this release locks the version surfaces to
everything that actually ships.

Core:
- In-process adversarial QA harness: explicit route table, fake
  transport (WHATWG Request/Response, no sockets), fake D1/KV/env, op
  counters and cost meters, seeded RNG determinism.
- Scenario libraries: 30 attacks across 12 modules (auth, authz, guards,
  input, proto-hygiene, recursion, upload, race, state, volume, taxonomy,
  session); two-way vulnerable/hardened proof tests for each verdict.
- Ledger + report pipeline: `labs/crashledger.json` (schema v1) +
  `labs/hardening.md`; exit 1 ONLY on a new EXPLOITED finding or a
  REFUSED-to-EXPLOITED regression; declared-gap rows degrade to
  skipped-REFUSED (zero false positives); BOUNDED requires owner + bound.
- Read-only gates: `run --expect-baseline <ledger>` writes nothing and
  applies the same exit rule; `--out-dir` fans out artifact copies.

Surfaces:
- Framework adapters dispatching in-process: plain handler
  (Pages-Functions shape), hono, express, fastify, raw node
  (`dispatchNodeRequest`), route aliases; WordPress subprocess spike
  (NDJSON stdio, still no sockets).
- Ecosystem: `packs/` (public/local, `packs add` scaffold,
  self-contained bundles via bundled `plugins`), config `plugins:`
  imports, builder presets (`crashtest preset lovable|bolt|replit`),
  `run --module-plan` coverage preview, `crashtest packs` inventory;
  shipped packs: `crashtest-site` (18), `cve-feed` (2, offline KEV/NVD
  snapshot), `wp-money-shapes` (3, armedByKey), `wp-roles` (3,
  experimental), `wp-stock-smoke` (4).

Self-dogfood:
- Attacking fixtures/demo gated in CI against the committed ledger.
- `packs/public/crashtest-site` attacks the shipped website itself
  (real /api/version function, deployed headers, prerendered HTML,
  sitemap, manifest, robots) - its first run caught the real
  registry-shape bug in `web/functions/api/version.js`, fixed with the
  semver/validation floor and pinned by `test/site-pack.test.js`.
- Loader honors the documented "one pack dir only" `packs:` shape;
  WordPress packs degrade honestly on non-WP targets.
