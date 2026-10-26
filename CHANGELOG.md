# Changelog

Notable changes to the `crashtest` package. The released version lives in
`package.json` + `VERSION` in `src/cli.js` (kept equal by
`test/version.test.js`); releases go out on `vX.Y.Z` git tags via npm
Trusted Publishing (see [docs/publish.md](./docs/publish.md)).

## 1.1.1 (unreleased)

- npm tarball ships the WP adapter's worker (issue #34): the 1.1.0 tarball's
  `files` whitelist (`bin`, `src`, `packs/public/*`) omitted `fixtures/`, so
  the WP adapter could not boot under an npm install at all -
  `WORKER_DEFAULT` resolves `fixtures/wordpress/wp-worker.php` from the
  adapter's own location and `npm i crashtest` never shipped it; the spawn's
  "Could not open input file" died silently into `cfgSent`'s catch and got
  misdiagnosed as a stale-worker cfg rejection. The tarball now ships
  `fixtures/wordpress` (worker + the `stub-wp/` harness, version-locked to
  the installed adapter; `fixtures/demo` and the rest of `fixtures/` stay
  repo-bound) and packaging drift is a suite row, not a first red-team run:
  test/packaging.test.js gains a fixture-census row (WP subset ships,
  nothing else under fixtures/ leaks) plus a REAL pack + local npm-install
  smoke (temp workdir, `npm pack` tarball, `npm i`, then the packaged
  tree's own `WORKER_DEFAULT` target must exist; zero-runtime-deps holds -
  no registry touched, crashtest has no runtime deps). Boot now fails loud
  + nameable (rule 3): `WPWorker` stats its script at construct and throws
  "worker script not found at <path> - npm tarball omits fixtures/? mount
  { script } from a git checkout...", reserving the `cfgSent` catch for
  actual cfg rejection; the stale-worker error keeps its message and now
  carries `{ cause }` so a start-level failure surfaces the real first
  error. Docs: the WordPress playbook notes the tarball behavior and the
  { script:` override mount pattern. Suite 319/319 (2 new rows; was
  317/317).
- the docs layer's freestruct install moves to the npm-published release
  (receipt for issue #36): the docs workflow's `github:dhaupin/freestruct#dfb30aa498`
  source-tarball pin (last commit carrying `docs/lib/` at the documented
  path) becomes the exact-version npm pin `freestruct@1.1.0` - published
  2026-10-25 with provenance, proper bin (`bin/freestruct.mjs`), and a
  tarball e2e hard gate. The run step follows the package: the old
  `node node_modules/freestruct/docs/lib/inject.js` layout no longer ships;
  the step now invokes the installed bin via node directly. Contract
  checked before the landing: `freestruct validate` passes against this
  repo's existing `docs/ssr-config.yml` unchanged. Exact pin ritual stands
  (bump the number the day freestruct releases again - never float).
- the opt-in vacuous run for configless roots (issue #37, the flowforge
  CI shape): `run --allow-vacuous` in a root with no `crashtest.config.js`
  prints ONE honest line (`crashtest: no <config> found - vacuous run, 0
  handlers, 0 attacks, exit 0`) and exits 0, writing nothing - so a repo
  in the pre-handler lifecycle state keeps the pinned install + the CI
  step LIVE instead of parking them behind `hashFiles` arm-gates, and
  install rot gets caught the day it happens, not the day the config
  lands. The default stays strict byte-for-byte: a missing config without
  the flag is the same hard exit 2 as before (it must never silently
  green a broken run), and with a config present the flag is irrelevant
  (the run is byte-normal). `crashtest packs --allow-vacuous` gets the
  symmetric treatment (honest empty-listing line, exit 0; the plain
  configless `packs` listing was already a quiet 0 and keeps its hint
  line under the flag). `--json` keeps its LAST-stdout-line contract on a
  vacuous run: an honest empty-shape blob (vacuous:true, handlers:0,
  tally TOTAL:0) with the real run's field names. Teeth: 5 new rows in
  test/cli.test.js (vacuous line + no artifacts, json blob shape, strict
  default preserved, armed-config irrelevance, packs symmetry). Docs:
  exit-rules.md gains "The opt-in exception", quick-start exit table
  notes it, --help documents the flag on both verbs.
- the pack loader's entry-shape enforcement grows a defer option (issue
  #33, packstruct SPEC section 7): `loadPacks(roots, seen, check,
  { validateProfile: false })` defers ONLY the scenario-contract shape
  check - the manifest contract (schemaVersion/name/description/entry
  collision rules) stays fully enforced in every mode - so a manifest-
  conformant, entry-importable profile-minimal pack (the SPEC's clean
  fixture: `export default { name: 'clean-pack' }`) can exist under this
  engine for host faces that carry other profiles. The strict default
  (validateProfile: true, implicit) keeps `crashtest run` and `crashtest
  packs` byte-identical and every existing refusal pin holds: a
  contract-invalid entry still fails LOUDLY naming the pack origin on the
  run path. Teeth: 3 new rows in test/packs.test.js (the clean case loads
  deferred, the bad manifest still fails loudly deferred, the default
  stays strict). Docs: packs reference documents the option.
- the host-lane convention becomes discoverable: `crashtest lint-packs
  [--deep] [--json] [--against <lib>] [dir]` + `run --lint-packs`
  (issue #32, the gistory wiring receipt) - opt-in passthrough to the
  packstruct binary the repo has INSTALLED (node_modules/.bin first, then
  PATH; never downloads or bundles one - the zero-deps law holds), so the
  every-family-repo `packs/` spec-lint lane stops being folklore. Policy
  pinned: explicitly invoked but packstruct missing = exit 2 naming the
  fix (`npm i -D packstruct@<exact>` - requested-never-working is a broken
  config, OFF not half-on); present but exiting non-zero = verdicts pass
  through verbatim with the exit code riding (0/1/2; the loader's checks
  stay the correctness ground truth, the lint is author-time DX + the id
  census). Dir law pinned: the packs ROOT is the default and packstruct's
  contract root (passing `packs/public` reads as 0 packs checked - the
  live gistory footgun); an explicit dir passes through untouched and the
  header line names the actual dir checked. `run --lint-packs` runs the
  same lane INSTEAD of the campaign (no requests, no artifacts - mirrors
  run --lint-determinism) and needs nothing from the config, resolving
  before the import. This repo's `lint:packs` script collapses onto the
  verb (`node bin/crashtest.js lint-packs`) - the crate eats its own
  surface first. Teeth: test/lint-packs.test.js (missing-packstruct exit
  2 + fix string, exit-code fidelity 0/1/2, ROOT-default argument
  capture, explicit-dir passthrough + header naming, run preflight +
  no-artifacts, preflight missing-packstruct). Docs: packs.md gains the
  "Spec lint" section; --help documents both surfaces.
- the WP adapter grows the internal-hook + WooCommerce-order vocabulary
  (issue #35, the live-fire khf-wp receipt): plugin-side payment bridges
  complete money through INTERNAL hooks, not HTTP routes, and the worker's
  op vocabulary had neither a hook fire nor order fixtures. The state ops
  gain `do-action` (fires ONE hook through the real hook registry,
  whitelist-gated by `hookAllow: { hook => max-args }` crossing the SAME
  cfg-envelope trust model as callAllow; undeclared = loud fatal naming
  hookAllow, args sliced at the bound like calls) and the `wc-*` order
  fixtures: `wc-create-order` (fee line item + binding order meta; returns
  { id, status, total }), `wc-order-set-status` (the money trigger -
  set_status + save fires the real `woocommerce_order_status_*` hooks in
  the target), `wc-order-get` (store-agnostic { id, status, total,
  currency }), `wc-order-get-meta` (the WC meta API - the binding-meta
  oracle on BOTH HPOS and legacy CPT stores), `wc-order-delete`
  (playbook-rule-1 teardown). Degradation is loud where WooCommerce is
  not active at the root; the generic-adapter rule holds (the worker knows
  NO plugin - the funnel listeners live in target packs; the STUB WP core
  carries the same vocabulary + a deterministic ct_wc_money_funnel
  listener layer so CI teeth run with no WC install at all, and the stub
  mirrors order meta onto the order's own post id = the legacy CPT read
  path, so cross-store replay surfaces grade in CI). Unknown-op and
  no-order reads stay loud fatal. The khf-money pack side (replay/pacing
  shapes against the WC bridge) is the consumer's next PR per the issue.
  Teeth: test/wp-hooks-wc.test.js (4 armed rows against the stub with
  REAL php: dual read-path meta, hookAllow gate, status-hook relay
  timing, arg bounds) - 337 tests run under php 8.3 in-session. Docs:
  the WP playbook's config + scenario-surface blocks document hookAllow
  and the full wc-* vocabulary.
- the packs-root/visibility-dir footgun closes on the crate side too
  (the packstruct#13 family shape, mirrored inward): a `packs:` root whose
  basename is `public/` or `local/` used to point the loader at
  `<dir>/public/<name>/` - which does not exist - and SILENTLY load zero
  packs (crashtest's variant of freestruct's confusing `public/public/`
  error, but silent: a typo'd config just greens a no-pack run). The
  loader now refuses loudly at cause naming the fix ("pass the packs ROOT
  - the parent of public/"), and the escape hatch stays legal: a
  `pack.json` directly inside a public/-named dir is a one-pack-dir load
  and never trips the guard. Same-misfire class, two more silent-greens
  closed while in there: a config `modules:` filter that matches NOTHING
  (a typo'd subset, or `[]`) used to run a zero-row campaign and exit 0 -
  it now refuses loudly with the unmatched names AND the loaded module
  list (a matched filter still runs its rows; no-filter behavior is
  byte-unchanged); and a declared config `scenarioDirs:` path that does
  not exist used to quietly contribute no modules - it now fails loudly
  naming the dir (the `labs/scenarios/` auto-scan stays optional: fresh
  repos boot before `init`, and the vacuous shape from #37 depends on
  it). Nothing is stricter than the honest-skip law needs: guards fire on
  misfired CONFIG, never on honest degradations. Teeth: 2 new rows in
  test/packs.test.js (guard fires on public/ + local/ + array members,
  real root still loads beside it, oddly-named one-pack-dir loads), 3 new
  rows in test/campaigns.test.js (zero-match typo + empty filter refuse,
  matched filter runs, no-filter byte-unchanged), 2 new rows in
  test/cli.test.js (ghost scenarioDir refuses, packs: ['packs/public']
  refuses). Docs: config.md tuning block documents both loud guards,
  packs.md documents the ROOT footgun closure.

## 1.1.0 (2026-10-25 on npm)

- the pack lane installs packstruct from npm (2026-10-24, armed for the
  packstruct v1.0.0 publish): packstruct moves from a GitHub-clone pin at
  the spec commit to an EXACT devDependency (`"packstruct": "1.0.0"` in
  package.json, no float - same commit -> same findings applies to the
  linter too). CI runs `npx --no-install packstruct lint packs` plus
  verify-spec straight out of node_modules (the npm wrapper ships the same
  spec/SPEC.md path), dropping the /tmp clone entirely; a `lint:packs`
  script gives contributors the same two checks locally. The spec-commit
  SHA b0e3050... stays as the byte-exact transcript's provenance in
  labs/packstruct-backfill/ - that pin keeps its verify semantics, only
  the install shape moved. The lane rode out armed (staged commit, dormant
  until the devDependency resolved) and verified clean on publish day
  2026-10-25 (packstruct v1.0.0 on npm, OIDC-attested): verify-spec
  byte-equal against the shipped spec/SPEC.md, `packstruct lint packs`
  8/8, `package-lock.json` committed pinning the exact resolution, and
  the cloud CI green on the new lane first try (README's packstruct
  paragraph now cites the npm release as the pin).
- refusal battery, permanent in-repo (crashtest#25, packstruct#3's shared
  matrix): the 18-shape transcribed corpus (labs/refusal-battery/) plus a
  self-verifying generator (scripts/gen-refusal-battery.cjs - materialize
  each shape per its own instructions, run the loader over it, then a
  column either gets written or re-observed with per-row drift lines),
  the observed crashtest column (labs/refusal-matrix-crashtest.json,
  every cell OBSERVED, not hand-derived), and 4 pins in
  test/refusal-battery.test.js: byte-drift gate, the six documented
  loader/linter disagreements locked (a silent flip is a finding, not
  noise), cross-column parity, and the one upstream emitter anomaly held
  on record to fire the day packstruct's generator fix lands (one copy +
  one regenerate to re-ingest).
- theme-switch icon direction flips family-wide (crashtest#26, mirrored
  from packstruct; icon = action, not state): dark shows the sun (click
  = light), light shows the moon (click = dark), on the landing nav
  (ThemeSwitch) and the docs header - both SVGs always render in the
  markup, CSS picks the visible one, so prerendered bytes and hydrated
  output are identical, no flash.
- the release-post system (docs/discussions/): one announcing-vX.Y.Z.md
  per release, shaped like prestruct's, lint-gated like every docs page -
  the file's raw markdown IS the announcement (view source, copy, strip
  the frontmatter, post); the posting mechanics live in the index, and
  the v1.0.0 post ships with this batch, paragraphs unwrapped for a
  clean raw-markdown copy.
- pack self-audit fixtures backfilled for all 8 production packs
  (packs/public/<pack>/test/fixtures/, SPEC section 4 norm - closes
  dhaupin/crashtest#28): each fixture is hand-invocable
  (`node test/fixtures/run.mjs`) and pins the pack's documented shape as
  transcription of existing assertions, never invention - the manifest
  contract (schemaVersion 1, name/dir match, entry imports clean), the
  census-locked attack inventory (crashtest-site 18, wp-stock-smoke 4,
  wp-money-shapes 3, wp-roles 3, cve-feed/next-middleware-shapes/
  vite-dev-shapes/qs-shapes 2 each; 36 total), the kebab-case id grammar,
  and the per-pack data rules (cve-feed snapshot shape + unique CVE ids,
  wp-money-shapes armedByKey residency, contract-shaped run() for the
  wire packs). Manifest surface untouched (fixtures are cargo, not
  schema). test/pack-fixtures.test.js discovers + runs every fixture in
  CI (10 rows): adding a ninth pack without its fixture, dropping an
  attack, or wrecking a manifest now fails the offending pack rather
  than waiting for a cross-host load. Suite 317/317 (was 307).
- the campaign-path seam pinned two-way (test/harness/v03-campaign.test.js):
  a live `runCampaign` walks the v0.3 engine surface end-to-end - the
  disciplined run-root scores 5/5 REFUSED (scoped GROUP BY rollup,
  owner-filtered one-key JOIN, fixed-epoch day bucket, idempotent
  ensureSchema, honest KV cursor pagination) and the naive twin scores
  5/5 EXPLOITED (cross-owner rollup rows, JOIN secret leak, wall-clock
  bucket, destructive DDL rerun, lying `list_complete`). Closes the union
  the unit rows (d1-v03/kv-v02) and the campaign rows deliberately don't
  overlap: campaign -> harness.run() -> handler -> FakeD1 v0.3. Also pins
  the paid-for seeded-fixture trap: tables written as raw arrays silently
  produce EMPTY stores (scope rows then grade REFUSED from the outside),
  so the hardened run asserts the rollup saw real data - a REFUSED can
  never be a false negative. Zero library-attack growth (no census or
  pin-wall sweep); the naive twin's wall clock is the documented exploit,
  not a determinism surface.
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
