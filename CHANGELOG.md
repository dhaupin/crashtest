# Changelog

Notable changes to the `crashtest` package. The released version lives in
`package.json` + `VERSION` in `src/cli.js` (kept equal by
`test/version.test.js`); releases go out on `vX.Y.Z` git tags via npm
Trusted Publishing (see [docs/publish.md](./docs/publish.md)).

## 1.0.1 (unreleased)

- faked1 v0.3 + fakekv v0.2 (issue #9, the ranked breadth gap list the
  vant census measured):
  - SQL: `IN (SELECT ...)` subqueries (depth one, exactly one projection
    column, subquery `?`s rebind against the surrounding statement's
    textual order), one-key INNER/LEFT/CROSS JOINs (table-qualified or
    bare shared-key ON; RIGHT JOIN stays a loud rewrite hint),
    GROUP BY/HAVING (plain column group keys; bare-aggregate HAVING stays
    a named gap), aggregates scoped per-group with the bare columns of
    the group's first row, multi-key ORDER BY (projection aliases +
    group-key columns + raw refs), FROM-less scalar SELECT, and scalar
    functions (UPPER/LOWER/LENGTH/TRIM/ABS). `CREATE TABLE [IF NOT
    EXISTS]` / `ALTER TABLE ADD COLUMN` (the ensureSchema pattern -
    declared UNIQUE column flags feed the standard constraint reading,
    DEFAULT backfills existing rows, NOT NULL without DEFAULT stays
    loud). The v0.2 relay contracts (UNIQUE message shape, meta shape,
    counters, batch partial-apply, `count` key for unaliased COUNT(*))
    carry over untouched in d1-v02.test.js.
  - fake-clock date functions: UNIXEPOCH/DATETIME/JULIANDAY/STRFTIME read
    ONE fixed epoch (FAKE_CLOCK_EPOCH; 'now' = that constant) - the v1.0
    determinism law holds: same seed, same rows, no Date.now anywhere.
    Day/hour/minute/second/week modifiers compose; month/year stay named
    gaps. JSON: JSON_EXTRACT (paths degrade to NULL), JSON_TYPE,
    JSON_QUOTE; double-quoted string literals now tokenize.
  - FakeKV: deterministic TTLs (expiration/expirationTtl against the same
    fixed clock; expired keys read as NOT PRESENT and vanish from
    listings), getWithMetadata (metadata + expiration parity), and honest
    cursor pagination (real name-position cursor, list_complete only when
    true) + a loud per-value size cap (Workers-KV 25 MiB default).
  Teeth: test/harness/d1-v03.test.js + test/harness/kv-v02.test.js.
