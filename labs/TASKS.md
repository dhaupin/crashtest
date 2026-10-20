# Crashtest — TASKS

> Rolling log. Companion to labs/prd-crashtest.md (the product contract).
> Reconstructed 2026-10-19 from the rook horcrux (crashtest brain goals.md +
> lessons.md) after the original scaffold never left the old workspace.
>
> Session log format: `- [DATETIME] note` (newest at top). Struck items are done.

## Open decisions (resolve before S1 lands in git)

- [x] **D1 · Scenario library contract**: port gistory's suites as-is into
  `src/scenarios/` (Rook lesson: "Do not fork the ideas; port the code") vs.
  re-derive a fresher neutral `{ name, attacks: [{ name, run(harness) }] }`.
  **Resolved contract-first** — gistory source stays unreachable from this
  workspace, so the seed libraries derive from the PRD §6 catalog
  (gistory-ideas, no gistory-specific fixtures). The gistory suites can port
  onto the same contract once access exists.
- [x] **D2 · Zero-dependency scope**: PRD principle 5 ("the attacker ships
  light"). **Resolution: zero *runtime* deps, plain Node ESM + `node:test`;
  dev-only `tsc`/ESLint allowed in `devDependencies`.** Harness implements its
  own fake-transport + in-memory D1/KV rather than pulling
  supertest/better-sqlite3 (matches the proven gistory harness shape: fake D1
  + op counters).
- [x] **D3 · Language: JS runtime, typed with JSDoc.** No build step to run,
  test, or publish. `tsc` allowed in devDependencies only for `checkJs` CI
  and `--allowJs --declaration` `.d.ts` generation for consumers — decide at
  0.2 when the plugin API needs typed shelves. Rationale: harness speaks
  Request/Response at runtime; target apps' TS is irrelevant; the D1-parser
  bugs this week were semantics bugs that tests caught, not type bugs.

## Sprint S1 — v0.1 "the gistory extraction" (order matters)

- [x] **S1.0** Repo skeleton: package.json (bin: `crashtest`), `src/`,
  LICENSE/README, publish workflow (tag-driven, Trusted Publishing OIDC),
  runbook. (tsconfig intentionally deferred with D3: JS + JSDoc, no build.)
- [x] **S1.1** `src/harness/`: explicit route table (PRD open question: static
  import analysis is v0.2/v0.3 — no convention sniffing yet), fake transport
  (Request/Response objects, never sockets), in-memory D1 shim + KV/env
  bindings, op counters + cost meters per request.
  — DONE 2026-10-20 counters.js / d1.js (SQL subset, uniques throw D1-shaped
  messages, textual-order param binding) / kv.js / env.js / harness.js
  (threw-first, never a fake 500).
- [x] **S1.2** `src/scenarios/` — DONE (contract-first, seed libraries from
  the PRD §6 catalog since gistory source stays unreachable): `input`
  (proto-pollution / never-fail-mutations / oversized-field), `auth`
  (identity-spoof-headers / secret-watermark / privilege-escalation), `guards`
  (hygiene-no-store / burst-wall). Loader supports user dirs — labs/scenarios/
  is scanned automatically by `crashtest run`. Two-way proof tests: vulnerable
  fixtures EXPLOITED, hardened fixtures REFUSED, for every library.
- [x] **S1.3** `src/campaigns/runner.js` — DONE: runs every (module, attack)
  with per-attack cost deltas, ownerless-BOUNDED demoted to finding,
  deterministic ordering + seeded ctx.
- [x] **S1.4** `src/report.js` — DONE: buildLedger / diffAgainstBaseline /
  exitCode (fail ONLY on new EXPLOITED or REFUSED→EXPLOITED regressions;
  accepted risks with owner+bound never re-alarm; boundless accepted risks
  count as findings) + renderMarkdown (PRD §7 shape: Findings → Cost
  economics → Baseline diff).
- [x] **S1.5** Fixtures demo app (Pages Functions + D1) and dogfood:
  `crashtest run` attacks crashtest's own fixtures. DONE 2026-10-20 —
  `fixtures/demo/app.js` (hardened baseline variant + vulnerable draft
  variant incl. the classic recursive merge), root `crashtest.config.js`,
  CLI-level dogfood tests (hardened green / vulnerable exit 1 / regression
  gate), `.github/workflows/ci.yml` (check + tests + self-dogfood against the
  committed ledger baseline), README status refreshed.
- [x] **S1.6 (partial)** CLI glue: `crashtest run [--config path]` executes
  the real pipeline — crashtest.config.js target (routes+env+ctx) → harness →
  loadScenarios (+ labs/scenarios auto-scan) → runCampaign → ledger diff →
  writes labs/hardening.md + labs/crashledger.json → exit per §7 rules.
  Missing config → honest exit 2 with a shape hint.

## Log

- [2026-10-20 ~10Z] **v0.1.0 SHIPPED via OIDC — the loop is closed.** First
  attempt failed (E404 = stage-only default on the fresh TP config); after
  dhaupin flipped allow-direct-publish, re-pushed the tag (integration can't
  rerun someone else's failed run — `Resource not accessible by integration`
  — but a tag re-push retriggers cleanly) and run 39359193986 went green in
  19s: tests inside the workflow, tarball assembled, `npm publish` completed
  with provenance — **signed statement published to the transparency log**
  (search.sigstore.dev logIndex 3329750463). Registry now: versions
  0.0.0-stage / 0.0.1 / **0.1.0 (latest)**, author dhaupin, MIT. Zero tokens
  anywhere in CI. Remaining cleanup: dhaupin revokes the Termux granular
  token (never needed again); milestone deleted-tag note: tag re-push needed
  because rerun permissions are integration-limited.
- [2026-10-20 ~09Z] **Name claimed on npm — crashtest@0.0.0-stage is live.**
  dhaupin published from Termux via a granular access token (Route B,
  staged): package title/public name are on the registry as of
  2026-10-20T01:57Z, contents pending stage approval with 2FA. Version bumped
  0.0.1 → 0.1.0 in package.json + src/cli.js (single VERSION const) and the
  report header's stale 0.0.1 fallback removed — the first REAL version to
  ship over the staged placeholder is 0.1.0, riding the OIDC workflow once
  Trusted Publisher is configured (dhaupin/crashtest, publish.yml, direct
  publish). v0.2 modules land inside the 0.1.0 tarball as clearly-labeled
  ahead-of-0.2.0 features (README documents them as v0.2). Tarball now
  31.1 kB / version-verified. Next: dhaupin approves stage + configures TP,
  then v0.1.0 tag.
- [2026-10-20 ~08Z] **v0.2 landed — everyone's backend + the Action wrapper.**
  `src/adapters/` (hono via `.request`, express via `app.handle` + Node-style
  req/res with Buffer-normalized bodies and MUST-END dispatch — a route that
  never ends is a finding past the drain window, fastify via `app.inject`;
  config `adapters: { hono, express, fastify }` wired through the CLI, options
  vs bare-app shapes detected by own-key heuristic). Seed `state`:
  enumeration-oracle (foreign ids must deny; id always carried — body/params
  or querystyle), id-collision-alias (second-owner same-key write must
  conflict or fork; overwrite detected by DB snapshot diff, not response
  text; default key derived from ctx.seed — determinism). Seed `volume`:
  credential-stuffing, storage-fill, cost-amplification — every run reports
  ops/request; EXPLOITED only on breaks or bound violations (bound via
  ctx, default 12 ops/request). Runner gets `opts.modules` filter.
  `action.yml` composite GitHub Action (setup-node + install crashtest +
  optional target tests + `npx crashtest run --config` with artifact upload
  of the hardening run). Full suite 59/59; dogfood now 13/13 REFUSED
  (snapshot regenerated — attack count grew from 8 to 13); check script
  covers all v0.2 files. v0.2 PRD scope code-complete except: adoption wave
  against real framework apps (gistory adapter honors hono/express),
  harness memory-reuse for sub-second reruns.
- [2026-10-20 ~07Z] **S1.5 landed — crashtest dogfoods itself.** In-repo
  fixture (fixtures/demo/app.js: hardened + vulnerable drafts incl. the
  classic recursive merge), root crashtest.config.js, CLI-level dogfood
  tests (hardened → exit 0 with 8/8 REFUSED; vulnerable → exit 1 with
  proto-pollution + header bypass + hygiene findings; regression gate:
  hardened baseline flipped to vulnerable draft fails on REFUSED→EXPLOITED),
  and .github/workflows/ci.yml making the self-run the CI gate against the
  committed crashledger.json. v0.1 scope from PRD §8 is code-complete:
  harness, seed libraries (auth/input/guards), campaigns, report+ledger,
  CLI, dogfood. 52/52 node:test green, check green, in-repo dogfood exit 0
  (labs/crashledger.json + labs/hardening.md snapshot committed). Next
  candidates for this sprint or 0.2: npm first publish (pending dhaupin's
  Termux), `crashtest init` route-table discovery helpers, 0.2 adapters.
- [2026-10-20 ~06Z] **S1.2+S1.3+S1.4 landed — the pipeline now finds things.**
  Seed `auth`: identity-spoof-headers (403→2xx flip oracle over 9 header ×
  6 privilege matrix, baseline-throw and stable-open branches), secret-watermark
  (fake env secrets must never appear in any response across all routes ×
  error-path probes), privilege-escalation (denied baseline + identity-field
  mutations must not flip). Seed `guards`: hygiene-no-store (surviving 2xx
  writes need explicit cache-control), burst-wall (sequential burst; 429/503
  must carry usable Retry-After; any break is a finding; undeclared routes
  degrade to a skipped REFUSED — zero false-positive CI per PRD §12).
  `runner.js` (cost deltas per attack, ownerless-BOUNDED→finding) and
  `report.js` (ledger diff + §7 CI matrix + markdown) wired into the CLI's
  run verb. Two-way proofs extended to auth/guards; exit-rule matrix tested
  (fresh/regression/accepted/boundless/no-baseline). 49/49 node:test green.
  Remaining from S1.5: an in-repo `crashtest.config.js` + fixture app dogfood
  + CI snapshot of the report.
- [2026-10-20 ~05Z] **S1.2 scenario system + seed input library landed (partial,
  first built-in module).** `src/rng.js` (xorshift*, seeded — same seed → same
  findings, platform-stable), `src/scenarios/contract.js` (the §6 module
  contract: validateScenario fails loudly on bad shapes; verdict helpers —
  BOUNDED without owner+bound refuses to construct; `fuzzFloorViolation` oracle:
  threw-or-5xx), `src/scenarios/loader.js` (built-in `library/` + user dirs,
  name-collision detection, deterministic ordering), and the seed
  `src/scenarios/library/input.js`: proto-pollution-body (canary via hostile
  own-key JSON — hostileSerialize keeps `__proto__` keys where stringify
  drops them), never-fail-mutations (seeded hostile bodies, floor = never 500
  / never uncaught), oversized-field (1 MiB). **Two-way proof in
  test/scenarios/attacks.test.js:** vulnerable recursive-merge fixture →
  EXPLOITED with canary evidence; allow-listed hardened fixture → REFUSED;
  brittle handler → EXPLOITED, validated → REFUSED.
- [2026-10-20 ~04Z] **S1.1 harness core landed.** `src/harness/` complete:
  counters (declared op set + weighted cost + deltas), FakeD1 (SELECT/
  INSERT/UPDATE/DELETE subset against seeded tables; UNIQUE constraints throw
  D1-shaped `UNIQUE constraint failed: t.col` — takeover/row-move campaigns
  depend on it; params bind in textual order incl. SET-before-WHERE; `COUNT(*)`;
  gaps throw with gap-naming messages so DISCOVER surfaces them), FakeKV
  (get/put/delete/list, TTL accepted-ignored for determinism), fake env
  factory (kv seed + d1 tables + secrets), Harness (explicit route table,
  in-process WHATWG Request → handler → Response; uncaught handler errors
  surface as `threw:` records — NEVER converted into fake 500s; per-run op
  deltas + whole-campaign cost totals).
- [2026-10-20 ~03Z] **Name-stake release staged (S1.0 partial, done).** Repo now
  carries a publishable 0.0.1: package.json (exact name `crashtest`, zero
  runtime deps, node >=18.17, MIT), bin + src/cli.js (`init` scaffolds
  labs/crashledger.json schema v1 + hardening.md stub — run is an honest
  exit-2 placeholder), 7 passing node:test cases (TAP, TEST_EXIT=0), chmod +x
  on the bin, and tag-driven publish via npm Trusted Publishing (OIDC, no
  NPM_TOKEN) in .github/workflows/publish.yml. Publish runbook in
  docs/publish.md — first publish is a one-command bootstrap (direct or
  staged, docs updated 2026-10-20); after that v* tags publish+test
  automatically. Waiting on: dhaupin first publish (Termux attempt), then
  npmjs.com Trusted Publisher config (dhaupin/crashtest, workflow publish.yml).
- [2026-10-20 ~02Z] Name re-check (rook lesson: always check npm + gh): bare
  `crashtest` still FREE on npm — but the block is filling in: `agent-crashtest`
  (published 2026-10-16, prompt-injection tests for Claude Code/Cursor/MCP —
  agent-adjacent niche) and `@crashtest-ai/*` 0.1.x family ("CrashTest AI",
  stress/security SDK for AI apps, Sept 2026). PyPI `crashtest` is
  python-poetry's error-handling lib (different domain). Rec: publish npm
  `crashtest` early (even 0.0.x), don't squat-scramble; exact-name ownership beats
  brand adjacency, and our description/invariant ("in-process adversarial QA
  for app code") is distinct from both neighbors.
- [2026-10-19T23:59Z] Rooster session: rook horcrux pulled from the now-public
  weisync/rookworks stone; brain-unlock + horcrux restore clean on vant
  0.8.6-from-main (6 private brains restored). Found + filed vant#212
  (memory learn prose false-positive on `~/`, `../` — "Path blocked" eats
  valid note content, error names no reason). Brain stack switched to rook.
- [2026-10-19T23:59Z] Prior scaffold (f8b4b7e, never pushed) is gone with the
  old workspace; repo on disk = README + PRD only. S1 restarts fresh —
  tasks above are the full plan, nothing is secretly "already done".
- [2026-10-19T23:59Z] Still watching vant #119/#120/#121 (org-grant boot
  hydration, dept/team name=parent-id, health CWD false-negatives) per rook
  goals — re-test org-grant hydration when a fix lands.
