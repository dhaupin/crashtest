# prd-tmp: the issue-inbox survey + build plan (Oct 2026, post-1.0.0)

> Scratch PRD: the triage of the first real-world issue wave against
> `dhaupin/crashtest`, and the build order agreed from it. Living doc -
> items move to TASKS.md / the changelog as they land. Supersedes nothing;
> complements `labs/prd-crashtest.md`.

## The receipts (what "it works" means)

- **First external user's verdict** (#16): `crashtest init` on a fresh
  global install, 30/30 attacks against a two-handler demo target, ONE real
  EXPLOITED finding (handler broke on request-shape floods), fixed, re-ran
  to a clean 30/30 REFUSED ledger. "Otherwise: excellent first run."
- **gistory (dhaupin/gistory) shipped the first external pack** -
  `sync-relay-shapes` - and it ran clean: **37 REFUSED / 6 BOUNDED / 0
  EXPLOITED** (#6/#7). Gaps hit were exactly two, both documented below.
- **vant's run root** (`scripts/crashtest-run.js`) is live and driving
  D1/KV-shaped packs (#9, #12, #13); cross-links a migration PRD that
  depends on the chaining primitive (#14).

## Issue map (11 open after the survey: #6-#16)

### Lane 0 - the one real bug (v1.0.1 patch)
- **#16** `init` scaffolds `packs/{public,local}/my-pack/pack.json` declaring
  `"entry": "index.js"` but writes no `index.js`; every subsequent `run`
  hard-fails until the packs are deleted. Verified in-source: `cmdInit`
  writes manifest stubs only; `src/packs/loader.js` throws on a missing
  entry file. `packs add` DOES write the stub - init-only gap.
  **Fix**: init writes the same contract-valid `index.js` stub `packs add`
  writes (honest unarmed skip), so a fresh scaffold loads out of the box.
  Pin test: init's scaffold round-trips through `loadPacks`.
  **Ship as v1.0.1** (patch bump, all version surfaces swept).

### Lane 1 - docs the first pack author had to read source for
- **#7** Scenario contract page: `run(harness, ctx) -> RunRecord` shape
  (`REFUSED|EXPLOITED|BOUNDED` + `owner`+`bound` or BOUNDED demotes), ctx
  keys mapping (`moduleCtx['<pack-name>']` surfaces as the module-level
  ctx), harness API surface (`harness.run(routeName, req)` - no sockets),
  `beforeAll`/`afterAll` for one-loud arming checks. Suggested home:
  `reference/scenario-contract` (or a section on `reference/packs`).
- **#6** "When your handler speaks real SQL": the `node:sqlite`-backed
  D1-shape fixture pattern (~40 lines in gistory's `crashtest/fixture.mjs`,
  Node >= 24 unflagged), until FakeD1 grows (#8). Playbook material.

### Lane 2 - engine breadth (the biggest single demand)
- **#8 faked1 v0.2**: grow the SQL subset grounded in eight REAL gistory
  relay statements - `INSERT OR IGNORE|REPLACE`, `ON CONFLICT(cols) DO
  UPDATE SET ...` (+ `excluded.*`), `CASE WHEN/THEN/ELSE END` as a value
  anywhere, arithmetic on stored cols, `COALESCE` + aliases (`AS`),
  `INSERT INTO t (...) SELECT <exprs>` over the target table, `RETURNING`,
  `LIMIT ?`/`OFFSET ?` bound by param. Invariants that must not drift:
  `UNIQUE constraint failed: t.col` message shape, `.run()` ->
  `{meta:{changes,last_row_id}}`, row-vs-excluded eval-time resolution,
  batch partial-apply honesty, every gap still throws a LISTED UNSUPPORTED
  message (DISCOVER, not mid-campaign). **Acceptance**: gistory's four-table
  fixture runs row-for-row like real SQLite; the gistory run root swaps its
  `node:sqlite` fixture for bare FakeD1 with byte-identical results
  (37/6/0), and files the cross-repo issue on dhaupin/gistory when it
  ships. Out of scope: JOINs, GROUP BY/HAVING, subqueries, windows,
  triggers, FKs, CREATE/ALTER.
- **#9 FakeD1/FakeKV ops gaps** (vant arms): aggregates beyond COUNT
  (MIN/MAX/AVG/SUM, GROUP BY/HAVING, simple JOINs eventually), functions
  (`unixepoch()`, `datetime()`, `json_extract()`), subqueries, ORDER BY on
  computed cols, `batch()` + explicit transactions, snapshot-parity under
  new SQL, unique-error shape (this one IS the contract), CREATE/ALTER.
  FakeKV: honest `list_complete: false` + cursor pagination, deterministic
  fake clock for TTLs, value-size cap, `get()` metadata parity.

### Lane 3 - harness primitives (the "crate tooling" lane)
- **#14 chaining**: additive step-scoped attack shape (`steps: [...]`,
  per-step records + chain summary verdict, findings named by step,
  deterministic shared `c.state` bag, evaluative `expect`, honest-skip
  inherits). Unlocks ~20% of vant's stateful suites. Watch the no-random
  law: the sample body has `code: '000000'`, not Math.random - keep it.
- **#15 campaign vars/objects/groups**: `ctx.vars` (campaign-scoped
  deterministic registry, conflicting writes are LOUD late-key errors,
  never last-write-wins), `ctx.objects(name)` (typed namespaces for
  fixture handles/ledgers, listed in the report), `groups` (a bundle of
  row handles grading ONE feature). Verdict contract untouched; additive.
- **#12 env claims**: optional `env` block in pack.json (`d1`/`kv`/`routes`
  + optional `env.seed`); loader computes structured `prerequisites` for
  the CLI/report to RENDer - attack-level skip verdicts stay ground truth.

### Lane 4 - new library families (demand the same adopter needs)
- **#10 memory rows** (9): drift (`silent-overwrite`, `stale-poisons-fresh`,
  `contradiction-carry`), hallucination (`hallucinated-fact-probe`,
  `citation-drift`, `phantom-scope`), resolution (`identity-merge-collision`,
  `resolution-order-stability`, `delete-is-loud`). Model-free; patient is
  any versioned note layer; honest-skip degrades for targets without one.