- the snapshot-diff oracle (issue #13 crate-tooling blocker 2):
  `harness.snapshotStore()` copies every fake binding's state
  (FakeD1.snapshot() per binding + the new FakeKV.snapshot()) and
  `harness.diffSnapshots(before, after)` returns the deterministic diff -
  D1 rows match by `id` (structural fallback: equal rows cancel, residue
  added/removed), KV maps by key, table maps added/removed wholesale.
  Rows carry {added, removed, changed + differing field names}, all
  sorted, all copies - same inputs twice, byte-identical, so a diff rides
  evidence without breaking the byte-stability law. Snapshots tick no
  counters (attack bookkeeping, not campaign ops); a binding changing
  shape between captures (d1<->kv) fails loudly as an oracle bug. This is
  the uniform shape replacing the pack-by-pack hand-rolled store diffs
  (vant measured at least four); docs in reference/scenario-contract.md.
  Teeth: test/harness/diff.test.js.
- the determinism linter (issue #13 crate-tooling blocker 3):
  `crashtest lint-determinism [--config <path>] [dirs...]` greps the
  DECLARED user surfaces (config scenarioDirs + packs roots by default;
  explicit dirs override; `packs: false` opts out) for the wall-clock /
  unseeded-randomness token family (`Date.now`, `new Date(`,
  `Math.random`) - findings exit 2 (a config-class failure) naming every
  file:line with the law phrased (`derive from ctx.seed instead`); a flat
  surface exits 0 with the scanned count. `run --lint-determinism` runs
  the same lint as a pre-flight INSTEAD of the campaign (no requests, no
  artifacts written - CI wires it in one line). Flat grep on purpose:
  the finding classes are flat-shaped and an AST walk would want a
  dependency (zero-deps law); the crate's own src/ is not scanned (its
  determinism is pinned by tests, and the harness's durationMs is INFO,
  not a verdict input). Teeth: test/lint-determinism.test.js.

- two new general library families armed from the vant arms (issues #10
  and #11) - the library grows 30 attacks / 12 modules -> **49 attacks /
  14 modules**, same contract, same honest-skip law, same pin walls:
  **memory** (9 attacks) grades note-store discipline for any app that
  persists versioned notes and re-reads them (drift rows:
  silent-overwrite, stale-poisons-fresh, contradiction-carry;
  hallucination rows: hallucinated-fact-probe, citation-drift,
  phantom-scope; resolution rows: identity-merge-collision,
  resolution-order-stability, delete-is-loud) via moduleCtx['memory']
  (writeRoute/readRoute/deleteRoute/readStyle); **governance** (10
  attacks) grades the order-keeping apparatus (succession:
  trust-floor/single-heir/revocation-carry; escrow: two-key-release,
  expiry-is-fail-closed, refusal-is-typed; trust floors:
  grant-conflict-deterministic, capability-no-sideways; locks:
  lock-ttl-honesty, lock-owner-fencing) via moduleCtx['governance']
  (grantsRoute/resolveRoute/escrowRoute/locksRoute + ttlMode/staleToken).
  Both model-free, in-process, deterministic (fixed canary ids, no wall
  clock); honest-skip inherits wholesale. Teeth:
  test/scenarios/memory-governance.test.js (two-way: disciplined fixture
  holds, vulnerable twin flips drift/merge/escrow/sideways/fencing rows;
  19-row honest-skip census). All pin walls swept in the same commit
  (attacks doc + web catalog + count pins catalog=49 + FAQ claim +
  dogfood battery regenerated at 49/49). Skip lines name missing KNOBS,
  not "undefined" routes. Also fixed at cause: the web ledger-snapshot
  generator's header regex predated the cut-stamp refactor (it silently
  wrote vunknown/seed-unknown meta since the report header moved to the
  `v<ver> / seed <n>` + stamp-line shape); it now parses both shapes and
  takes startedAt from labs/run-meta.json.

- harness primitives for stateful QA (issues #14 + #15, additive - the
  plain `run(harness, ctx) -> one record` contract is untouched):
  **chain attacks** declare `steps: [...]` on an attack (instead of
  `run`): each step fires a route, grades its own record against an
  evaluative `expect` (exact status, `'2xx' / '4xx' / '429-or-4xx'` spec
  strings, or a `(record) => {ok, detail}` grader; omitted = the fuzz
  floor), and the chain reports ONE summary verdict named by the flipped
  steps with the per-step table in `evidence.steps` - a 6-step flow no
  longer smears into an unattributable blob. `c.state` is the
  deterministic shared bag across steps; honest-skip inherits on
  undeclared routes and `guard` skips, never a false positive.
  **campaign state**: `ctx.vars` (deterministic JSON registry - values
  round-trip and are prototype-safe with `{ __proto__: ... }` rejected at
  cause; re-writes are LOUD late-key errors naming both writers; reads
  of unset keys skip honestly), `ctx.objects('name')` namespaced bags for
  wordier fixture handles (write-once, inventory listed), and
  `group: 'feature-name'` on attacks so shards grade jointly (aggregate
  verdict, per-row records intact). Everything lands in the run blob +
  the report when non-empty (**Groups** / **Campaign state** sections;
  committed baselines stay byte-stable when a run carries none) and dies
  with the campaign. Teeth: test/primitives.test.js (9 pins), contract
  validation for steps/groups; docs in reference/scenario-contract.md
  #2b + #3.

- pack.json env claims (issue #12): a pack now DECLARES what it needs of
  the run root - `env.d1` / `env.kv` binding claims (d1 optionally with
  `tables`), `env.routes`, and an optional `env.seed` fixture passthrough
  - and the loader computes each pack's structured `prerequisites` (unmet
  claims only) against the built harness surface. Display surfaces: the
  pack line + `prerequisites UNMET` diagnostics in `crashtest packs`
  (with a config, claims evaluate against a real harness, no requests),
  the `--module-plan` blob (`plan.packs[].prerequisites`) + per-pack
  unmet rows, and the same diagnostics before a real `run`. Attack-level
  skip verdicts stay the ground truth - claims are display, and a missing
  binding never invents one. Seeds land only into EXISTING claimed
  bindings (kv absent-or-identical, d1 tables must be new; conflicts fail
  the run loudly), tick no counters, and derive the same commit -> same
  findings. Teeth: test/packs.test.js (env claims section),
  schema docs in docs/reference/packs.md.

- faked1 v0.2 (`src/harness/d1.js`): the FakeD1 SQL subset grew to the
  relay class, grounded in and verified against real SQLite (node:sqlite)
  for the eight statements gistory's relay actually runs - general value
  expressions (CASE WHEN/THEN/ELSE, arithmetic, COALESCE, comparisons,
  `IS [NOT] NULL`, `IN`, `AS` aliases), whole-result-set aggregates
  (MAX/MIN/COUNT/SUM/AVG; unaliased COUNT(*) keeps the `count` key),
  `INSERT OR IGNORE|REPLACE`, `ON CONFLICT(cols) DO NOTHING|DO UPDATE`
  upserts with row-vs-`excluded.*` resolution (bare cols read the STORED
  row at eval time, pre-assignment), `INSERT..SELECT` (seq-allocator
  shape), `RETURNING` on INSERT/UPDATE/DELETE (write
  `.run()/.first()/.all()` surface `{results, meta}`), and `LIMIT ?` /
  `OFFSET ?` bound by parameter. All v0.1 behavior contracts re-pinned
  (UNIQUE message shape, `{meta:{changes,last_row_id}}`, textual param
  order, batch partial-apply honesty); unsupported SQL still throws listed
  gap messages. Teeth: test/harness/d1-v02.test.js (issue #8; the
  node:sqlite fixture pattern in the run-roots playbook stays for handlers
  speaking JOINs/GROUP BY/window functions).
- `crashtest init` scaffolds WORKING pack stubs: both `packs/public/my-pack/`
  and `packs/local/my-private-pack/` now ship the same contract-valid
  `index.js` stub `packs add` writes (honest unarmed REFUSED-skip module)
  alongside the manifest, so a fresh init loads out of the box instead of
  hard-failing the very next `run` on a missing entry file (issue #16;
  pinned by a loader round-trip test in test/packs.test.js).
- the scenario-contract lifecycle hooks are LIVE: `beforeAll(ctx)` /
  `afterAll(ctx)` were validated (`src/scenarios/contract.js` arity-checked
  them) but never invoked - the first external pack author (gistory,
  issue #7) built a one-loud arming check on them. `runCampaign` now calls
  them once per module, around the module's attacks, with the module's
  `moduleCtx[<name>]` + seed; a throw inside either hook fails the campaign
  loudly at cause (rule 3). Pinned in test/campaigns.test.js.
- docs: new reference page `docs/reference/scenario-contract.md` - the
  module/record/ctx/harness shapes a first-time pack author had to read
  source for, linked from the packs reference; and a run-roots playbook
  section "When your handler speaks real SQL" documenting the
  `node:sqlite` D1-shape fixture pattern (Node >= 24) for handlers whose
  SQL outgrows the FakeD1 v0.1 subset (issue #6).

## 1.0.0

- two more framework wire packs ship: `vite-dev-shapes` (0.1.0) - the vite
  dev-file wire (`/@fs/`): `vite-fs-deny-bypass` (grammar differential:
  plain shape gated + bypass grammar like `?raw??` served = bypassed) and
  `vite-env-canary` (content-shape oracle for the `.env` deny family -
  an anything-200 handler stays honestly REFUSED); and
  `next-middleware-shapes` (0.1.0) - the middleware-subrequest header:
  `mw-bypass-grammar` (known grammars must not un-gate a gated route) and
  `mw-value-blindness` (a canary value that is not a certified chain must
  never unlock the gate). Both sweep declared routes with differential
  oracles, both dogfooded end to end through the real CLI (vulnerable
  wires exit 1 with the right EXPLOITED rows; hardened wires exit 0;
  ungated/open wires honestly REFUSED), teeth in test/vite-shapes.test.js
  + test/next-mw-shapes.test.js; tarball ships both.
- new shipped pack `qs-shapes` (0.1.0): bracket-notation parser shapes for
  the express extended-query / urlencoded wire (any qs-style expander) -
  `qs-bracket-canary` (prototype-key canary via `__proto__` /
  `constructor.prototype` bracket keys, library-input oracle through the
  bracket wire) and `qs-depth-floor` (deep `[0]` nesting ladders must stay
  under the fuzz floor). Sweep semantics (every declared route, optional
  `ctx.routes` whitelist); two-way teeth in test/qs-shapes.test.js
  (vulnerable parser EXPLOITED, hardened and bracket-blind wires honestly
  REFUSED, empty run roots skip honestly); tarball ships it.
- determinism: the wall-clock cut stamp moved OUT of the committed ledger
  and report (`labs/crashledger.json` + `labs/hardening.md` are now
  byte-stable per commit, `generatedAt` dropped) into the `labs/run-meta.json`
  sidecar written alongside them by `run`/`init` and fanned out by
  `--out-dir`. The pre-tag double-run ritual now passes by construction and
  a determinism pin test enforces it (test/cli.test.js); verdict rows were
  already byte-identical.
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
