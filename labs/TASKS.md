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

- [2026-10-20 ~24Z] **The pre-tag sweep: audit #1 + #2, surface walk.
  Site pack dist-absent behavior fixed: web/dist is build-only, so
  site-html + the HTML/sitemap attacks degrade to skipped-REFUSED with the
  build named as the coverage fix (routes answer an honest 404 marker,
  never throw; regression-pinned in test/site-pack.test.js). CI now builds
  the site artifacts before npm test, so the shipped site is fully covered
  in CI (audit #1). Tarball fix (audit #2): npm package ships the reusable
  shape packs wp-money-shapes + wp-stock-smoke (files: field), NOT the
  repo-bound crashtest-site pack, pinned by test/packaging.test.js
  (npm pack --dry-run probe) + documented in reference/packs.md. Surface
  walk: init, run (all flags), packs, packs add --public, module-plan,
  preset (prints, never writes), packs inventory + docs claims verified
  against the CLI; README preset wording fixed ("generates" -> "prints");
  era-labeled headings (v0.3 surface) renamed in README/DEPLOY; version
  pin test switched to the exported VERSION; crashtest-site pack header
  comments de-staled (entry = attacks.js, own registry double). Suite
  163/163, check 0, docs gates 4/4, dogfood gate exit 0.
- [2026-10-20 ~24Z] **v1.0.0 version lock (untagged).** package.json +
  VERSION in src/cli.js = 1.0.0; README badge, DEPLOY pins, docs action
  examples + index frontmatter all name v1.0.0; publish flow example tag
  updated; first CHANGELOG.md with 1.0.0 (unreleased); new
  test/version.test.js pins package.json === VERSION === CHANGELOG entry
  so the two release surfaces can never drift again. `crashtest
  --version` prints v1.0.0; suite 159/159, all 4 docs gates + dogfood
  gate green. NOT tagged: tag when the release notes are final.
- [2026-10-20 ~24Z] **The self-pack: crashtest attacks its own shipped
  WEBSITE (packs/public/crashtest-site).** The repo dogfoods fixtures/; the
  site pack extends the dogfood to everything the repo ships to
  crashtest.creadev.org: the real /api/version Pages Function, the real
  _headers (CSP/HSTS/COOP), the prerendered dist HTML, sitemap/manifest/robots.
  9 brutal attacks, honest oracles (pack.json entry = the attack module;
  buildSiteRoutes() is imported by the run root from the pack). First run
  caught a REAL bug: every hostile registry shape (12k version, control
  chars, whitespace-only) echoed straight through as a badge 200. Fixed in
  web/functions/api/version.js with the validation floor: semver-shaped,
  bounded 64, pollution-key guard (__proto__/constructor/prototype), and the
  502 names the fault class but never echoes the hostile bytes. WP packs
  (wp-stock-smoke) degrading off-target: 4 fake EXPLOITEDs (harness.wpState
  TypeError / route "app" fault) on any non-WP run root — real
  false-positive generator, fixed with the config-gap skip (skipped
  REFUSED, declare adapters.wordpress). Two-way teeth pinned in
  test/site-pack.test.js: porous route EXPLOITED, hardened real one
  REFUSED; CLI-level run-root ledger has 9/9 site rows REFUSED at exit 0.
- [2026-10-20 ~24Z] **Docs/web round for the unified packs surface.**
  reference/packs.md: "Packs from other repos" section — packs: accepts any
  directory on disk (another repo's checkout, npm-vendored pack, single pack
  dir); end-to-end proof run before writing: a run root in repo A pointed
  packs: at repo B, a self-contained pack (entry + bundled import) fired 2
  REFUSED rows into repo A's ledger at exit 0. DEPLOY.md ecosystem section
  rewritten around packs-as-master-surface (bundled plugins, cross-repo,
  labeled plan rows); root README v0.3 block updated to the one-contract
  shape. Web: homepage gains pipeline step 05 (Share the attacks) + packs
  card now mentions bundled imports/zero wiring; FAQ answers the new
  "Do packs have to live in the repo under attack?" question; ssr FAQ meta
  updated. Fresh-cache build verified all of it in dist (6/6, JSON-LD,
  og:image intact). Suite 154/154, gates green, consistency probes 7/7. **v0.4 early flag: `run --out-dir <dir>` (§14/§15 close
  out).** The one remaining §14 service-thread flag is shipped: artifact
  fan-out COPIES of run-blob.json + crashledger.json + hardening.md land in
  a distinct dir the caller owns — deterministic filenames, no timestamps;
  the repo's labs/ contract stays authoritative (fan-out is a rendering
  surface, §15.3's hosted-copies rule). Fan-out into the repo root is
  refused at exit 2 (must be a distinct dir). Flag in --help; 2 new CLI
  tests; suite 150/150, gates green. Successor-hygiene note: the --json
  blob now carries { ...run, artifacts } when fan-out is requested — last
  stdout line remains a single parseable object. **Docs/web for v0.3 + the preset probe (v0.3.1).** Docs:
  reference/plugins.md + reference/presets.md (24 pages, nav, all four gates
  green). Web: FAQ grew two Q&As (community attacks via plugins; builder
  presets with the never-guess stance), FAQ meta in ssr.config updated,
  consistency + parity probes green, clean 6/6 prerender with JSON-LD.
  Preset probe: detect-then-prove — scaffoldPreset now EXECUTES every found
  JS-eligible handler once in-process (plain ESM import() + WHATWG Request,
  no sockets, no transpile) and reports status/ok/bodyBytes/ms as a note,
  or honest not-executed reasons for .ts/.deno (no-transpile), missing
  default-{fetch} interface, and throwing handlers — probes are evidence,
  never a throw. 5 new tests; 148/148. **v0.3 "the ecosystem": plugins API + builder presets.**
  Both PRD lines closed. Plugins (`config plugins: [npm-name | './file.js']`):
  importable ESM scenario modules through the SAME contract as packs/libraries
  (src/plugins/loader.js), resolved against the config file's dir; contract-
  broken or unresolvable listings fail the run loudly naming the plugin;
  cross-surface name collisions carry the earlier origin; wired into cmdRun
  and merged into the same sorted campaign + module-plan blob. Presets
  (`crashtest preset lovable|bolt|replit [--root dir]`): detect-first, NO
  builder-name fiction — researched the actual export shapes first (primary
  docs; Lovable = Supabase Edge Functions with TWO documented module
  interfaces, Bolt = managed edge functions with no portable source doc,
  Replit = project-specific server named by .replit), so presets detect the
  supabase/ layout, TanStack Start markers, .replit run command and package
  shape, and WARN plainly when nothing resolvable exists (static-SPA exports,
  listening-server-vs-handler, TS/Deno-must-be-shimmed). detect() findings
  carry file evidence; an invalid package.json warns, never silently ignored.
  Help text + README + DEPLOY updated (rule 7 held: nothing documented that the
  CLI doesn't do). 16 new tests incl. an end-to-end plugins-knob run landing a
  canary attack in the ledger at exit 0. Suite 143/143. **Back to building: harness memory reuse (PRD v0.2 open
  line) + web round shipped.** Web/docs detour closed out first: sidebar nav
  shell, consistency + parity probes (28 new tests), live-audit fixes
  (version-function registry 406, pagefind import.meta, WCAG contrast,
  JSON-LD bare-object drop) — committed f181045, upstream prestruct #21 +
  freestruct #15/#16. Then v0.2: freezeTo()/restoreTo()/runFresh() on the
  harness (memory reuse for sub-second repeat runs, PRD line 136) — deep
  snapshot of every KV store, D1 table row set + nextId + uniques, and op
  counters; restore mutates bindings IN PLACE because the fake backends hold
  a counter identity from buildEnv (a naive clone swap silently orphaned
  every backend op tick, caught by the smoke test's op-shape assertion).
  runFresh = freeze at call time, replay, restore after — success OR throw,
  per the restore-what-you-touch rule. 4 harness tests: replay-ops identity,
  throw-path health, no-trace no-explicit-at default, junk-snapshot loud
  TypeError. 127/127 green.
- [2026-10-20 ~19Z] **Web polish round: JSON-LD fix, UI parity probe, dash
  stale-test sweep.** inject-brand.js silently emitted an empty structured-
  data block when ssr.config buildJsonLd() returned a bare object (only the
  array shape was handled) - fixed to accept object / array / complete
  payload, unusable shapes still fail loudly. New test/web-ui-parity.test.js
  (7 passing): dogfood snapshot ⇄ ledger-model parity, gate exit-code
  agreement with the CLI rule, garbage/markdown shape rejection, unknown-
  verdict flagging, glyph/CSS-class sync. Existing dashboard-ledger tests
  confirmed current (14/14) after the state/enumeration-oracle skip fix.
- [2026-10-20 ~18Z] **Fiction gate round 2 (cliches), CLI onboarding, FAQ
  page, and 4 freestruct issues.** Lint iteration 2 landed: the style gate
  now hard-fails the AI-cliche list (delve/leverage/unlock/seamless/
  empower/journey/realm/game-changer/cutting-edge/revolutionary), non-
  descriptive "click here" link text, and "this section covers" placeholder
  intros - inline-code spans exempt (the style page quotes the banned words
  as code spans). CLI --help rebuilt as onboarding: quick-start block, all
  commands/flags, the exit-code contract, and a FIRST-RUN INFO section
  (arming, read-only lanes, dashboard paste target). Site: new /faq page
  (12 Q&As w/ honest answers, SEO meta, nav + home teaser grid),
  ssr.config route + priority. README/DEPLOY: module-plan step in both
  quick starts, packs scaffolding note, FAQ in docs map. 4 issues filed on
  dhaupin/freestruct (#3 sitemap strips basePath - LIVE-BROKEN on our
  deploy; #4 linkCheck never fails the build; #5 searchIndex/noindex
  semantics; #6 packaging: docs/lib layout + --out/--strict/--version
  flags). Gates 22/22 + 109/109 green.
- [2026-10-20 ~17Z] **Corpus pass + style gate flipped HARD + docs system
  built out.** The 138 tracked voice warnings became work: all 150 prose
  em/en dashes in docs/ converted to hyphens by a fence/inline-code-blind
  1:1 swap (no spacing surgery), diffs reviewed per-file; em-dash rule and
  the emoji rule (two content carve-outs: verdict marks as product
  vocabulary + the technical arrow as flow notation - everything else
  fails) are now HARD fails in check-docs-style. Docs system: new
  reference/module-plan page (fills the dead module-plan link with real
  content: statuses table, arming-machine explanation, plan-blob shape),
  new about/style voice page (documents all enforced rules + the myth
  signatures + the wanted-not-yet-enforced list), both in nav.yml;
  packs.md's crosslink to module-plan reinstated now that the target
  exists. Fiction gate allow-lists the style page (it documents the
  signatures by design). Gates: 22 pages, links/style/frontmatter/fiction
  all PASS at hard settings. 109/109 tests, check exit 0.
- [2026-10-20 ~16Z] **Vant's docs-audit suite ported (scripts/ + CI).** Four
  gates adopted from vant main, each adapted to this repo's rules:
  check-docs-frontmatter (4 required fields; baseurl-relative permalinks —
  leading-slash or baked-in /crashtest is the doubled-prefix fiction class,
  `/` reserved for the docs home), check-docs-links (fence/inline-code
  aware link graph vs frontmatter permalinks incl. doubled-prefix
  signatures), check-docs-style (fence language tags, heading skips,
  whitespace, pipe-table shape as HARD fails; em-dash/emoji as WARNs only
  — vant's hyphen-voice is a corpus pass we have not made; verdict marks
  are content), check-fiction-signatures (forward-dated release claims,
  global-install fiction, sockets-allowed claims, web-deps conflation;
  debunk-negation aware; ledger/PRD quote-fiction by design so they're
  allow-listed). Wired as `npm run lint:docs` + a ci.yml step. First run's
  hard findings: 2 missing fence language tags (run-roots, packs) — fixed;
  links gate would have caught last session's dead module-plan link
  mechanically. All four PASS (20 pages, 113 files, 138 voice warnings
  tracked). package.json stays `files: [bin, src]` — scripts are dev
  tooling, not shipped surface.
- [2026-10-20 ~15Z] **Docs audit: the doubled-prefix fix + full link/frontmatter
  sweep.** Live site served nav as /crashtest/crashtest/* (404s) — the layout
  piped nav URLs (already absolute, /crashtest-prefixed) through Jekyll's
  `relative_url`, which prepends baseurl a second time. Fix: emit item.url
  raw (vant never filters its nav either). Full audit script (frontmatter
  required keys × all pages, nav.yml↔permalink reachability, internal-link
  graph incl. doubled prefixes + raw .md links) over 20 pages: 3 findings —
  the layout bug itself, docs/publish.md having no frontmatter (gained one,
  noindex'd — maintainer content, not user docs), packs.md linking a
  module-plan page that doesn't exist (demoted to a code span). Dead
  `nav_order: 0` on docs/index.md removed (sidebar order is nav.yml-driven).
  Audit re-run: CLEAN. **Docs parity with vant: burger nav + pagefind search.**
  docs.creadev.org/crashtest was rendering the nav inline with no search —
  gap: the layout shipped "same shape as vant, minus pagefind/prism extras"
  and the extras were the UX. Ported vant's shape onto the crashtest
  theme: fixed header (search trigger w/ Ctrl-K chip + GitHub CTA +
  hamburger), burger-toggled slide-out sidebar w/ overlay (mobile ≤768px,
  desktop keeps the fixed rail), pagefind modal search (Cmd/Ctrl+K, Esc,
  5-result cap) with an HONEST downgrade message when the index isn't
  deployed. Workflow got vant's hardened pagefind steps verbatim:
  token-authenticated release scrape (rate-limit lesson), validate the
  tag before download (404-HTML-as-tarball lesson), index built into
  _site BEFORE freestruct runs. Layout JS parse-verified; workflow YAML
  parse-verified. Push → docs.yml path-filter fires the build.
- [2026-10-20 ~13Z] **Repo hygiene button-up (pre-v0.4 pause sweep).** Full
  git history scanned for secret-shaped strings (token/PK/AKIA xox"); zero
  hits — no secret ever landed. .gitignore hardened: `.env`/`.env.*` with
  `!.env.example` defense (CLI reads no env secrets — maintainer sandboxes
  only), web build artifacts (dist/, .prestruct/, web/node_modules/) folded
  into the root ignore. New `.ignore` (ripgrep-shaped): keeps node_modules,
  dist, cache, tarballs, and lockfiles OUT of code_search/grep so the
  search tool reads the product, not the vendor tree. Docs stayed
  truth-checked instead of example-filed: crashtest.config.js (fake env,
  .local URL), ssr.config.js (public site identity — its .example twin
  exists and the tracked-with-reason note is in web/.gitignore). wrangler:
  none in repo — Pages config is public _headers/_redirects. PRD §14
  sequencing updated (v0.3 shipped, v0.4-early flag set shipped, §15 = the
  v0.5 lane); §15 verified end-to-end as the next-stage contract. 109/109
  tests still green after the hygiene pass.
- [2026-10-20 ~12Z] **§14 flag set complete + the hosted lane gated (PRD
  §15).** Thread A: `run --expect-baseline <path>` — read-only ledger diff,
  no `labs/` writes at all, §7 exit rules unchanged, missing/non-schema-1
  baseline = honest exit 2. Tests: green read-only diff (labs/ provably
  absent + baseline byte-identical across two runs), regression gate fires
  (exit 1 on a REFUSED→EXPLOITED flip via an unhydrated leaking route),
  bad-ledger exit 2. 12/12 cli tests. Docs: DEPLOY.md (read-only gates
  recipe), docs/reference/exit-rules.md (§RA read-only diffs). Also prepped
  the GH Marketplace shape without publishing: `action.yml` gained a
  `version` input pinning the installed crashtest (`crashtest${{ '@' }}ver`,
  empty = latest), DEPLOY.md documents it — listing itself deferred until
  v1.0.0 per maintainer call. Thread C: PRD §15 sketch locked as the design
  gate (webhook surface table, the four-invocation runner command set,
  ledger-hosting read-only-first, `/crashtest accept` opens a ledger PR
  instead of hosting service-side state, §13 replay-prove before any hosted
  accepted-risks). Nothing hosted ships yet — this log + §15 is the contract.
- [2026-10-20 ~11Z] **Docs sweep — README rewritten, AGENTS.md + DEPLOY.md
  born, all crosslinked.** Polished against the real CLI (no-fiction pass):
  README now leads with the 60-second usage, real module names with their
  shipped oracles, docs map; AGENTS.md carries the one law, layout, seven
  paid-for house rules, scenario contract summary, release procedure,
  vant/rook memory conventions, gistory port backlog; DEPLOY.md is the user
  path (init → config → run → baseline → CI action) plus maintainer OIDC
  release flow and a troubleshooting table built from today's real run logs
  (E404 stage-only default, tag re-push retry, must-end express rule,
  timestamp churn, shallow-copy proto note). Every documented command
  verified before landing (init artifacts, exit 2 on missing/bad config,
  dogfood exit 0). Code touch: config `modules` filter now flows through
  cmdRun (runner's opts.modules was CLI-dark).
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
- [2026-10-20T04:10Z] First real external adoption test done: crashtest 0.1.0
  (tarball, real `npm install`) driven against a test install of vant's raw
  `http.createServer` server (`_handleRequest`), authRequired ON, real `/call`
  MCP door + status endpoints, in-process via the new node adapter surface.
  Crashtest bugs found + fixed at cause, all regression-tested (61/61 green,
  `check`+dogfood exit 0):

  - bare `./adapters` subpath `ERR_PACKAGE_PATH_NOT_EXPORTED` → explicit export
    alias; registry re-exports registerExpress/registerFastify/registerHono/
    registerNodeDispatch/dispatchNodeRequest.
  - fake req missed the event-style raw-server surface vant touches
    (`req.setTimeout`, `req.on('data'/'end')`, `req.destroy`) → toNodeReq is now
    a real mini-Node req (EventEmitter, nextTick body events, record-and-forget
    idle guard, listener-dropping destroy). Fixed the vant-pass phantom
    `Unhandled Rejection: req.destroy is not a function` too.
  - `dispatchNodeRequest` (new export) lost the drain-to-res.end semantics on
    first cut and read the res before event handlers ended it → bounded drain
    restored, races the WHOLE settle against the timeout cap.
  - `state/id-collision-alias` crashed (`harness.env.DB.snapshot` undefined) on
    targets with no DB binding instead of refusing gracefully → skips with a
    "declare env.DB" hint like its siblings.

  VANT findings (filed from the labs/hardening.md report of the fixed-wire run;
  run-1 REFUSEDs on the same attacks were false-passes from the broken wire):

  - guard/hygiene: 2xx writes over POST /call ship NO Cache-Control (shared
    caches may replay writes).
  - burst abuse: 11/50 handled requests 500'd mid-burst (5xx at request 39)
    instead of shedding with 429 — vant's own QoS limiter logged
    "Global rate exceeded: 60/60" but requests still failed as 500.
  - never-fail-mutations: 64/64 hostile bodies → 500 (first: {"id":2147483648})
    instead of 400-class rejection.
  - credential-stuffing (60/60) and storage-fill (30/30) under load likewise
    land as 500s, not honest refusals.

  Good refusals that held: oversize 413, foreign-id oracle denied, proto
  pollution did not stick, escal/spoof secrets never left the env.

  File changes this session (uncommitted): package.json (./adapters export),
  src/adapters/index.js (re-exports), src/adapters/express.js (mini-Node req,
  drainUntil, dispatchNodeRequest), DEPLOY.md (node-adapter recipe),
  test/v02.test.js (2 new regression tests). Remember cli.js `modules` +
  docs sweep from earlier this session are also riding along.
- [2026-10-20T05:05Z] Adapter-learnings wave shipped on crashtest itself (all
  learned against REAL frameworks + the vant box, regression-tested 61/61):
  - `routeAliases` config knob + `harness.aliasRoute()` + `rewriteRequest`
    (path/query-pass-through/method, `duplex:'half'` for streamed bodies):
    maps the scenario vocabulary onto the real paths of ONE dispatching app —
    the exact friction that made the first framework smoke report
    harness-faults-as-EXPLOITED.
  - `registerRoute` now throws on duplicate names (silent overwrite =
    requests leaking to the wrong handler, house rule: fail at cause).
  - `toNodeReq` is a REAL streams.Readable now: express internals
    (finalhandler.unpipe) touch raw stream state; EventEmitter stand-ins
    crash. Idle-guard setTimeout stays record-and-forget (no wire, no lie).
  - express adapter builds a REAL `http.ServerResponse` on its own socket
    PassThrough (express re-prototypes the fake res onto its chain; shared
    socket stalls OutgoingMessage._writeRaw flush; separate res socket
    mirrors real HTTP). Verified: full 404/finalhandler error path settles.
  - express path: winner timer is cleared (no unhandled rejections).
  - Real-framework smokes (tarball install): express 13/13 REFUSED, fastify
    13/13 REFUSED, hono 12/13 (the 1 EXPLOITED = the test app's own
    500-on-hostile-shape — scanner working).
- [2026-10-20T05:05Z] Site shipped: `web/` (prestruct scaffold copied from
  dhaupin/prestruct init, identity-retuned) — React+Vite, prerendered SEO
  (/, /attacks, 404, sitemap), Bolete-inspired dark lab theme, Pages
  Function `web/functions/api/version.js` (live npm version + provenance,
  edge-cached 5m). Build: `cd web && npm run build` → `web/dist` for
  crashtest.creadev.org. Site is a separate workspace: npm package
  `files` must stay /web-free (checked). Notes: prestruct's init template
  lacks example/vite.config.js — without plugin-react the classic JSX
  runtime breaks prerender with "React is not defined" (copied the config).
- [2026-10-20T05:05Z] vant issues filed: #214 (Cache-Control missing on
  /call writes), #215 (500-instead-of-429/400 under burst/hostile/stuffing/
  fill — throw-based chain lands guard outcomes as server faults). gh app
  auth can create but not edit issues (403 "not accessible by integration")
  — edit #214's one garbled sentence manually when convenient.
- [2026-10-20T05:05Z] Version bumped 0.1.0 → 0.1.1 (package.json +
  src/cli.js VERSION) for the next tag when the user wants to ship.
- [2026-10-20T06:30Z] Site theme bug found + fixed live (crashtest.creadev.org
  / crashtest.pages.dev): prerendered pages shipped WITHOUT theme — root
  cause is a SECOND init-vs-example gap in prestruct: `init/index.html`
  lacks the example's module entry script
  `<script type="module" src="/src/main.jsx">`, so vite build emitted
  nothing from the app graph (no JS bundle, no CSS; only the manualChunks
  vendor file trickled out) and inject-brand+prerender "succeeded" into
  fully-rendered, fully-unstyled HTML. Fixed by restoring the entry tag in
  web/index.html (with an explanatory comment), rebuilt, verified hashed
  script+stylesheet on index/attacks and stylesheet-only on 404 (scripts
  stripped there by prerender design). Committed c7811ee + pushed; CF
  redeploy picks it up. Upstream note intended for prestruct#20 (same
  issues-write-but-no-edit/comment integration limits as vant #214):
  suggested there too — build-time check in inject-brand/prerender that
  dist/assets holds an index-*.js + .css pair, else fail loudly.
- [2026-10-20T07:15Z] Black-screen bug on the live site fixed (reproduced in
  headless Chromium on crashtest.creadev.org, mobile viewport, iPhone UA):
  first paint = prerendered SSR + stylesheet (the "flash of theme"), then the
  client bundle threw React error #321 (invalid hook call) —
  usePageMeta (a hook) was being called INSIDE useEffect in both
  web/src/pages/Home.jsx and Attacks.jsx. Hooks may only run in the
  component body; with no error boundary React 18 unmounts the entire tree,
  leaving #root empty on the dark body bg = "rendered black". Fixed by
  calling the hook in the component body (its own effect handles the head
  tags), rebuilt, verified all three routes hydration-clean with zero page
  errors (local Chromium). Commit a972142.
- [2026-10-20T07:15Z] /api/version 502 at platform layer (plain-text
  "error code: 502", not our JSON): dropped the `cf` fetch option from
  web/functions/api/version.js as the likely cause; edge cache now comes
  from the response cache-control. Zone-level noise noted: Zaraz injects a
  GA tag (G-C454VG9F3M → doubleclick/ads) that the site CSP correctly
  blocks — user-side Zaraz/CSP tweak if they want GA live.
- [2026-10-20T05:30Z] Web presence hardening pass (user: "we need web to be
  solid" — dashboard-able): icon set generated with the same Chromium that
  verified the site (icon.svg hand-drawn crash-shield glyph -> favicon-32,
  apple-touch, icon-192/512 PNGs); og-image.png (1200x630 lab card, real
  headings + verdict chips) baked via Playwright; ssr.config ogImage wires
  og:image + twitter:image into every prerendered page; site.webmanifest
  with dark theme colors; robots.txt with sitemap pointer (was relying on
  CF's synthesized one); <meta name="theme-color"> + CSS color-scheme:
  dark so mobile chrome matches the lab palette. Layout QA programmatic
  (Chromium): zero horizontal overflow on mobile (390px) and desktop its
  (1280px) on / and /attacks — scroll containers behave, nav on one line,
  zero page errors. All a11y-relevant details leave in styles.css.
  Icons/manifest/og artifacts live in web/public — graft naturally into
  future dashboard (PWA-grade identity ready).
- [2026-10-20T06:05Z] Site content wave + real docs system shipped:
  - /terms + /privacy pages (Routes+ssr routes, plain-language OSS legal:
    for / not-for, no warranty to the max extent of law, findings belong
    to the user, host/third parties named, CLI collects nothing), crosslinked
    from the footer on every content page.
  - Footer carries the do-follow made-by link (Made by Rook @ Creadev.org,
    target _blank rel=noopener — no nofollow), plus Docs link to
    docs.creadev.org/crashtest in footer AND nav.
  - Copy/truth pass: CLI help no longer sells the fictional v0.1 "redteam/
    fuzz/barrage" campaign list (now the real module set + docs/site URLs);
    garbled wording fixed in docs/config.md (UNIQUE line, mustDenyIds ctx)
    and docs/playbooks/express.md heading; Home CTAs lead to the docs
    quick start now (enterprise-welcoming, not scary).
  - docs/ born: Jekyll structure mirroring vant's docs (config baseurl
    /crashtest, _data/nav.yml freestruct-layer nav, lean layout, index +
    getting-started [index/quick-start/install/config] + playbooks [index/
    plain-handlers/express/hono/fastify/raw-node/github-action] + reference
    [attacks/ledger/exit-rules] + about/principles). Every claim is from
    behavior verified this session (no-fiction rule 7 held: the redteam/
    fuzz/barrage fictional help text got fixed, not copied).
  - Verified: 4/4 pages prerendered (/, /attacks, /terms, /privacy),
    404 by engine design renders from notFound config without React shell
    (footer=False there is upstream behavior, not a defect), all content
    routes footer-complete with the made-by link, zero overflow at
    390px/1280px, zero page errors; 64/64 tests + cli.test 7/7 with the
    new help text.
  - Known limitation: docs/ not built locally (no ruby/jekyll in sandbox) —
    structure mirrors vant's proven layout; GH Pages (or freestruct layer)
    builds it at docs.creadev.org/crashtest on push.
- [2026-10-20T06:55Z] freestruct wired into the Jekyll docs build (vant's
  docs.yml as the template — ruby 3.2 + bundler-cache + jekyll build +
  GH Pages artifact deploy, pagefind dropped until the layout earns a
  search UI). Two upstream findings handled en route: freestruct's npm
  name is not published and its bin shim has no shebang (both filed to
  freestruct#2; verified workaround = npm install github:dhaupin/freestruct
  + node node_modules/freestruct/docs/lib/inject.js). Docs wiring adds
  docs/ssr-config.yml (outputDir docs/_site, basePath /crashtest,
  linkCheck on), a crashtest-tailored inject template that adds ONLY the
  layer the layout lacks (twitter card, og:image from the main site card,
  SoftwareApplication JSON-LD) so inject stays dupe-free, and docs/Gemfile.
  Local end-to-end verified with a synthetic _site: injection applied,
  sitemap/robots/404 generated, exit 0. Also filed vant#217 (shadow index
  docs: operations/operations.md and runtime/runtime.md duplicate their
  section index.md titles/paths and split nav+search; same-title agents
  pair flagged as disambiguation candidates; storage pair judged a
  legitimate split). One paste-scrub note: vant#217's posted table has one
  garbled word in a permalink cell (integration cannot edit; manual fix
  worth 10 seconds). docs/_site gitignored; GH Pages build lands
  docs.creadev.org/crashtest on push.
- [2026-10-20 ~07Z] **Dashboard shipped — /dashboard renders the ledger with the
  CLI's own §7 rule.** Headless bridge, zero backend:
  `web/src/lib/ledgerModel.js` imports `diffAgainstBaseline` + `exitCode`
  straight from `src/report.js` — the page shows exactly what CI exits with,
  one copy of the rule (parity pinned by `test/dashboard-ledger.test.js`,
  12 tests: new exploited flips gate, regression detected via baseline,
  accepted risk with owner+bound never re-alarms, run-blob shape, unsupported
  shapes fail loudly). Default view = committed dogfood baseline generated
  from the REAL artifacts by `web/scripts/make-ledger-snapshot.mjs`
  (crashledger.json + hardening.md cost economics → `dogfoodSnapshot.js`;
  regen after dogfood runs change labs/). Users load their own ledger by
  paste / file upload / CORS raw GitHub URL — nothing server-side, matching
  the CLI-collects-nothing privacy story. Page: gate banner (exit 0/1),
  stat strip, findings grouped by module with verdict glyphs, per-attack
  op-economics bars, accepted-risks table. Prerendered as route #5;
  paid-for bug: prestruct's incremental cache served three asset
  generations at once after the first dashboard build — full clean rebuild
  fixed; `rm -rf .prestruct dist` is the restore ritual if assets go stale.
- [2026-10-20 ~09Z] **v0.3 WP spike LANDED + §14 platform thread opened + the
  CLI went service-shaped.** Colleague issues #1/#2 adopted from a real
  patch: wordpress adapter (NDJSON-over-stdio worker — wire format, not a
  transport; no sockets kept honest), skip-parity for undeclared routes in
  volume/input/guards (proto of it: no harness-wide bombs), 6 envelope
  contract tests. Paid-for lesson repeated: the pack first landed in
  labs/scenarios and nearly tripped the self-dogfood CI gate (workerAbsent
  → attack-threw EXPLOITED rows) — target packs live in fixtures/ beside
  examples, labs/scenarios stays the dogfood scan dir. CLI: `run --json`
  prints the machine run blob as the LAST stdout line (dashboard-compatible
  run shape) with a live sanity run (13 rows, exit 0). PRD §14 codifies the
  greptile-style CI-runner platform thread: drone CLI, ledger-as-artifact
  contract, headless dashboard alignment, sequencing to v0.5. Docs:
  playbooks/wordpress + playbooks/run-roots (the #2 runbook, generalized).
  Issues #1/#2 closed with adoption notes; 83/83 tests; pushed as 0710c84.
- [2026-10-20 ~10Z] **SELF-DOGFOOD PROOF OF CONCEPT + the first stock-WP e2e.**
  The question arrived mid-thread: "ran crashtest on itself?" Honest split —
  the demo fixture yes, the product's OWN surfaces no. Fixed in three moves:
  (1) committed dogfood re-run: 13/13 REFUSED, exit 0 (timestamps-only
  artifacts restored). (2) NEW self-target `fixtures/site/`: crashtest
  attacks its own shipped Pages Function (`web/functions/api/version.js`)
  with the registry dependency doubled — same rule the fake d1 rides
  (deps get doubles, sockets die). Pack = 5 attacks incl. hostile registry
  statuses, proto-pollution canary, burst, cache-hygiene gates,
  restore-what-you-touch parity. **The self-run caught a REAL shipped bug:
  `{"nope":true}` @ 201 registry → 200 with NO version** (the badge
  contract "200 means a version, 502 says why" was broken at the seam) —
  fixed in version.js, guarded by `site/registry-hostile-statuses`.
  CLI-level pin: `test/self-site.test.js` (temp run-root, config
  imports the real function; committed ledger untouched). 85/85 green.
  (3) STOCK-WP e2e per dhaupin's ok: PHP 8.1 + wp core + official SQLite
  drop-in; headless install cost 3 paid-for lessons: WP_INSTALLING is a
  CONSTANT (latched static — set-after-load does nothing; global trick
  also dead); wp-settings kill-point located with per-require stderr
  markers (β: wp_not_installed die() at M32 zone); install via
  wp_install() in-process, §wp-tools never needed. wp-stock-smoke (3
  attacks: hostile nopriv volley / real-SQL metering / CALL_ALLOW breach
  probe) → 16/16 REFUSED, 0 found, ops ride wp.query @2 from the real
  database. Pack landed as fixtures/wordpress/wp-stock-smoke.js + the
  headless-install recipe on the WP playbook. The §12 metric is now
  self-paying: crashtest found ≥1 real bug on the first unaudited repo —
  and that repo was OURS.
- [2026-10-20 ~11Z] **THE WP STORY WENT GENERIC + crashtest-vs-vant PoC RAN.**
  Codified the who-owns-specifics split the product demanded: worker is
  GENERIC (fields a first 'cfg' envelope: callAllow fn=>maxArgs +
  allowOptions list; state ops are plain WP primitives — posts-query /
  post-meta / option / delete-posts / insert-post / postmeta alias; khf
  names gone from plumbing, alive in the pack's own vocabulary). Adapter
  delivers the run-root's specifics once per worker; config shape gains
  callAllow/allowOptions. Class-of-1 paid-for bug caught by the e2e itself:
  callAllow referenced `fix` before init (TDZ) — the PoC run tripped first.
  Stock-WP smoke grew the option-gates attack (allowOptions deny + declared
  row whole-read — worker now returns scalars unchanged for string rows):
  17/17 REFUSED, real data read (blogname) from the real SQLite.
  WordPress-money pack rides the generic ops (khf flow e2e still needs the
  khf plugin runtime — honest limitation, unchanged).
  And the van PoC the user asked about: adapters + recipes existed; running
  against vant did NOT — now proven: a run root mounts vant's real
  Server._handleRequest via the raw-node adapter (no listen, no vant
  changes, routeAliases map the seeded vocabulary onto /call + /tools);
  full built-in suite → 13/13 REFUSED · 633 requests · exit 0. Real
  receipts: Retry-After on 50/50 throttles, honest 413 on oversized, 60/60
  stuffing refused, amplification held at 1 ops/request. Two probes
  correctly ask for declarations (CRASHTEST_SECRET to arm, env.DB.snapshot
  for alias coverage) — run roots get to be smarter next thread.
  Run-roots playbook gained the van-style raw-node recipe with the PoC
  numbers; WP playbook rewrote "who owns specifics". 85/85 green.
- [2026-10-20 ~12Z] **THE EXTENSION SURFACE: scenario packs (packs/public +
  packs/local).** The ask: user-owned defs/recipes/scenarios, private when
  wanted. Schema decision: NOT vant's models/public-private (models is
  AI/ML-adjacent vocabulary; packs is crashtest's own word) — pack.json v1
  (schemaVersion/name/description/entry) living under packs/public/<name>/
  (tracked, shipped examples) or packs/local/<name>/ (gitignored,
  machine-private). Loader src/packs/loader.js: loud manifests (rule 3),
  kebab names, shared name-collision guard against built-ins and between
  visibility dirs, contract-validated entries. `crashtest run` merges pack
  modules automatically (config knob packs: true|false|custom-roots;
  dogfood opts OUT so shipped packs never ride the demo gate);
  `crashtest init` scaffolds packs/ stubs + root .gitignore entry;
  `crashtest packs` inventories with visibility@version/counts. The khf
  "money-path e2e" question is now answered structurally: khf flows are a
  PRIVATE PACK on khf's own run root — no e2e for them in this repo by
  design, and the extra e2e limitation line is retired with the old
  fixtures/wordpress/wordpress-money.js (promoted to packs/public as THE
  example pack alongside wp-stock-smoke; worker/adapter untouched). Docs:
  reference/packs page + nav + playbook links + AGENTS layout. 91/91
  green; dogfood gate stays 13/13 with packs:false; WP stock run-root e2e
  unaffected (17/17).

### 2026-10-20 — wp-money-shapes: the shipped money pack is now plugin-agnostic
- Question that drove it: "is wordpress-money general, or khf/fm lore?" Honest
  answer: attack SHAPES were general, vocabulary was khf-specific — wrong
  bucket for a public pack.
- Rework: `packs/public/wordpress-money/` → `packs/public/wp-money-shapes/`
  (@0.3.0). Zero plugin names in the pack; every vocabulary item (postType,
  metaPaid, metaEmail, optionKey, action, nonceAction, pacedHints) comes from
  `moduleCtx['wp-money-shapes']` in the target's run-root config. Missing keys
  degrade to a REFUSED skip (skip-parity, never a false positive).
- The khf/fm instantiations are these engines rebinding their own vocabulary in
  their run root's `packs/local/` — private pack, by design, never in repo.
- Fixed along the way: JS comments inside pack.json (JSON forbids them) caught
  by the loader's own loud manifest check — exactly the failure mode it exists for.
- Verified: 91/91 tests, check exit 0, packs verb lists both packs, dogfood 13/13
  with packs:false (gate decoupled), no stale references outside TASKS history.

### 2026-10-20 — `packs add`: the first-user path is one command
- User question answered with receipts: "why wp-money-shapes / what's the
  money?" — naming convention now documented (prefix = the surface the pack
  SPEAKS, wp- rides harness.wpState), and "money" = the dollar-shaped abuse
  family the volume library alreadyowns (credential-stuffing /
  cost-amplification): write-with-value must not stick, one receipt must not
  buy two, metered wall must trip.
- Vant decision: NO packs/public/vant-* branded by target. Vant's generic
  surface is already covered by built-ins (run-root recipe, 13/13 REFUSED,
  zero custom code); vant-specific lore (brain endpoints, identity-file
  guards) is instance lore = packs/local in vant's run root. Decision rule
  documented in docs/reference/packs.md.
- Delivered the general mechanism instead: `crashtest packs add <name>
  [--public]` — schema-v1 manifest + contract-valid stub module + gitignore
  append (local), loud refusals on collisions/bad names. vant's first
  private pack is now literally one command on the vant run root.
- Fixed at cause along the way: process.exitCode delete→assign in tests,
  strict-assert has no assert.exists, the runtime's leftover refuse-exit
  leaking into the test runner's status.
- Verified: 94/94 tests (3 new packs-add tests), check exit 0, live packs add
  local+public from a tmp cwd, dogfood gate decoupled 13/13.

### 2026-10-20 — `run --module-plan`: the coverage dry-run (PRD §14 service flag)
- Which attack ids WOULD fire against this target, before any request — same
  loaders, same filters, same arming rules as the real run (shared code, no
  drift possible). Three statuses: WILL-FIRE / NEEDS-ARMING / SKIPPED-FILTER.
- Arming keys travel with the pack: module-level `armedByKey` export or pack
  manifest `armedByKey`, checked against `moduleCtx[<key>]`. Shipped
  wp-money-shapes + the packs-add stub declare theirs; a module's explicit
  `armedByKey: null` disables detection (precedence = module wins when present).
- NEEDS-ARMING rows are the honest gate: un-armed packs REFUSE-skip at run
  time (skip-parity, never false positives) — the plan surfaces them BEFORE
  you trust a green tally, which is the whole point of the flag.
- `--json` prints the plan blob as the LAST stdout line (same discipline as
  `run --json`) — the CI artifact the dashboard ate in the same session.
- Verified: 101/101 tests (7 new), check exit 0 with src/plans.js +
  test/module-plan.test.js in the inventory, live dry-run vs the dogfood config
  (13/13 WILL-FIRE, packs correctly absent via packs:false), exit 0 informational.

### 2026-10-20 — packs npm metadata (offline-first) + `packs --json`
- npm metadata now travels WITH the pack: optional `"package"` field in
  pack.json (string-validated, loud on wrong type) shown in the packs verb
  inline and inventoried by `crashtest packs --json` (LAST stdout line, same
  discipline as `run --json`) alongside version/entry/armedByKey.
- Deliberate boundary: the REGISTRY LOOKUP stays in npm's own tools — the CLI
  is a drone that never dials (PRD §14 binding line). The docs carry the CI
  recipe: pair `packs --json` with `npm view <pkg> version` and fail on drift.
- Two real bugs fixed at cause on the way: my main() route dropped the
  closing brace of the packs branch (parse broke at the file's trailing
  export — caught by --check) and a ternary that silently discarded the
  --json flag when no --config was passed (caught by the new test).
- Verified: 103/103 tests, check exit 0, live verb shows armedBy hints +
  JSON inventory for both shipped packs.

### 2026-10-20 — dashboard v2: the coverage-plan surface
- The dashboard now accepts all three artifact kinds a run root can emit:
  ledger (findings + §7 gate), run blob (single-run), and NEW the
  `run --module-plan --json` coverage plan — shape-detected, one adapter
  each, loud errors when a shape fits none.
- Plan view: WILL-FIRE / NEEDS-ARMING / SKIPPED-FILTER totals strip, per-
  module cards with the arming reason inline, and a packs inventory table
  (visibility, version, origin, attacks, armedByKey, npm package). No gate
  verdict on plans by design: they attack nothing, so they never pass/fail CI.
- Same honesty rules as findings: unknown statuses are FLAGGED, never
  silently relabeled; the plan bridge refuses ledgers and vice versa.
- Ledger bridge stays pure/testable (parsePlan in ledgerModel.js); pinned by
  3 new node-test cases + a live crosscheck: real CLI plan blob → parsePlan
  (13/13 will-fire) while the ledger still parses with gate pass, and the
  plan bridge loudly rejects a ledger.
- CSS: chip vocabulary reuses the existing moss/err/ink-soft tokens; page
  JSX verified parse-clean via esbuild (no build run needed).
- Verified: 105/105 tests, check exit 0, CLI plan blob round-trips through
  the bridge exactly as CI would paste it.