- **#11 governance rows** (10): succession (`trust-floor`, `single-heir`,
  `revocation-carry`), escrow (`two-key-release`, `expiry-fail-closed`,
  `refusal-typed`), trust floors (`grant-conflict-deterministic`,
  `capability-no-sideways`), locks (`ttl-honesty`, `owner-fencing`).
  Fixture vocabulary (grants/escrow/lock tables) is D1-expressible once
  Lane 2 grows the subset.
- Both depend on Lane 2/3 for their fixtures; vant already ships validated
  ancestors in `packs/public/vant-brain` (rows 1/7 of #11 measured a real
  EXPLOITED the hour they armed).

### Lane 5 - the big census (#13)
vant: 258 suites / ~54k lines; ~70-80% of assertion rows are pack-shaped.
Flip blockers (the crate tooling list): two-pod fixture broker, snapshot
diff helper, `--lint-determinism` flag, expectation tables as data. Staged
per-bucket, reverse-verified (old suite stays green alongside until the
crashtest run is stability-green on both).

## Build order agreed

1. Lane 0: #16 fix -> pin test -> v1.0.1 (patch, version surfaces swept).
2. Lane 1: #7 + #6 docs.
3. Lane 2: #8 faked1 v0.2 (hard acceptance gate: gistory byte-identical
   37/6/0 + the cross-repo issue on dhaupin/gistory).
4. Lane 3: #12 env claims (small), then #14 + #15 (land together; vars are
   the natural bag for chain steps).
5. Lane 4: #10/#11 once fixtures can express their tables.
6. Lane 5: census conversion after the primitives exist.

## House laws these must all inherit

No sockets (in-process WHATWG only); fail loudly at cause; zero runtime
deps (JSDoc, no build step); determinism (seeded RNG, no wall clock in
verdict paths); exit rules are the CI contract; pin walls update in the
same commit (counts, docs, web catalog, changelog); docs claims verified
against the CLI.
