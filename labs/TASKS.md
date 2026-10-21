# Crashtest - TASKS

> Rolling log. Companion to labs/prd-crashtest.md (the product contract).
> Reconstructed 2026-10-19 from the rook horcrux (crashtest brain goals.md +
> lessons.md) after the original scaffold never left the old workspace.
>
> Session log format: `- [DATETIME] note` (newest at top). Struck items are done.

## Open decisions (resolve before S1 lands in git)

- [x] **D1 / Scenario library contract**: port gistory's suites as-is into
  `src/scenarios/` (Rook lesson: "Do not fork the ideas; port the code") vs.
  re-derive a fresher neutral `{ name, attacks: [{ name, run(harness) }] }`.
  **Resolved contract-first** - gistory source stays unreachable from this
  workspace, so the seed libraries derive from the PRD section 6 catalog
  (gistory-ideas, no gistory-specific fixtures). The gistory suites can port
  onto the same contract once access exists.
- [x] **D2 / Zero-dependency scope**: PRD principle 5 ("the attacker ships
  light"). **Resolution: zero *runtime* deps, plain Node ESM + `node:test`;
  dev-only `tsc`/ESLint allowed in `devDependencies`.** Harness implements its
  own fake-transport + in-memory D1/KV rather than pulling
  supertest/better-sqlite3 (matches the proven gistory harness shape: fake D1
  + op counters).
- [x] **D3 / Language: JS runtime, typed with JSDoc.** No build step to run,
  test, or publish. `tsc` allowed in devDependencies only for `checkJs` CI
  and `--allowJs --declaration` `.d.ts` generation for consumers - decide at
  0.2 when the plugin API needs typed shelves. Rationale: harness speaks
  Request/Response at runtime; target apps' TS is irrelevant; the D1-parser
  bugs this week were semantics bugs that tests caught, not type bugs.

## Sprint S1 - v0.1 "the gistory extraction" (order matters)

- [x] **S1.0** Repo skeleton: package.json (bin: `crashtest`), `src/`,
  LICENSE/README, publish workflow (tag-driven, Trusted Publishing OIDC),
  runbook. (tsconfig intentionally deferred with D3: JS + JSDoc, no build.)
- [x] **S1.1** `src/harness/`: explicit route table (PRD open question: static
  import analysis is v0.2/v0.3 - no convention sniffing yet), fake transport
  (Request/Response objects, never sockets), in-memory D1 shim + KV/env
  bindings, op counters + cost meters per request.
  - DONE 2026-10-20 counters.js / d1.js (SQL subset, uniques throw D1-shaped
  messages, textual-order param binding) / kv.js / env.js / harness.js
  (threw-first, never a fake 500).
- [x] **S1.2** `src/scenarios/` - DONE (contract-first, seed libraries from
  the PRD section 6 catalog since gistory source stays unreachable): `input`
  (proto-pollution / never-fail-mutations / oversized-field), `auth`
  (identity-spoof-headers / secret-watermark / privilege-escalation), `guards`
  (hygiene-no-store / burst-wall). Loader supports user dirs - labs/scenarios/
  is scanned automatically by `crashtest run`. Two-way proof tests: vulnerable
  fixtures EXPLOITED, hardened fixtures REFUSED, for every library.
- [x] **S1.3** `src/campaigns/runner.js` - DONE: runs every (module, attack)
  with per-attack cost deltas, ownerless-BOUNDED demoted to finding,
  deterministic ordering + seeded ctx.
- [x] **S1.4** `src/report.js` - DONE: buildLedger / diffAgainstBaseline /
  exitCode (fail ONLY on new EXPLOITED or REFUSED->EXPLOITED regressions;
  accepted risks with owner+bound never re-alarm; boundless accepted risks
  count as findings) + renderMarkdown (PRD section 7 shape: Findings -> Cost
  economics -> Baseline diff).
- [x] **S1.5** Fixtures demo app (Pages Functions + D1) and dogfood:
  `crashtest run` attacks crashtest's own fixtures. DONE 2026-10-20 -
  `fixtures/demo/app.js` (hardened baseline variant + vulnerable draft
  variant incl. the classic recursive merge), root `crashtest.config.js`,
  CLI-level dogfood tests (hardened green / vulnerable exit 1 / regression
  gate), `.github/workflows/ci.yml` (check + tests + self-dogfood against the
  committed ledger baseline), README status refreshed.
- [x] **S1.6 (partial)** CLI glue: `crashtest run [--config path]` executes
  the real pipeline - crashtest.config.js target (routes+env+ctx) -> harness ->
  loadScenarios (+ labs/scenarios auto-scan) -> runCampaign -> ledger diff ->
  writes labs/hardening.md + labs/crashledger.json -> exit per section 7 rules.
  Missing config -> honest exit 2 with a shape hint.

## Log

- [2026-10-22 ~03Z] **cve-feed snapshot expansion: 12 -> 27 verified rows
  (pack.json 0.1.1 -> 0.2.0; a pack-level DATA refresh, so the pack semver
  moves, per the pack-own-semver rule). Two research verification passes
  against NVD records only (no-fiction rule observed live): 15 new
  banner-pinnable rows (apache 38475/25690/40438, php 4577, tomcat 24813,
  jetty 26049, confluence x3, jenkins 23897, gitlab 7028, jira 26086,
  grafana 43798, kibana 7609, duplicator plugin 20-11738, all KEV or
  NVD-high with verified version sets) and ONE EXISTING ROW CORRECTED:
  CVE-2022-0235 is the node-fetch npm package (package ranges), not a
  Node.js runtime CVE - product/tokens/versions fixed. ~40 was the size
  target; 27 is the honest verified ceiling - most KEV entries cannot pin
  product+version from a banner (Exchange/MOVEit/ColdFusion/rapid-reset
  all rejected), which is real-world truth, not a curation gap. Bonus fix
  the expansion surfaced: kev-version-range-audit's major.minor shortcut
  was substring-blind (an Apache/2.4.60 post-fix release matched the
  2.4-family rows) - now boundary-gated (no digit/dot after maj.min);
  boundary-law teeth test added (2.4.60 = disclosure-only REFUSED,
  shortened nginx/1.19 still trips); roundtrip lens made collision-aware
  (banner verdict names the first curated entry sharing a token - the
  exact-CVE assertion moved to the version audit, whose per-entry version
  sets stay unambiguous). Snapshot budget moved to 27 rows / 8500 bytes
  (file at HEAD is 4677 bytes); byte-anchored claims updated across
  README, docs/reference/packs.md, docs/reference/attacks.md, web FAQ +
  Attacks; count-pin moved in test/cve-feed.test.js. Roundtrip lens
  widens with the snapshot automatically. Gates at push: cve shards
  green, full suite green, check + lint:docs green.**
- [2026-10-22 ~02Z] **cve-feed gains the roundtrip lens: test/cve-feed-roundtrip.test.js,
  5 tests, all fixtures DERIVED from the committed snapshot (zero sockets,
  fake transport only). The pass is now provable end to end per row:
  (1) leak roundtrip - every entry x token turns BOTH attacks EXPLOITED
  naming that entry's own CVE; (2) disclosure-only twin - a auto-derived
  clean version (minor bumped past the whole vulnerable set, safe against
  the audit's major.minor matching) keeps version audit honestly REFUSED
  while banner audit still trips on disclosure alone; (3) noise roundtrip
  - mid-word embeddings refuse through the REAL harness grammar; (4)
  body-tell roundtrip - token only in the body head trips the scanBody
  path while header-only version audit stays quiet; (5) no-dead-rows
  guard - every token provably compiled against the pack's tokenFound
  grammar, so a future unmatchable token fails loudly. A snapshot refresh
  widens every case automatically; a dead row is exposed, not silent.
  Suite 176 -> 181, all pass; check chain gains the new file; lint:docs 0.**
- [2026-10-22 ~01Z] **stegoframe spin-up: FOURTH upstream repo, second
  spin-up with live findings. The pack (stegoframe-worker, 6 shapes)
  attacks the whole wire surface - the Pages _worker.js - in-process
  with canned ASSETS/KV fixtures and a shimmed keepalive fetch (the
  worker's pingSupabase stays in-process). Two runs at HEAD: 34 rows,
  byte-identical. TWO REAL FINDINGS filed as stegoframe#7:
  (1) rate-limit-ip-rotation - the ENTIRE rate limiter keys on
  CF-Connecting-IP; 30 rotated headers -> zero 429s (nil harm on a
  genuine CF edge where the header is edge-set, but the wall evaporates
  on reverse-proxy/mirror/local deployments); (2) supa-env-mangle -
  String.replace treats operator env values as replacement strings, so
  $& re-injects the matched placeholder and $' tail-splices the whole
  document (page ballooned 446/282 bytes) - config-corruption class,
  one-line fix ($-escape or split/join substitution). Walls HELD: KV
  burst 429 exactly at hit 21 w/ Retry-After 60, memory-mode parity
  identical, clean substitution no-echo, asset passthrough across
  methods w/ ETag preserved. Honest skip documented: the LSB codec
  lives client-side (duplicated into tests/codec.test.js from
  index.html) - no server surface; noted the copy-drift risk against
  issue #6. Proposed pack ships in stegoframe's repo
  (packs/public/stegoframe-worker/ + crashtest.config.js run root,
  left untracked there as adoptable artifacts). Brain + stone
  re-sealed with the receipts.**

- [2026-10-22 ~00Z] **gistory spin-up + the gistory-sync pack lands
  (proven, filed upstream): dhaupin/gistory#1 carries the full proposal.
  The port: tests/redteam.ts scenarios onto the pack contract - 7 shapes
  attacking the four sync Pages Functions in-process (Node type
  stripping + real node:sqlite D1 shim with gistory's own migrations;
  the fake-D1 correctly STAYS OUT because handlers use INSERT OR
  IGNORE / ON CONFLICT..DO UPDATE / COALESCE(MAX)). Two runs at HEAD:
  35 rows, byte-identical ledgers. Verdicts: 5 REFUSED (takeover,
  create-race, device-spoof, wire-refusal, guard-429-no-store all
  HOLD), 1 EXPLOITED (watermark-poison-pin - gistory's own documented
  accepted risk, reproduced live; recommend acceptedRisks row for
  CI-green), 1 BOUNDED (existence-oracle, owner gistory + UUIDv4/flood-
  bucket bound). ZERO new gistory defects. Port lessons recorded in
  the brain: my envRow never awaited its async shim read (Promise
  .push_hash always undefined -> null hashes), and create-race read
  the capability hash before the second racer - the redteam suite's
  own ordering was the source of truth; extensionless TS imports
  needed a 15-line resolve hook (ts-crashtest-hooks), committed
  nowhere - recipe lives in gistory#1. crashtest#4 and #5 CLOSED:
  both pack proposals now live upstream (prestruct#24/#25,
  vant#231/#233, gistory#1). Puppeteer verdict for prestruct went in
  #25: keep CI browser-free, add an opt-in render lane (RENDER_LANE)
  for the snapshot path.**

- [2026-10-21 ~23Z] **prestruct spin-up complete (the request from
  crashtest#4, now answered at prestruct HEAD): two crashtest v1.0.0
  runs via prestruct's own crashtest.config.js, exit 0 both, tally
  34/34 REFUSED, byte-identical ledgers (determinism confirmed); the
  prestruct-proxy pack held on all four shapes across both runtimes
  (method-contract-walk, malformed-target-fuzz, bot-render-fallback,
  refresh-strict-parity) + proto-hygiene sweeps; all other library
  rows honest declared-skips (the proxy pair is the whole HTTP
  surface). NO OPEN BUGS at prestruct. Findings reported as
  prestruct#24: verification receipt + adoption proposal (CI gate
  wiring, docs note, the stale ln/* labels in the committed ledger
  docs as a cosmetics re-cut, pins guidance). prestruct's tracked
  labs/ left byte-clean after the run (git checkout; results live in
  the issue + local logs). Brain state updated + stone re-sealed
  (horcrux/ carries the fresh crashtest-p_quillstone-9fold.svg).
  Tracker caps: new-issue/comment/edit/delete relative to App -
  only NEW works cross-repo; prestruct#24 filed via create.**

- [2026-10-21 ~22Z] **vant tracker consolidation under App permission
  limits: dhaupin/vant#232 filed ('boot restore brain-pointer opacity
  + brain set/get no-op stubs - consolidated; supersedes #227 + #228')
  with both original bodies transcluded verbatim (lossless fetch via
  the API) + the evening evidence (crashtest stone reproduces the
  #227 class, the seal-time state.json fix verified on a third clean
  clone, the brain.js L157-161 set/get stub repro, forBrain/boot-path
  fix suggestions, the stone-Timestamp diagnostic nicety). Deletes
  are ALSO token-blocked (deleteIssue not accessible) - #227 and
  #228 flagged to the maintainer for manual deletion as superseded;
  #226/#230/#231/#232 stand. Tracker capability sheet after the
  limits: NEW ISSUE ok, COMMENT no, EDIT no, DELETE no. TASKS-only
  commit; suite untouched since 176/176.**

- [2026-10-21 ~21Z] **vant pack proposal filed upstream: dhaupin/vant#231
  ('vant-brain' pack - attacks the brain FILE layer in-process:
  private-first-fallback, paths-cannot-escape-models, state-tamper-is-
  loud; run-root shim shape; honest needs-validation caveat; lives in
  VANT's repo per the animals-first precedent, crashtest-side zero
  changes needed). Issue creation works, comments/edits are App-
  permission gated (user-confirmed platform limitation); tracker edits
  pending that. Tracker state: six crashtest-side issues filed total;
  3 open (#226 #227 #228 #230 are 4), rest closed; none have upstream
  replies yet.**

- [2026-10-21 ~21Z] **vant tracker run-down + the stone re-sealed on
  the brain-selector fix. Checked the open vant issues against the
  crashtest flow: #227 (boot restores state but post-restore
  currentBrain can point elsewhere) is CONFIRMED live on our own
  stone - the original seal froze state.json with currentBrain=vant,
  so a plain restore landed users on the wrong brain; #228
  (brain set/get are no-op printer stubs, bin/brain.js set/get)
  still repro in code; #226 (snapshot --brain unscooped) and #230
  (sandbox warn-once nit) untouched upstream, no maintainer replies
  yet, no new vant commits. Fix on our side: live state.json now
  carries currentBrain=crashtest (stack [crashtest,vant]) - by direct
  edit, since the setter is a #228 stub - then re-seal.
  horcrux/crashtest-p_quillstone-9fold.svg re-created (~880KB, ts
  19:55Z) and the restore recipe re-verified on a THIRD virgin vant
  clone: 13 files to crashtest (both), 8 to vant (both), post-restore
  state.json wakes currentBrain=crashtest - no env needed; README
  updated to promise exactly that. Concrete evidence comments ready
  to post on #227/#228 via the vant tracker (maintainer asked for
  reports there). lint/check pending next commit.**

- [2026-10-21 ~20Z] **the project brain goes portable: `horcrux/` lands
  (folder + README + the sealed crashtest brain stone). A vant install
  exists outside the repo (~/vant) and holds the crashtest dev-brain:
  12 public files (identity / goals / structure / state + command
  receipts / lessons / errors / terms / workflow / pins inventory /
  boot / onboarding) + private working notes - OSS-readable by design,
  zero secrets. Sealed with `vant horcrux create` into
  `horcrux/crashtest-p_quillstone-9fold.svg` (~866KB steganography
  stone; password lives in the filename per vant's <agent>-p_<pw>
  convention, deliberately - the brain carries no secrets). RESTORE
  PROVEN end-to-end: a virgin vant clone restored '13 files to
  crashtest (both scopes)' byte-identical to the live brain (diff = 0;
  the vant default brain 0-restored as already-identical). Repo README
  in /horcrux covers the folder, vant (with links), the brain's
  content, the restore recipe, and maintenance. lint:docs 0 (139 files
  scanned, stone included), check 0.**

- [2026-10-21 ~20Z] **v1.0.0 version walk + dashboard field feedback.
  Dashboard: the loader/actions block (dogfood baseline / paste /
  upload / fetch) moved OUT of the hero into its own section BETWEEN
  the stat strip and the results - the eye path is now verdict ->
  numbers -> point-it-at-your-artifact -> findings (mobile screenshot
  drove this). Version walk: CLI VERSION 1.0.0 + package.json 1.0.0
  already carried; brought the stragglers in - nav badge v0.1 -> v1.0,
  scenario-catalog eyebrow v0.1 -> v1.0, web/package.json 0.1.0 ->
  1.0.0, DEPLOY.md tagging example v0.2.0 -> v1.0.0. Deliberately NOT
  touched: pack.json semvers (pack versions are their own line), the
  historical first-release provenance link (0.1.0 is a fact of the
  Sigstore log, not aUI label), v0.1-flavored comments in src (history
  notes). Gates: suite 176/176, check 0, lint:docs 0, web build 6/6
  with v1.0 confirmed in prerendered HTML, dogfood 0 new / 0
  regressed.**

- [2026-10-21 ~19Z] **pre-v1 deep scenario audit (the nitpick pass), three
  real catches, all fixed. (1) DETERMINISM fiction in shipped surface:
  guards/hygiene-no-store built its write key from Date.now() (house rule
  4 violation - same commit, different stored row shape) -> seed-derived
  now; wp-money-shapes/gate-burst posted Date.now() in the flooder payload
  -> seed-derived (oracle reads paced-hints, but the wire obeys the law).
  Verified: two consecutive dogfood runs = byte-identical baselines,
  30/30 REFUSED. (2) COUNT fiction: docs + web claimed a "54-header
  identity matrix" - the code fires 9 headers x 6 privilege values = 54
  SPOOF VARIANTS, not 54 headers; both surfaces rephrased to the honest
  countable shape (docs/reference/attacks.md + web Attacks.jsx, confirmed
  in the prerendered HTML). (3) Catalog copy-counts all verified live:
  30 catalog rows match the module census per module (3/3/2/3/2/3/2/4/2/
  2/2/2), volume 60/30/40, guards 50, input 64 + 1MiB, taxonomy 10
  abuse shapes, recursion 12000 deep, storage-fill 8KB, wp 15 posts -
  every number in the prose now has a code constant behind it. Gates:
  suite 176/176, check 0, lint:docs 0, web build 6/6, dogfood ledger
  diff clean.**

- [2026-10-21 ~18Z] **cve-feed goes public-facing across every surface
  (root docs + docs + web) and the pack's surface-as-contract pin lands.
  README: new cve-feed paragraph in the dogfood section (offline KEV/NVD
  sweep, zero sockets, pinned). docs/reference/attacks.md: prose-only
  'Shipped packs' section (library-catalog count stays exactly 30 - no
  `| \`` rows added, the parity pin holds); docs/index.md: packs-register
  line under 'Where to go'. Web: Attacks.jsx gains the shipped-packs
  section (site + cve-feed, deterministic snapshot philosophy, test pin
  link); FAQ.jsx gains the 'Does it know about known CVEs?' answer with
  the honest offline/sync story. Suite pin hardened: snapshot rows now
  EXACTLY 12 (a shrunk/regenerated snapshot fails loudly, refresh moves
  the constant deliberately) + per-entry version-shape checks + a
  generalized token-boundary roundtrip (every shipped token must not
  match inside a longer word - not just the ws/answer case). Suite 176
  (was 175), all pass; lint:docs 0; check 0.**

- [2026-10-21 ~17Z] **post-extension brittleness audit (the "is it all
  guarded" question, all four axes, real commands). Suite 175/175, check
  0, lint:docs 0, cvetest 3/3; snapshot stays within its 12-row/4200-byte
  budget at HEAD. Docs parity gap CLOSED: cve-feed now joins crashtest-
  site in docs/reference/packs.md's pack register with the byte-anchored
  claims pinned to what the suite actually asserts (no-fiction rule
  observed live: an overclaimed roundtrip phrase was walked back to exact
  - budget / shape / boundary-safety). Roundtrip test file remains the
  next-lens extension on the list for the pack (currently: shape +
  budget + teeth + word-boundary pin in test/cve-feed.test.js).**

- [2026-10-21 ~16Z] **two pre-v1 builders land together: the session
  replay-window extension + the cve-feed snapshot pack (extended sources).
  Library now 30 attacks / 12 modules; full battery vs ourselves 60/60
  REFUSED.** The planned session row SHIPPED: token-replay-deny (the
  in-process oracle for 'token reuse past expiry-to-deletion gaps' is the
  ISSUER REGISTRY - four logins across three accounts must mint pairwise-
  distinct sids, and the same-account re-login must not resurrect its
  original sid; a reused sid makes every expired-but-known token replayable
  forever; honest skip for cookie-less logins, one false-PAIR paste-hazard
  caught in review). Vuln bench: static-sid draft trips (6 shared-sid
  half-pairs); hardened row-id rotation holds. And the extended-sources
  design SHIPPED as the cve-feed snapshot pack (one law intact: run time
  reads ONLY the committed snapshot - zero sockets, same commit -> same
  findings; freshness stays the maintainer-side sync + CI last-modified
  join): curated KEV/NVD slice (12 entries, own integrity budget <= 12
  rows / 4200 bytes, real CVEs: nginx resolver, qs/express DoS, php,
  wordpress, next middleware, vite traversal, ws, follow-redirects, node
  fetch, lodash proto, apache traversal), two attacks (kev-banner-audit:
  Server/X-Powered-By/Via/X-Generator + body-stack-tell sweep over every
  declared route, word-boundary-safe tokens; kev-version-range-audit:
  disclosed versions must not sit in the snapshot's vulnerable sets -
  disclosure-only with a clean version is honest REFUSED). Two-way teeth +
  snapshot-integrity gate pinned (test/cve-feed.test.js, incl. the 'ws'
  must-not-match-'answer' boundary pin); both pack rows read clean on our
  own combined surface (18 routes swept, quiet wire). Count pins moved
  everywhere (29 -> 30 rows, 814/1070 -> 842/1082 ops, module-plan 30 ->
  31, catalog/FAQ parity 29 -> 30 across 12); packaging gains cve-feed +
  snapshot.json in the tarball; check chain gained the new test. Gates:
  suite 175/175, check 0, lint:docs 0, web build 6/6.>

- [2026-10-21 ~15Z] **the WP lane touched before v1: wp-roles shipped
  (experimental) + the stub-WP worker fixture closes the PRD gap list.**
  Per the browser-lane pacing call: puppeteer/playwright stays designed-
  not-built (later version); the WP lane is the pre-v1 touch.
  Three pieces landed per the gap list: (1) fixtures/wordpress/stub-wp/
  wp-load.php - a deterministic in-memory WP API core (hooks with priority
  + accepted_args, options, posts/meta, wp_die/redirect transfer capture,
  wpdb query ticks for cost meters) CARRYING the role/callback registration
  layer the worker fixture lacked: a seeded identity store
t  (ct_create_user/ct_grant_role/ct_reset_users whitelist helpers),
  capability maps keyed ONLY by that store (request input never reaches
  current_user_can), deterministic nonces, and the gated callback
  ct_role_probe (priv hook carries current_user_can('manage_options'),
  nopriv hook refuses outright). Stub lesson: boot round one had
  add_action delegating to add_filter, so do_action read an empty registry
  - isolation via pure PHP pointed at the registry bags; fixed at cause.
  (2) packs/public/wp-roles (3 attacks, explicitly experimental, ships in
  the tarball): nopriv-callback-denied (logged-out hit on the gated action
  must die 401/403 class; a 200 is the registration-bypass classic),
  low-privilege-callback-blocked (seeded subscriber/editor must die 403 -
  seeding crosses the CALL_ALLOW whitelist, honest skip without it),
  capability-constants-hold (admin passes + body-declared role=admin on a
  subscriber must STILL die). Honest skips on any run root without the
  adapter (same noWpTarget gate as stockwp). (3) the armed exercise:
  test/wp-roles.test.js boots the adapter against the stub (PHP available
  on this box + GitHub runners; skips loudly otherwise) and pins 3/3
  wp-roles REFUSED at exit 0 - it ALSO arms the stock smoke pack against
  the stub, so the WP lane now grades honestly IN CI without any install.
  The packaging audit earned its keep: the tarball files list never grew
  for wp-roles (test caught it) AND the check chain had quietly missed the
  four later-library modules (authz/protohygiene/recursion/upload/race) -
  both fixed (files + chain), suite green after. Full battery vs ourselves:
  57/57 REFUSED, exit 0 (wp-rows degrade to honest skips there by design;
  the armed exercise is the wproles test itself). Gates: suite 172/172,
  check 0, lint:docs 0, web build 6/6. PRD: wp-roles row -> shipped
  (experimental); browser lane stays designed-not-built per your call;
  additions: the browser lane (designed) and the WordPress packs subsection
  (touched spot).** Three PRD moves first: a `browser` planned row + a full
  "browser lane" design section (two honest execution lanes - an in-process
  DOM-sim and a real-browser SERVICE THREAD over CDP pipe transport,
  neither ever a socket; the capability ships as a SEPARATE optional package
  so nobody's install collects puppeteer junk; scenario families named:
  DOM clobbering, form-action/base hijack, postMessage origin confusion,
  CSP proof-by-render, storage-leak audit, clickjacking visibility). And
  the WordPress lane got its dedicated spot: shipped packs ( wp-money-
  shapes, wp-stock-smoke), the v0.3 subprocess adapter + NDJSON stdio wire,
  and the honest gap list before wp-roles can ship (a role/callback-
  registration worker fixture first, then the pack, then an end-to-end
  armed exercise).
  Then the planned row SHIPPED: src/scenarios/library/race.js (2 attacks).
  The PRD's old "needs interleaved scheduling in the harness" solved
  cheaper: handlers under one Promise.all already interleave at every
  await boundary (fake D1/KV calls are async), bursts are deterministic by
  microtask order. double-submit-idempotency (3-way same-key burst must
  land ONE stored effect: two rows = double-charge; an uncaught same-key
  throw = the storage wall without a shaped answer, ALSO a finding; one
  row + shaped 409s = REFUSED). concurrent-write-lost-update (field-split
  concurrent writers must both survive: a record holding only the last
  writer, or a writer lost to an uncaught unique row conflict, = the
  silent stomp; per-field storage = REFUSED). Honest lesson from the test
  round: the in-service throw is a VERDICT-grade finding, not a transport
  hiccup (fixed the oracle wording). Demo grew both surfaces: charge (hard:
  unique-cid INSERT + shaped 409 catch; vuln: await-gapped SELECT-then-
  INSERT TOCTOU draft) and profile (hard: per-field rows; vuln:
  whole-record blob DELETE+INSERT stomper). Vuln bench: 10 REFUSED /
  19 EXPLOITED, lost-update trips (blobs.user throw + stomp class).
  Dogfood hardened: 29/29 REFUSED (814 ops / 1070 requests) - snapshot +
  all count pins moved (27 -> 29 rows, 11 -> 12 groups, 739/1006 ->
  814/1070, module-plan 28 -> 30, catalog/FAQ parity 27 -> 29). Site pack
  gains race-asset-parity (18 attacks now): 12 concurrent GETs of the same
  asset must come back byte-identical (56 parity burst requests, honest
  REFUSED). Full battery vs ourselves (demo + site, all 12 modules +
  packs): 54/54 REFUSED, exit 0, 1230 ops / 2755 requests, 0 new /
  0 regressed. Gates: suite 170/170, check 0, lint:docs 0, web build 6/6.
  Remaining planned: session/replay, browser lane (designed), wp-roles
  (needs its worker fixture first), race/expiry-race extension, extended
  sources CVE/KEV pack.
  PRD planned row `upload` (multipart shapes) lands as
  src/scenarios/library/upload.js (2 attacks), both verdicts read the
  STORE - the handler's derived storage is the wire truth, not the
  response wording: filename-traversal-family (attacker-shaped FormData
  filenames - unix/windows traversal, percent-dot splits, the percent form
  of the null-byte split (wire names cannot carry raw NULs - the percent
  stand-in names the class), double extensions, absolute paths, dotfiles,
  dot-fragments, semicolon traps; any derived key that escapes the
  safe-name grammar = EXPLOITED with the key named) and
  mime-polyglot-family (SVG with a script and text/html documents are
  canonical XSS carriers - stored verbatim = EXPLOITED, honest 4xx =
  REFUSED; the implied fix is the content-type allow-list). ctx: route
  (default 'upload') + store (default 'UPLOADS' fake-KV namespace mounted
  directly at env.<store>, the same read pattern volume/ uses for
  DEVICE_CACHE). Demo grew the surface both ways: hardened upload (safe-name
  grammar + extension allow-list + content-type allow-list + size cap,
  413 for oversized) vs the trust-the-wire draft (raw client filename as
  the storage key, echoed verbatim in the response body). Vuln bench:
  9 REFUSED / 18 EXPLOITED, BOTH upload attacks tripping (raw 'etc/passwd'
  key stored verbatim; dropper.svg with a script persisted). Dogfood
  hardened: 27/27 REFUSED (739 ops / 1006 requests) - snapshot + every
  count pin moved (25 -> 27 rows, 10 -> 11 groups, 696/958 -> 739/1006,
  module-plan 26 -> 28, catalog/FAQ parity 25 -> 27). Site pack gains
  upload-multipart-hardening (17 attacks now): multipart shapes across
  every shipped route never fault, never 5xx, never reflect hostility
  (18 probes, honest REFUSED). Full battery vs ourselves (demo + site,
  all 11 modules + packs): 51/51 REFUSED, exit 0, 1095 ops / 2414
  requests, 0 new / 0 regressed. Gates: suite 169/169, check 0,
  lint:docs 0, web build 6/6. Remaining planned rows: race (harness
  scheduling first), session/replay extension, wp-roles, and the
  extended-sources CVE/KEV snapshot pack.
  extended-sources design (CVE/KEV packs) lands in the PRD.** Two PRD
  moves: a new planned row for `recursion` (loops without a guard - the
  user's suggestion, and honestly the agentic-class frontier) plus an
  "Extended sources" design section for offboard vulnerability corpora
  (CISA KEV / NVD as packs) with the bloat answer built in: maintainers
  sync a CURATED, budget-capped snapshot (KEV exploited-first, <= 500 rows)
  that run time reads ONLY from the committed file - zero sockets at run
  time (the one law), freshness checked by CI joins, never a runtime dial.
  Then the planned row SHIPPED as this round's module: src/scenarios/
  library/recursion.js (2 attacks). deep-nest-stack-overflow (a 12000-deep
  JSON body vs recursive walkers - V8's JSON.parse is iterative so parsing
  survives, the uncaught RangeError names the walker that was not guarded;
  honest 4xx depth-cap refuses) and redos-catastrophic-pattern (the
  library's one TIMING-RELATIVE probe by design: evil/benign pairs
  self-control the ratio on the SAME handler - 40x bucket + 20ms absolute
  floor, no host clock decides). V8 irregexp lessons paid for in probing:
  (1) matching suffixes terminate fast - the evil probe must FAIL the
  regex; (2) same-shape benign partners backtrack nearly as hard as evil
  (34ms vs 224ms = ratio 7x, useless) - benign must be TINY ('ab', ~0.2ms)
  to make the ratio >1000x; (3) the classic families cliff instant-
  or-seconds, so the committed sizes sit just past the knee (~300ms evil)
  and stay sub-second for CI. Demo grew a 'validate' route both ways
  (hard: length-capped linear pattern; vuln: the /((a|aa)+)/ catastrophic
  family). Vuln bench: 9 REFUSED / 16 EXPLOITED with BOTH recursion
  attacks tripping (RangeError + both redos pairs). Dogfood hardened:
  25/25 REFUSED (696 ops / 958 requests). Snapshot pins moved (23 -> 25
  rows, 9 -> 10 groups, 668/924 -> 696/958). Site pack gains
  recursion-depth-sweep (16 attacks now): 4000-deep bodies and
  backtracking-shaped strings never take an asset serve down (24 probes,
  honest REFUSED). Full battery vs ourselves (demo + site, all 10 modules
  + packs): 48/48 REFUSED, exit 0, 1034 ops / 2149 requests, 0 new /
  0 regressed. Gates: suite 168/168, check 0, lint:docs 0, web build 6/6.
  and its first run paid rent again: the 204-with-body bug.** PRD's cheap /
  low-false-positive slot ships: src/scenarios/library/protohygiene.js
  (2 sweep attacks, no arming). head-get-parity (HEAD must mirror GET: no
  throw, no status drift where GET answered 2xx - only an honest 405 is
  excusable; HEAD body bytes graded INFO-only because wire runtimes strip
  them, so flagging in-process would false-positive correct handlers) and
  request-shape-flood (bare geometry before payloads: duplicate query keys,
  malformed separators, embedded control bytes, dot-segment/double-slash
  path shapes, and identity headers in 3 casings - never 5xx, never threw,
  answers must not change when only the spelling did).
  FIRST DOGFOOD FIND: the demo's logout handler answered
  new Response('ok', { status: 204 }) - WHATWG refuses a body-bearing 204
  outright, so EVERY logout call had ridden rec.threw silently since the
  session round; the session/logout-invalidates REFUSED rows carried the
  throw only as an ungraded detail string. Flood graded it; fixed at cause
  (null body on the 204 in demo hard + vuln + the test fixture). Honest
  scope choices per PRD: header case is a transport invariant in-process
  (WHATWG Headers normalizes), so the case axis pins the invariant
  (differential control) instead of grading unformable behavior. Also
  fixed at cause: the dashboard snapshot generator's per-attack regex could
  not parse hyphenated module prefixes - 'proto-hygiene' rows silently
  dropped from cost economics (the same family as the taxonomy round's
  regex widen); both id halves now hyphen-tolerant. Count pins synced
  everywhere (21 -> 23 rows, 8 -> 9 groups, 508/748 -> 668/924 cost,
  module-plan 22 -> 24, catalog/FAQ parity 21 -> 23). Site pack gains
  proto-hygiene-shape-battery (15 attacks now): HEAD mirrors GET on all 6
  asset routes + 7 query shapes x 6 routes never 5xx/throw. Vuln bench:
  9 REFUSED / 14 EXPLOITED (the flood's 31 broken probes on enrollVuln).
  Full battery vs ourselves (demo + site, all 9 modules + packs): 45/45
  REFUSED, exit 0, 982 ops / 1916 requests, 0 new / 0 regressed. Gates:
  suite 167/167, check 0, lint:docs 0, web build 6/6.
  full battery vs ourselves: 42/42 held.** PRD section 6 planned row #2
  ships: src/scenarios/library/authz.js (3 attacks) attacks the privilege
  DECISION itself (privilege-escalation attacks the owner field - authz
  attacks the gate): method-matrix-privileged (the privileged route must
  deny on EVERY method - GET/POST/PUT/PATCH/DELETE, bare + bodies; a gate
  that trips only on the method the developer tested is the class),
  role-body-spoof-family (8 role-word claims x 3 methods - role/isAdmin/
  is_admin/admin/scope/permissions/nested user.role/body-echoed x-user-role
  must never flip a deny; identity lives in what the server derives, not
  what the attacker declares), and handler-alias-confusion (a second route
  performing the same privileged action must deny identically to the
  primary, unauth AND spoofed - the dev/debug leftover trapdoor). Demo
  fixture grew the surface both ways: vuln admin now ALSO honors body-
  declared roles (the classic draft), both variants carry the dev-check
  alias (hard denies identically; vuln honors the headers the primary
  ignores). Harness lesson: GET/HEAD cannot carry a wire body - the matrix
  rides bare attempts there. Two-way proofs pinned; undeclared-route skip
  pin. Vuln bench: 8 REFUSED / 13 EXPLOITED (role-body trips: role via
  POST/PUT/PATCH all 200). Dogfood hardened: 21/21 REFUSED (508 ops / 748
  requests) - snapshot regenerated, pins moved (dashboard/parity 18 -> 21
  rows, 7 -> 8 groups, cost 464/659 -> 508/748; module-plan 19 -> 22;
  s15-dogfood 18 -> 21; catalog/FAQ parity 18 -> 21). Site pack gains
  authz-no-privileged-surface (14 attacks now): no shipped artifact may
  advertise /admin|/dev-check|/debug|/wp-admin path references, and role-
  claim bodies flip nothing - first vs-ourselves run honest REFUSED. Full
  combined battery (demo + site routes, all 8 modules + packs): 42/42
  REFUSED, exit 0, 648 ops / 1433 requests, 0 new / 0 regressed. Gates:
  suite 166/166, check 0, lint:docs 0, web build 6/6.
  run vs ourselves: 38/38 held.** The public self-dogfood pack now carries the
  session discipline as two self-contained probes (same spirit as the
  taxonomy pair last round):
  session-no-minted-cookies (a static/docs site with NO auth surface must
  mint ZERO cookies - every shipped route swept GET+POST with an anonymous
  jar; any cookie that appears must carry the full Secure/HttpOnly/_SameSite
  family or it is a finding) and session-forged-cookie-never-adopted
  (a canary-carrying forged sid fired at every route must be ignored: no
  set-cookie adoption, no byte reflection in bodies or paths, no 5xx or
  throw). First vs-ourselves run of both: 0 cookies minted across 12
  probes, forged double ignored on all 6 routes - honestly REFUSED. Full
  hard battery on the combined run root (demo fixture routes + all six site
  routes + moduleCtx-armed state/enumeration-oracle): 38/38 REFUSED, exit
  0, 593 ops / 1223 requests, 0 new / 0 regressed. New teeth needed nothing
  fixed this round - unlike the taxonomy round, which caught the 502
  byte-echo. Honest gap notes remain on file: stockwp + wp-money-shapes
  skip (no WP harness on this run root), volume/storage-fill skips (no
  kvwrite route), by design. Pins synced: siteRows 11 -> 13, snapshot
  regenerated to the 18-row session ledger (dashboard pins 15 -> 18,
  groupings 6 -> 7, cost 420/629 -> 464/659), pack.json description
  carries the session probes, Attacks page field-report ledger count
  13 -> 18 and now cites the right pin location (site-pack.test.js).
  New seed library src/scenarios/library/session.js (3 attacks): cookie-hygiene
  (the login transition must mint Secure + HttpOnly + a SameSite policy; a
  missing flag names itself; a cookie-less login honestly skips - bearer
  auth is out of scope by design), session-fixation (two logins must mint
  DIFFERENT sids; a forged canary sid must never authenticate - me()
  honoring an unknown cookie is the trust-the-wire classic), and
  logout-invalidates (a logged-out sid must be dead on arrival:
  me() with the pre-logout cookie must deny 4xx-class). Demo fixture grew
  the session surface both ways: hardened login/me/logout (D1-backed sid
  store, row-id-derived sids - zero clocks, determinism rule 4 honored,
  full flag family, 401 for forged/unknown sids, 204 logout that deletes
  the row) vs the classic LLM draft (static fixed sid for every login,
  zero flags, any cookie authenticates, logout is a look-busy no-op).
  Vulnerable bench: 6 REFUSED / 12 EXPLOITED, exit 1 (all three session
  attacks trip). Dogfood artifacts regenerated: 18/18 REFUSED (464 ops /
  659 requests, secret-watermark now walks 7 routes). Count pins synced:
  attacks.md header + new session section, FAQ '18 across 7 modules',
  Attacks.jsx catalog page module card, consistency/module-plan/
  s15-dogfood test pins, check chain. PRD section 6: session moved to the
  shipped table; only the replay-window extension stays planned. Getting-
  started bench block refreshed with the real vulnerable output. Gates:
  suite 165/165, check 0, lint:docs 0.
  crashtest.** The public site pack (crashtest-site) grew two taxonomy
  probes - taxonomy-abuse-not-5xx (abuse battery over every shipped route;
  must deny honestly or serve cleanly, never 5xx/throw) and
  taxonomy-impersonal-sad-paths (hostile registry doubles must collapse to
  502 bodies containing zero canary bytes and zero stack patterns).
  First run found a REAL leak in the shipped badge function:
  web/functions/api/version.js' catch-all interpolated err.message into
  the public 502, and JSON.parse failure messages echo registry bytes (V8
  interpolates a slice of the hostile document) - a broken registry could
  route attacker-shaped markers into the public error body. Fixed at
  cause: malformed documents collapse to 'registry returned an unparsable
  document (bytes withheld)'. Second honest correction: the probe's first
  pass flagged the registry-authoritative 200 (semver prerelease carrying
  the canary) - that is the badge doing its job, not a leak; the scan now
  targets only the sad path (status >= 400), matching the library
  taxonomy semantics. Pack pins: 11 attacks (siteRows === 11), pack.json
  description synced. Gates: site-pack 3/3, suite 164/164, check 0,
  lint:docs 0. Pushed with the prior round (efa902d) + this round.

- [2026-10-21 ~06Z] **taxonomy module shipped - 15 attacks across 6 modules.**
  New seed library src/scenarios/library/taxonomy.js (2 attacks):
  abuse-not-5xx (10 deterministic abuse shapes - garbage/truncated JSON,
  wrong/absent content types, oversized strings - all must land 4xx-class,
  same fuzzFloorViolation oracle as input, distinct payload family) and
  errors-stay-impersonal (sad-path bodies must not echo attacker canaries -
  values OR field names - nor leak stack frames). Two-way proofs in
  attacks.test.js (echo + 500 loll handler EXPLOITED both; impersonal
  hardener REFUSED both; skip-pin for undeclared routes). Paid rent
  immediately: the taxonomy probe flagged the echoed-field-name error
  shape in our own demo + campaigns fixtures (unknown field: ${k}) -
  hardened both to 'unknown field (allowed: key, owner)', and the demo's
  vulnerable enroll got the classic echo-raw-request-text draft. PRD
  section 6 now carries the shipped taxonomy row + a planned-expansion
  table (session/authz/upload/race/proto-hygiene/wp-roles, status planned,
  plus deliberate scope notes: oauth/cache/webhooks stay out with honest
  reasons). Count pins synced everywhere: attacks.md header, FAQ '15
  across 6 modules', consistency/parity/dashboard/s15 tests, check-chain.
  Live artifacts regenerated: dogfood 15/15 REFUSED (420 ops/629 requests),
  vulnerable bench exit 1 (6 REFUSED / 9 EXPLOITED, 0 new / 9 regressed);
  quick-start bench + getting-started index blocks now carry the real
  output,Snapshot generator regex widened to [a-z0-9-]+ (abuse-not-5xx's
  digits broke the [a-z-]+ matcher - the row silently vanished). Suite
  164/164, check 0, lint:docs 0, dogfood gate 0.

- [2026-10-21 ~05Z] **Docs/site story round: receipts become our own, minors
  tidied.** Attacks-page field report rebranded from the borrowed external
  story to the honest self-dogfood one (committed ledger 13 REFUSED on our
  own hardened demo + the real version-endpoint bug the self-site run caught
  and pinned via site/registry-hostile-statuses; verified facts only). The
  dashboard got an explicit notice that its default view is the committed
  CI ledger baked at build time (not sample data), and the baked snapshot
  regenerated at v1.0.0. Quick-start gains the bench-check demo: flip the
  fixture to vulnerable: true, run the read-only --expect-baseline diff,
  watch exit 1 with 7 regressed (verified live before shipping the copy).
  ledger.md now documents run --json; run --out-dir paragraph landed in
  run-roots previously. Sweep collateral repaired: make-ledger-snapshot.mjs
  regexes rebuilt for the ASCII report separators. Gates + suite green
  (web build 0, lint:docs 0, suite 163/163).

- [2026-10-21 ~05Z] **Tag also cuts the GitHub Release (publish.yml second
  job).** Mirrors prestruct's release.yml mechanism: a `github-release` job
  in publish.yml NEEDS the npm `publish` job (single tag trigger, the
  workflow's own "not both" rule intact), so the release exists only after
  a publish that landed. It packs the same-commit npm tarball (no install
  needed for `npm pack`), guards its contents to the reusable surfaces the
  packaging test pins (bin/src + two reusable packs; never web/, labs/,
  test/, repo-bound crashtest-site) and creates the release via
  softprops/action-gh-release@v2 with generated notes + the tarball asset.
  Honest quirk documented in the workflow: re-backed asset is not
  byte-identical to the registry artifact (tar stores mtimes; same tree,
  other clock). docs/publish.md synced (new release note + corrected
  drifted files-field rule) and passed the style gate once the em dash
  came out. YAML parse verified via js-yaml; guardrail + `npm pack` dry-
  exited against the real tarball before cleanup. Grammar self-caught:
  v1.0.0 tag-time release marker stays (unreleased) until the tag exists
  (test/version.test.js), so the CHANGELOG flip rides the tag commit.

- [2026-10-21 ~04Z] **Post-migration dead-code sweep - port is now total.**
  Follow-up to the first migration entry's "proxies stay" call, reversed on
  evidence: the npm package's own init/ template ships proxy.js,
  proxy.worker.js, and proxy.package.json, so crashtest's web/ copies were
  pure template-era dead weight (site prerenders all 6 routes, never sets
  config.proxy.url, nothing in CI/docs deploys them) - deleted, along with
  web/ssr.config.example.js (upstream init/ ships the updated template doc;
  the local copy still documented the vendored-file era) and
  web/incremental.js (a pre-signature cache draft stub referencing the
  deleted `node scripts/prerender.js`, imported by nothing). Stale comment
  touches: web/index.html and web/ssr.config.js now name the prestruct
  engine via `prestruct build` instead of the deleted script files; the
  usePageMeta.js hook comment de-staled with them. Kept: web/scripts/
  make-ledger-snapshot.mjs (live - feeds lib/dogfoodSnapshot.js). Repo-wide
  ghost grep for the six deleted paths: only historical TASKS references
  remain. Fresh build + suite + dogfood through the sweep: build exit 0
  (6/6), check 0, suite 163/163, dogfood exit 0 (artifact set already
  verified byte-stable apart from issue #23's status.json).

- [2026-10-21 ~03Z] **Cache story corrected + status.json filed upstream (#23).**
  Follow-up to the migration entry: the stale-`(cached)`-HTML incident was a
  VENDORED-copy bug (pre-signature cache), and prestruct v1.0.0 already
  shipped the fix - every cache entry carries a sha256 signature over the
  fresh shell (dist/index.html after vite build), siteUrl, and route meta,
  and a hit only counts when it matches; legacy sig-less entries render
  once and upgrade. Verified live on crashtest: warm cache + a src/ edit ->
  the whole route set re-rendered ("ok", never "cached"), and the repro edit
  was revoked and rebuilt pristine. So NO workarounds (no forced --clean)
  go on the site build - `prestruct build` as-is is correct, and the day-one
  word of the npm engine stands: cache matches stale-shell era.
  Also verified x2 fresh-build determinism: dist differs ONLY in
  dist/.prestruct/status.json's generatedAt (the build manifest the engine
  writes into dist) - filed upstream as dhaupin/prestruct#23 with the ask:
  move the manifest out of dist (or gate it behind config) + a
  deterministic stamp option; gitignore can't help (dist is post-checkout
  generated). Checked prestruct's open issues before filing: none.
  Full re-run through the new engine: `prestruct validate` ok (6 routes),
  build exit 0 (6/6 rendered), round-2 rebuild byte-identical apart from
  the manifest, suite 163/163, check 0, dogfood baseline 0 new / 0
  regressed, exit 0 (ledger/report artifacts restored to committed state).

- [2026-10-21 ~03Z] **Migrated web/scripts to the published `prestruct` npm
  package (v1.0.0).** Deleted the vendored
  `web/scripts/{prerender,inject-brand}.js`; `web` now devDependencies
  `prestruct ^1.0.0` and its build is the one-liner `prestruct build`
  (validate -> vite build -> inject-brand -> prerender, all workdir-anchored;
  route render failures exit nonzero - the vendored copy let them ride
  green). The npm engine CANONICAL: upstream already absorbed the JSON-LD
  bare-object check; A/B gate on a fresh cache: every prerendered HTML page,
  sitemap, _headers, and assets/ byte-identical to the vendored build
  (deploy-id format already matched at HEAD). Vendored prerender cache
  lesson confirmed live: stale `(cached)` HTML from three commits back
  invalidated a first A/B - always clear `.prestruct` before comparing.
  New engine behavior (accepted): `dist/.prestruct/status.json` build
  manifest ships with dist; cache lives in `web/.prestruct` (gitignored);
  proxies (scripts/proxy{,.worker}.js + proxy.package.json) stay - they are
  self-contained deploy alternatives, engine only touches proxy files when
  `config.proxy.url` is set (crashtest never sets it). CI unchanged:
  `npm install --prefix web && npm run build --prefix web` picks prestruct
  up via web's own install. Suite 163/163, check 0, dogfood gate green.

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
  TypeError / route "app" fault) on any non-WP run root - real
  false-positive generator, fixed with the config-gap skip (skipped
  REFUSED, declare adapters.wordpress). Two-way teeth pinned in
  test/site-pack.test.js: porous route EXPLOITED, hardened real one
  REFUSED; CLI-level run-root ledger has 9/9 site rows REFUSED at exit 0.
- [2026-10-20 ~24Z] **Docs/web round for the unified packs surface.**
  reference/packs.md: "Packs from other repos" section - packs: accepts any
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
  og:image intact). Suite 154/154, gates green, consistency probes 7/7. **v0.4 early flag: `run --out-dir <dir>` (section 14/section 15 close
  out).** The one remaining section 14 service-thread flag is shipped: artifact
  fan-out COPIES of run-blob.json + crashledger.json + hardening.md land in
  a distinct dir the caller owns - deterministic filenames, no timestamps;
  the repo's labs/ contract stays authoritative (fan-out is a rendering
  surface, section 15.3's hosted-copies rule). Fan-out into the repo root is
  refused at exit 2 (must be a distinct dir). Flag in --help; 2 new CLI
  tests; suite 150/150, gates green. Successor-hygiene note: the --json
  blob now carries { ...run, artifacts } when fan-out is requested - last
  stdout line remains a single parseable object. **Docs/web for v0.3 + the preset probe (v0.3.1).** Docs:
  reference/plugins.md + reference/presets.md (24 pages, nav, all four gates
  green). Web: FAQ grew two Q&As (community attacks via plugins; builder
  presets with the never-guess stance), FAQ meta in ssr.config updated,
  consistency + parity probes green, clean 6/6 prerender with JSON-LD.
  Preset probe: detect-then-prove - scaffoldPreset now EXECUTES every found
  JS-eligible handler once in-process (plain ESM import() + WHATWG Request,
  no sockets, no transpile) and reports status/ok/bodyBytes/ms as a note,
  or honest not-executed reasons for .ts/.deno (no-transpile), missing
  default-{fetch} interface, and throwing handlers - probes are evidence,
  never a throw. 5 new tests; 148/148. **v0.3 "the ecosystem": plugins API + builder presets.**
  Both PRD lines closed. Plugins (`config plugins: [npm-name | './file.js']`):
  importable ESM scenario modules through the SAME contract as packs/libraries
  (src/plugins/loader.js), resolved against the config file's dir; contract-
  broken or unresolvable listings fail the run loudly naming the plugin;
  cross-surface name collisions carry the earlier origin; wired into cmdRun
  and merged into the same sorted campaign + module-plan blob. Presets
  (`crashtest preset lovable|bolt|replit [--root dir]`): detect-first, NO
  builder-name fiction - researched the actual export shapes first (primary
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
  JSON-LD bare-object drop) - committed f181045, upstream prestruct #21 +
  freestruct #15/#16. Then v0.2: freezeTo()/restoreTo()/runFresh() on the
  harness (memory reuse for sub-second repeat runs, PRD line 136) - deep
  snapshot of every KV store, D1 table row set + nextId + uniques, and op
  counters; restore mutates bindings IN PLACE because the fake backends hold
  a counter identity from buildEnv (a naive clone swap silently orphaned
  every backend op tick, caught by the smoke test's op-shape assertion).
  runFresh = freeze at call time, replay, restore after - success OR throw,
  per the restore-what-you-touch rule. 4 harness tests: replay-ops identity,
  throw-path health, no-trace no-explicit-at default, junk-snapshot loud
  TypeError. 127/127 green.
- [2026-10-20 ~19Z] **Web polish round: JSON-LD fix, UI parity probe, dash
  stale-test sweep.** inject-brand.js silently emitted an empty structured-
  data block when ssr.config buildJsonLd() returned a bare object (only the
  array shape was handled) - fixed to accept object / array / complete
  payload, unusable shapes still fail loudly. New test/web-ui-parity.test.js
  (7 passing): dogfood snapshot <-> ledger-model parity, gate exit-code
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
  check-docs-frontmatter (4 required fields; baseurl-relative permalinks -
  leading-slash or baked-in /crashtest is the doubled-prefix fiction class,
  `/` reserved for the docs home), check-docs-links (fence/inline-code
  aware link graph vs frontmatter permalinks incl. doubled-prefix
  signatures), check-docs-style (fence language tags, heading skips,
  whitespace, pipe-table shape as HARD fails; em-dash/emoji as WARNs only
  - vant's hyphen-voice is a corpus pass we have not made; verdict marks
  are content), check-fiction-signatures (forward-dated release claims,
  global-install fiction, sockets-allowed claims, web-deps conflation;
  debunk-negation aware; ledger/PRD quote-fiction by design so they're
  allow-listed). Wired as `npm run lint:docs` + a ci.yml step. First run's
  hard findings: 2 missing fence language tags (run-roots, packs) - fixed;
  links gate would have caught last session's dead module-plan link
  mechanically. All four PASS (20 pages, 113 files, 138 voice warnings
  tracked). package.json stays `files: [bin, src]` - scripts are dev
  tooling, not shipped surface.
- [2026-10-20 ~15Z] **Docs audit: the doubled-prefix fix + full link/frontmatter
  sweep.** Live site served nav as /crashtest/crashtest/* (404s) - the layout
  piped nav URLs (already absolute, /crashtest-prefixed) through Jekyll's
  `relative_url`, which prepends baseurl a second time. Fix: emit item.url
  raw (vant never filters its nav either). Full audit script (frontmatter
  required keys x all pages, nav.yml<->permalink reachability, internal-link
  graph incl. doubled prefixes + raw .md links) over 20 pages: 3 findings -
  the layout bug itself, docs/publish.md having no frontmatter (gained one,
  noindex'd - maintainer content, not user docs), packs.md linking a
  module-plan page that doesn't exist (demoted to a code span). Dead
  `nav_order: 0` on docs/index.md removed (sidebar order is nav.yml-driven).
  Audit re-run: CLEAN. **Docs parity with vant: burger nav + pagefind search.**
  docs.creadev.org/crashtest was rendering the nav inline with no search -
  gap: the layout shipped "same shape as vant, minus pagefind/prism extras"
  and the extras were the UX. Ported vant's shape onto the crashtest
  theme: fixed header (search trigger w/ Ctrl-K chip + GitHub CTA +
  hamburger), burger-toggled slide-out sidebar w/ overlay (mobile <=768px,
  desktop keeps the fixed rail), pagefind modal search (Cmd/Ctrl+K, Esc,
  5-result cap) with an HONEST downgrade message when the index isn't
  deployed. Workflow got vant's hardened pagefind steps verbatim:
  token-authenticated release scrape (rate-limit lesson), validate the
  tag before download (404-HTML-as-tarball lesson), index built into
  _site BEFORE freestruct runs. Layout JS parse-verified; workflow YAML
  parse-verified. Push -> docs.yml path-filter fires the build.
- [2026-10-20 ~13Z] **Repo hygiene button-up (pre-v0.4 pause sweep).** Full
  git history scanned for secret-shaped strings (token/PK/AKIA xox"); zero
  hits - no secret ever landed. .gitignore hardened: `.env`/`.env.*` with
  `!.env.example` defense (CLI reads no env secrets - maintainer sandboxes
  only), web build artifacts (dist/, .prestruct/, web/node_modules/) folded
  into the root ignore. New `.ignore` (ripgrep-shaped): keeps node_modules,
  dist, cache, tarballs, and lockfiles OUT of code_search/grep so the
  search tool reads the product, not the vendor tree. Docs stayed
  truth-checked instead of example-filed: crashtest.config.js (fake env,
  .local URL), ssr.config.js (public site identity - its .example twin
  exists and the tracked-with-reason note is in web/.gitignore). wrangler:
  none in repo - Pages config is public _headers/_redirects. PRD section 14
  sequencing updated (v0.3 shipped, v0.4-early flag set shipped, section 15 = the
  v0.5 lane); section 15 verified end-to-end as the next-stage contract. 109/109
  tests still green after the hygiene pass.
- [2026-10-20 ~12Z] **section 14 flag set complete + the hosted lane gated (PRD
  section 15).** Thread A: `run --expect-baseline <path>` - read-only ledger diff,
  no `labs/` writes at all, section 7 exit rules unchanged, missing/non-schema-1
  baseline = honest exit 2. Tests: green read-only diff (labs/ provably
  absent + baseline byte-identical across two runs), regression gate fires
  (exit 1 on a REFUSED->EXPLOITED flip via an unhydrated leaking route),
  bad-ledger exit 2. 12/12 cli tests. Docs: DEPLOY.md (read-only gates
  recipe), docs/reference/exit-rules.md (section RA read-only diffs). Also prepped
  the GH Marketplace shape without publishing: `action.yml` gained a
  `version` input pinning the installed crashtest (`crashtest${{ '@' }}ver`,
  empty = latest), DEPLOY.md documents it - listing itself deferred until
  v1.0.0 per maintainer call. Thread C: PRD section 15 sketch locked as the design
  gate (webhook surface table, the four-invocation runner command set,
  ledger-hosting read-only-first, `/crashtest accept` opens a ledger PR
  instead of hosting service-side state, section 13 replay-prove before any hosted
  accepted-risks). Nothing hosted ships yet - this log + section 15 is the contract.
- [2026-10-20 ~11Z] **Docs sweep - README rewritten, AGENTS.md + DEPLOY.md
  born, all crosslinked.** Polished against the real CLI (no-fiction pass):
  README now leads with the 60-second usage, real module names with their
  shipped oracles, docs map; AGENTS.md carries the one law, layout, seven
  paid-for house rules, scenario contract summary, release procedure,
  vant/rook memory conventions, gistory port backlog; DEPLOY.md is the user
  path (init -> config -> run -> baseline -> CI action) plus maintainer OIDC
  release flow and a troubleshooting table built from today's real run logs
  (E404 stage-only default, tag re-push retry, must-end express rule,
  timestamp churn, shallow-copy proto note). Every documented command
  verified before landing (init artifacts, exit 2 on missing/bad config,
  dogfood exit 0). Code touch: config `modules` filter now flows through
  cmdRun (runner's opts.modules was CLI-dark).
- [2026-10-20 ~10Z] **v0.1.0 SHIPPED via OIDC - the loop is closed.** First
  attempt failed (E404 = stage-only default on the fresh TP config); after
  dhaupin flipped allow-direct-publish, re-pushed the tag (integration can't
  rerun someone else's failed run - `Resource not accessible by integration`
  - but a tag re-push retriggers cleanly) and run 39359193986 went green in
  19s: tests inside the workflow, tarball assembled, `npm publish` completed
  with provenance - **signed statement published to the transparency log**
  (search.sigstore.dev logIndex 3329750463). Registry now: versions
  0.0.0-stage / 0.0.1 / **0.1.0 (latest)**, author dhaupin, MIT. Zero tokens
  anywhere in CI. Remaining cleanup: dhaupin revokes the Termux granular
  token (never needed again); milestone deleted-tag note: tag re-push needed
  because rerun permissions are integration-limited.
- [2026-10-20 ~09Z] **Name claimed on npm - crashtest@0.0.0-stage is live.**
  dhaupin published from Termux via a granular access token (Route B,
  staged): package title/public name are on the registry as of
  2026-10-20T01:57Z, contents pending stage approval with 2FA. Version bumped
  0.0.1 -> 0.1.0 in package.json + src/cli.js (single VERSION const) and the
  report header's stale 0.0.1 fallback removed - the first REAL version to
  ship over the staged placeholder is 0.1.0, riding the OIDC workflow once
  Trusted Publisher is configured (dhaupin/crashtest, publish.yml, direct
  publish). v0.2 modules land inside the 0.1.0 tarball as clearly-labeled
  ahead-of-0.2.0 features (README documents them as v0.2). Tarball now
  31.1 kB / version-verified. Next: dhaupin approves stage + configures TP,
  then v0.1.0 tag.
- [2026-10-20 ~08Z] **v0.2 landed - everyone's backend + the Action wrapper.**
  `src/adapters/` (hono via `.request`, express via `app.handle` + Node-style
  req/res with Buffer-normalized bodies and MUST-END dispatch - a route that
  never ends is a finding past the drain window, fastify via `app.inject`;
  config `adapters: { hono, express, fastify }` wired through the CLI, options
  vs bare-app shapes detected by own-key heuristic). Seed `state`:
  enumeration-oracle (foreign ids must deny; id always carried - body/params
  or querystyle), id-collision-alias (second-owner same-key write must
  conflict or fork; overwrite detected by DB snapshot diff, not response
  text; default key derived from ctx.seed - determinism). Seed `volume`:
  credential-stuffing, storage-fill, cost-amplification - every run reports
  ops/request; EXPLOITED only on breaks or bound violations (bound via
  ctx, default 12 ops/request). Runner gets `opts.modules` filter.
  `action.yml` composite GitHub Action (setup-node + install crashtest +
  optional target tests + `npx crashtest run --config` with artifact upload
  of the hardening run). Full suite 59/59; dogfood now 13/13 REFUSED
  (snapshot regenerated - attack count grew from 8 to 13); check script
  covers all v0.2 files. v0.2 PRD scope code-complete except: adoption wave
  against real framework apps (gistory adapter honors hono/express),
  harness memory-reuse for sub-second reruns.
- [2026-10-20 ~07Z] **S1.5 landed - crashtest dogfoods itself.** In-repo
  fixture (fixtures/demo/app.js: hardened + vulnerable drafts incl. the
  classic recursive merge), root crashtest.config.js, CLI-level dogfood
  tests (hardened -> exit 0 with 8/8 REFUSED; vulnerable -> exit 1 with
  proto-pollution + header bypass + hygiene findings; regression gate:
  hardened baseline flipped to vulnerable draft fails on REFUSED->EXPLOITED),
  and .github/workflows/ci.yml making the self-run the CI gate against the
  committed crashledger.json. v0.1 scope from PRD section 8 is code-complete:
  harness, seed libraries (auth/input/guards), campaigns, report+ledger,
  CLI, dogfood. 52/52 node:test green, check green, in-repo dogfood exit 0
  (labs/crashledger.json + labs/hardening.md snapshot committed). Next
  candidates for this sprint or 0.2: npm first publish (pending dhaupin's
  Termux), `crashtest init` route-table discovery helpers, 0.2 adapters.
- [2026-10-20 ~06Z] **S1.2+S1.3+S1.4 landed - the pipeline now finds things.**
  Seed `auth`: identity-spoof-headers (403->2xx flip oracle over 9 header x
  6 privilege matrix, baseline-throw and stable-open branches), secret-watermark
  (fake env secrets must never appear in any response across all routes x
  error-path probes), privilege-escalation (denied baseline + identity-field
  mutations must not flip). Seed `guards`: hygiene-no-store (surviving 2xx
  writes need explicit cache-control), burst-wall (sequential burst; 429/503
  must carry usable Retry-After; any break is a finding; undeclared routes
  degrade to a skipped REFUSED - zero false-positive CI per PRD section 12).
  `runner.js` (cost deltas per attack, ownerless-BOUNDED->finding) and
  `report.js` (ledger diff + section 7 CI matrix + markdown) wired into the CLI's
  run verb. Two-way proofs extended to auth/guards; exit-rule matrix tested
  (fresh/regression/accepted/boundless/no-baseline). 49/49 node:test green.
  Remaining from S1.5: an in-repo `crashtest.config.js` + fixture app dogfood
  + CI snapshot of the report.
- [2026-10-20 ~05Z] **S1.2 scenario system + seed input library landed (partial,
  first built-in module).** `src/rng.js` (xorshift*, seeded - same seed -> same
  findings, platform-stable), `src/scenarios/contract.js` (the section 6 module
  contract: validateScenario fails loudly on bad shapes; verdict helpers -
  BOUNDED without owner+bound refuses to construct; `fuzzFloorViolation` oracle:
  threw-or-5xx), `src/scenarios/loader.js` (built-in `library/` + user dirs,
  name-collision detection, deterministic ordering), and the seed
  `src/scenarios/library/input.js`: proto-pollution-body (canary via hostile
  own-key JSON - hostileSerialize keeps `__proto__` keys where stringify
  drops them), never-fail-mutations (seeded hostile bodies, floor = never 500
  / never uncaught), oversized-field (1 MiB). **Two-way proof in
  test/scenarios/attacks.test.js:** vulnerable recursive-merge fixture ->
  EXPLOITED with canary evidence; allow-listed hardened fixture -> REFUSED;
  brittle handler -> EXPLOITED, validated -> REFUSED.
- [2026-10-20 ~04Z] **S1.1 harness core landed.** `src/harness/` complete:
  counters (declared op set + weighted cost + deltas), FakeD1 (SELECT/
  INSERT/UPDATE/DELETE subset against seeded tables; UNIQUE constraints throw
  D1-shaped `UNIQUE constraint failed: t.col` - takeover/row-move campaigns
  depend on it; params bind in textual order incl. SET-before-WHERE; `COUNT(*)`;
  gaps throw with gap-naming messages so DISCOVER surfaces them), FakeKV
  (get/put/delete/list, TTL accepted-ignored for determinism), fake env
  factory (kv seed + d1 tables + secrets), Harness (explicit route table,
  in-process WHATWG Request -> handler -> Response; uncaught handler errors
  surface as `threw:` records - NEVER converted into fake 500s; per-run op
  deltas + whole-campaign cost totals).
- [2026-10-20 ~03Z] **Name-stake release staged (S1.0 partial, done).** Repo now
  carries a publishable 0.0.1: package.json (exact name `crashtest`, zero
  runtime deps, node >=18.17, MIT), bin + src/cli.js (`init` scaffolds
  labs/crashledger.json schema v1 + hardening.md stub - run is an honest
  exit-2 placeholder), 7 passing node:test cases (TAP, TEST_EXIT=0), chmod +x
  on the bin, and tag-driven publish via npm Trusted Publishing (OIDC, no
  NPM_TOKEN) in .github/workflows/publish.yml. Publish runbook in
  docs/publish.md - first publish is a one-command bootstrap (direct or
  staged, docs updated 2026-10-20); after that v* tags publish+test
  automatically. Waiting on: dhaupin first publish (Termux attempt), then
  npmjs.com Trusted Publisher config (dhaupin/crashtest, workflow publish.yml).
- [2026-10-20 ~02Z] Name re-check (rook lesson: always check npm + gh): bare
  `crashtest` still FREE on npm - but the block is filling in: `agent-crashtest`
  (published 2026-10-16, prompt-injection tests for Claude Code/Cursor/MCP -
  agent-adjacent niche) and `@crashtest-ai/*` 0.1.x family ("CrashTest AI",
  stress/security SDK for AI apps, Sept 2026). PyPI `crashtest` is
  python-poetry's error-handling lib (different domain). Rec: publish npm
  `crashtest` early (even 0.0.x), don't squat-scramble; exact-name ownership beats
  brand adjacency, and our description/invariant ("in-process adversarial QA
  for app code") is distinct from both neighbors.
- [2026-10-19T23:59Z] Rooster session: rook horcrux pulled from the now-public
  weisync/rookworks stone; brain-unlock + horcrux restore clean on vant
  0.8.6-from-main (6 private brains restored). Found + filed vant#212
  (memory learn prose false-positive on `~/`, `../` - "Path blocked" eats
  valid note content, error names no reason). Brain stack switched to rook.
- [2026-10-19T23:59Z] Prior scaffold (f8b4b7e, never pushed) is gone with the
  old workspace; repo on disk = README + PRD only. S1 restarts fresh -
  tasks above are the full plan, nothing is secretly "already done".
- [2026-10-19T23:59Z] Still watching vant #119/#120/#121 (org-grant boot
  hydration, dept/team name=parent-id, health CWD false-negatives) per rook
  goals - re-test org-grant hydration when a fix lands.
- [2026-10-20T04:10Z] First real external adoption test done: crashtest 0.1.0
  (tarball, real `npm install`) driven against a test install of vant's raw
  `http.createServer` server (`_handleRequest`), authRequired ON, real `/call`
  MCP door + status endpoints, in-process via the new node adapter surface.
  Crashtest bugs found + fixed at cause, all regression-tested (61/61 green,
  `check`+dogfood exit 0):

  - bare `./adapters` subpath `ERR_PACKAGE_PATH_NOT_EXPORTED` -> explicit export
    alias; registry re-exports registerExpress/registerFastify/registerHono/
    registerNodeDispatch/dispatchNodeRequest.
  - fake req missed the event-style raw-server surface vant touches
    (`req.setTimeout`, `req.on('data'/'end')`, `req.destroy`) -> toNodeReq is now
    a real mini-Node req (EventEmitter, nextTick body events, record-and-forget
    idle guard, listener-dropping destroy). Fixed the vant-pass phantom
    `Unhandled Rejection: req.destroy is not a function` too.
  - `dispatchNodeRequest` (new export) lost the drain-to-res.end semantics on
    first cut and read the res before event handlers ended it -> bounded drain
    restored, races the WHOLE settle against the timeout cap.
  - `state/id-collision-alias` crashed (`harness.env.DB.snapshot` undefined) on
    targets with no DB binding instead of refusing gracefully -> skips with a
    "declare env.DB" hint like its siblings.

  VANT findings (filed from the labs/hardening.md report of the fixed-wire run;
  run-1 REFUSEDs on the same attacks were false-passes from the broken wire):

  - guard/hygiene: 2xx writes over POST /call ship NO Cache-Control (shared
    caches may replay writes).
  - burst abuse: 11/50 handled requests 500'd mid-burst (5xx at request 39)
    instead of shedding with 429 - vant's own QoS limiter logged
    "Global rate exceeded: 60/60" but requests still failed as 500.
  - never-fail-mutations: 64/64 hostile bodies -> 500 (first: {"id":2147483648})
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
    maps the scenario vocabulary onto the real paths of ONE dispatching app -
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
    500-on-hostile-shape - scanner working).
- [2026-10-20T05:05Z] Site shipped: `web/` (prestruct scaffold copied from
  dhaupin/prestruct init, identity-retuned) - React+Vite, prerendered SEO
  (/, /attacks, 404, sitemap), Bolete-inspired dark lab theme, Pages
  Function `web/functions/api/version.js` (live npm version + provenance,
  edge-cached 5m). Build: `cd web && npm run build` -> `web/dist` for
  crashtest.creadev.org. Site is a separate workspace: npm package
  `files` must stay /web-free (checked). Notes: prestruct's init template
  lacks example/vite.config.js - without plugin-react the classic JSX
  runtime breaks prerender with "React is not defined" (copied the config).
- [2026-10-20T05:05Z] vant issues filed: #214 (Cache-Control missing on
  /call writes), #215 (500-instead-of-429/400 under burst/hostile/stuffing/
  fill - throw-based chain lands guard outcomes as server faults). gh app
  auth can create but not edit issues (403 "not accessible by integration")
  - edit #214's one garbled sentence manually when convenient.
- [2026-10-20T05:05Z] Version bumped 0.1.0 -> 0.1.1 (package.json +
  src/cli.js VERSION) for the next tag when the user wants to ship.
- [2026-10-20T06:30Z] Site theme bug found + fixed live (crashtest.creadev.org
  / crashtest.pages.dev): prerendered pages shipped WITHOUT theme - root
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
  suggested there too - build-time check in inject-brand/prerender that
  dist/assets holds an index-*.js + .css pair, else fail loudly.
- [2026-10-20T07:15Z] Black-screen bug on the live site fixed (reproduced in
  headless Chromium on crashtest.creadev.org, mobile viewport, iPhone UA):
  first paint = prerendered SSR + stylesheet (the "flash of theme"), then the
  client bundle threw React error #321 (invalid hook call) -
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
  GA tag (G-C454VG9F3M -> doubleclick/ads) that the site CSP correctly
  blocks - user-side Zaraz/CSP tweak if they want GA live.
- [2026-10-20T05:30Z] Web presence hardening pass (user: "we need web to be
  solid" - dashboard-able): icon set generated with the same Chromium that
  verified the site (icon.svg hand-drawn crash-shield glyph -> favicon-32,
  apple-touch, icon-192/512 PNGs); og-image.png (1200x630 lab card, real
  headings + verdict chips) baked via Playwright; ssr.config ogImage wires
  og:image + twitter:image into every prerendered page; site.webmanifest
  with dark theme colors; robots.txt with sitemap pointer (was relying on
  CF's synthesized one); <meta name="theme-color"> + CSS color-scheme:
  dark so mobile chrome matches the lab palette. Layout QA programmatic
  (Chromium): zero horizontal overflow on mobile (390px) and desktop its
  (1280px) on / and /attacks - scroll containers behave, nav on one line,
  zero page errors. All a11y-relevant details leave in styles.css.
  Icons/manifest/og artifacts live in web/public - graft naturally into
  future dashboard (PWA-grade identity ready).
- [2026-10-20T06:05Z] Site content wave + real docs system shipped:
  - /terms + /privacy pages (Routes+ssr routes, plain-language OSS legal:
    for / not-for, no warranty to the max extent of law, findings belong
    to the user, host/third parties named, CLI collects nothing), crosslinked
    from the footer on every content page.
  - Footer carries the do-follow made-by link (Made by Rook @ Creadev.org,
    target _blank rel=noopener - no nofollow), plus Docs link to
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
  - Known limitation: docs/ not built locally (no ruby/jekyll in sandbox) -
    structure mirrors vant's proven layout; GH Pages (or freestruct layer)
    builds it at docs.creadev.org/crashtest on push.
- [2026-10-20T06:55Z] freestruct wired into the Jekyll docs build (vant's
  docs.yml as the template - ruby 3.2 + bundler-cache + jekyll build +
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
- [2026-10-20 ~07Z] **Dashboard shipped - /dashboard renders the ledger with the
  CLI's own section 7 rule.** Headless bridge, zero backend:
  `web/src/lib/ledgerModel.js` imports `diffAgainstBaseline` + `exitCode`
  straight from `src/report.js` - the page shows exactly what CI exits with,
  one copy of the rule (parity pinned by `test/dashboard-ledger.test.js`,
  12 tests: new exploited flips gate, regression detected via baseline,
  accepted risk with owner+bound never re-alarms, run-blob shape, unsupported
  shapes fail loudly). Default view = committed dogfood baseline generated
  from the REAL artifacts by `web/scripts/make-ledger-snapshot.mjs`
  (crashledger.json + hardening.md cost economics -> `dogfoodSnapshot.js`;
  regen after dogfood runs change labs/). Users load their own ledger by
  paste / file upload / CORS raw GitHub URL - nothing server-side, matching
  the CLI-collects-nothing privacy story. Page: gate banner (exit 0/1),
  stat strip, findings grouped by module with verdict glyphs, per-attack
  op-economics bars, accepted-risks table. Prerendered as route #5;
  paid-for bug: prestruct's incremental cache served three asset
  generations at once after the first dashboard build - full clean rebuild
  fixed; `rm -rf .prestruct dist` is the restore ritual if assets go stale.
- [2026-10-20 ~09Z] **v0.3 WP spike LANDED + section 14 platform thread opened + the
  CLI went service-shaped.** Colleague issues #1/#2 adopted from a real
  patch: wordpress adapter (NDJSON-over-stdio worker - wire format, not a
  transport; no sockets kept honest), skip-parity for undeclared routes in
  volume/input/guards (proto of it: no harness-wide bombs), 6 envelope
  contract tests. Paid-for lesson repeated: the pack first landed in
  labs/scenarios and nearly tripped the self-dogfood CI gate (workerAbsent
  -> attack-threw EXPLOITED rows) - target packs live in fixtures/ beside
  examples, labs/scenarios stays the dogfood scan dir. CLI: `run --json`
  prints the machine run blob as the LAST stdout line (dashboard-compatible
  run shape) with a live sanity run (13 rows, exit 0). PRD section 14 codifies the
  greptile-style CI-runner platform thread: drone CLI, ledger-as-artifact
  contract, headless dashboard alignment, sequencing to v0.5. Docs:
  playbooks/wordpress + playbooks/run-roots (the #2 runbook, generalized).
  Issues #1/#2 closed with adoption notes; 83/83 tests; pushed as 0710c84.
- [2026-10-20 ~10Z] **SELF-DOGFOOD PROOF OF CONCEPT + the first stock-WP e2e.**
  The question arrived mid-thread: "ran crashtest on itself?" Honest split -
  the demo fixture yes, the product's OWN surfaces no. Fixed in three moves:
  (1) committed dogfood re-run: 13/13 REFUSED, exit 0 (timestamps-only
  artifacts restored). (2) NEW self-target `fixtures/site/`: crashtest
  attacks its own shipped Pages Function (`web/functions/api/version.js`)
  with the registry dependency doubled - same rule the fake d1 rides
  (deps get doubles, sockets die). Pack = 5 attacks incl. hostile registry
  statuses, proto-pollution canary, burst, cache-hygiene gates,
  restore-what-you-touch parity. **The self-run caught a REAL shipped bug:
  `{"nope":true}` @ 201 registry -> 200 with NO version** (the badge
  contract "200 means a version, 502 says why" was broken at the seam) -
  fixed in version.js, guarded by `site/registry-hostile-statuses`.
  CLI-level pin: `test/self-site.test.js` (temp run-root, config
  imports the real function; committed ledger untouched). 85/85 green.
  (3) STOCK-WP e2e per dhaupin's ok: PHP 8.1 + wp core + official SQLite
  drop-in; headless install cost 3 paid-for lessons: WP_INSTALLING is a
  CONSTANT (latched static - set-after-load does nothing; global trick
  also dead); wp-settings kill-point located with per-require stderr
  markers (beta: wp_not_installed die() at M32 zone); install via
  wp_install() in-process, section wp-tools never needed. wp-stock-smoke (3
  attacks: hostile nopriv volley / real-SQL metering / CALL_ALLOW breach
  probe) -> 16/16 REFUSED, 0 found, ops ride wp.query @2 from the real
  database. Pack landed as fixtures/wordpress/wp-stock-smoke.js + the
  headless-install recipe on the WP playbook. The section 12 metric is now
  self-paying: crashtest found >=1 real bug on the first unaudited repo -
  and that repo was OURS.
- [2026-10-20 ~11Z] **THE WP STORY WENT GENERIC + crashtest-vs-vant PoC RAN.**
  Codified the who-owns-specifics split the product demanded: worker is
  GENERIC (fields a first 'cfg' envelope: callAllow fn=>maxArgs +
  allowOptions list; state ops are plain WP primitives - posts-query /
  post-meta / option / delete-posts / insert-post / postmeta alias; khf
  names gone from plumbing, alive in the pack's own vocabulary). Adapter
  delivers the run-root's specifics once per worker; config shape gains
  callAllow/allowOptions. Class-of-1 paid-for bug caught by the e2e itself:
  callAllow referenced `fix` before init (TDZ) - the PoC run tripped first.
  Stock-WP smoke grew the option-gates attack (allowOptions deny + declared
  row whole-read - worker now returns scalars unchanged for string rows):
  17/17 REFUSED, real data read (blogname) from the real SQLite.
  WordPress-money pack rides the generic ops (khf flow e2e still needs the
  khf plugin runtime - honest limitation, unchanged).
  And the van PoC the user asked about: adapters + recipes existed; running
  against vant did NOT - now proven: a run root mounts vant's real
  Server._handleRequest via the raw-node adapter (no listen, no vant
  changes, routeAliases map the seeded vocabulary onto /call + /tools);
  full built-in suite -> 13/13 REFUSED / 633 requests / exit 0. Real
  receipts: Retry-After on 50/50 throttles, honest 413 on oversized, 60/60
  stuffing refused, amplification held at 1 ops/request. Two probes
  correctly ask for declarations (CRASHTEST_SECRET to arm, env.DB.snapshot
  for alias coverage) - run roots get to be smarter next thread.
  Run-roots playbook gained the van-style raw-node recipe with the PoC
  numbers; WP playbook rewrote "who owns specifics". 85/85 green.
- [2026-10-20 ~12Z] **THE EXTENSION SURFACE: scenario packs (packs/public +
  packs/local).** The ask: user-owned defs/recipes/scenarios, private when
  wanted. Schema decision: NOT vant's models/public-private (models is
  AI/ML-adjacent vocabulary; packs is crashtest's own word) - pack.json v1
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
  PRIVATE PACK on khf's own run root - no e2e for them in this repo by
  design, and the extra e2e limitation line is retired with the old
  fixtures/wordpress/wordpress-money.js (promoted to packs/public as THE
  example pack alongside wp-stock-smoke; worker/adapter untouched). Docs:
  reference/packs page + nav + playbook links + AGENTS layout. 91/91
  green; dogfood gate stays 13/13 with packs:false; WP stock run-root e2e
  unaffected (17/17).

### 2026-10-20 - wp-money-shapes: the shipped money pack is now plugin-agnostic
- Question that drove it: "is wordpress-money general, or khf/fm lore?" Honest
  answer: attack SHAPES were general, vocabulary was khf-specific - wrong
  bucket for a public pack.
- Rework: `packs/public/wordpress-money/` -> `packs/public/wp-money-shapes/`
  (@0.3.0). Zero plugin names in the pack; every vocabulary item (postType,
  metaPaid, metaEmail, optionKey, action, nonceAction, pacedHints) comes from
  `moduleCtx['wp-money-shapes']` in the target's run-root config. Missing keys
  degrade to a REFUSED skip (skip-parity, never a false positive).
- The khf/fm instantiations are these engines rebinding their own vocabulary in
  their run root's `packs/local/` - private pack, by design, never in repo.
- Fixed along the way: JS comments inside pack.json (JSON forbids them) caught
  by the loader's own loud manifest check - exactly the failure mode it exists for.
- Verified: 91/91 tests, check exit 0, packs verb lists both packs, dogfood 13/13
  with packs:false (gate decoupled), no stale references outside TASKS history.

### 2026-10-20 - `packs add`: the first-user path is one command
- User question answered with receipts: "why wp-money-shapes / what's the
  money?" - naming convention now documented (prefix = the surface the pack
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
  [--public]` - schema-v1 manifest + contract-valid stub module + gitignore
  append (local), loud refusals on collisions/bad names. vant's first
  private pack is now literally one command on the vant run root.
- Fixed at cause along the way: process.exitCode delete->assign in tests,
  strict-assert has no assert.exists, the runtime's leftover refuse-exit
  leaking into the test runner's status.
- Verified: 94/94 tests (3 new packs-add tests), check exit 0, live packs add
  local+public from a tmp cwd, dogfood gate decoupled 13/13.

### 2026-10-20 - `run --module-plan`: the coverage dry-run (PRD section 14 service flag)
- Which attack ids WOULD fire against this target, before any request - same
  loaders, same filters, same arming rules as the real run (shared code, no
  drift possible). Three statuses: WILL-FIRE / NEEDS-ARMING / SKIPPED-FILTER.
- Arming keys travel with the pack: module-level `armedByKey` export or pack
  manifest `armedByKey`, checked against `moduleCtx[<key>]`. Shipped
  wp-money-shapes + the packs-add stub declare theirs; a module's explicit
  `armedByKey: null` disables detection (precedence = module wins when present).
- NEEDS-ARMING rows are the honest gate: un-armed packs REFUSE-skip at run
  time (skip-parity, never false positives) - the plan surfaces them BEFORE
  you trust a green tally, which is the whole point of the flag.
- `--json` prints the plan blob as the LAST stdout line (same discipline as
  `run --json`) - the CI artifact the dashboard ate in the same session.
- Verified: 101/101 tests (7 new), check exit 0 with src/plans.js +
  test/module-plan.test.js in the inventory, live dry-run vs the dogfood config
  (13/13 WILL-FIRE, packs correctly absent via packs:false), exit 0 informational.

### 2026-10-20 - packs npm metadata (offline-first) + `packs --json`
- npm metadata now travels WITH the pack: optional `"package"` field in
  pack.json (string-validated, loud on wrong type) shown in the packs verb
  inline and inventoried by `crashtest packs --json` (LAST stdout line, same
  discipline as `run --json`) alongside version/entry/armedByKey.
- Deliberate boundary: the REGISTRY LOOKUP stays in npm's own tools - the CLI
  is a drone that never dials (PRD section 14 binding line). The docs carry the CI
  recipe: pair `packs --json` with `npm view <pkg> version` and fail on drift.
- Two real bugs fixed at cause on the way: my main() route dropped the
  closing brace of the packs branch (parse broke at the file's trailing
  export - caught by --check) and a ternary that silently discarded the
  --json flag when no --config was passed (caught by the new test).
- Verified: 103/103 tests, check exit 0, live verb shows armedBy hints +
  JSON inventory for both shipped packs.

### 2026-10-20 - dashboard v2: the coverage-plan surface
- The dashboard now accepts all three artifact kinds a run root can emit:
  ledger (findings + section 7 gate), run blob (single-run), and NEW the
  `run --module-plan --json` coverage plan - shape-detected, one adapter
  each, loud errors when a shape fits none.
- Plan view: WILL-FIRE / NEEDS-ARMING / SKIPPED-FILTER totals strip, per-
  module cards with the arming reason inline, and a packs inventory table
  (visibility, version, origin, attacks, armedByKey, npm package). No gate
  verdict on plans by design: they attack nothing, so they never pass/fail CI.
- Same honesty rules as findings: unknown statuses are FLAGGED, never
  silently relabeled; the plan bridge refuses ledgers and vice versa.
- Ledger bridge stays pure/testable (parsePlan in ledgerModel.js); pinned by
  3 new node-test cases + a live crosscheck: real CLI plan blob -> parsePlan
  (13/13 will-fire) while the ledger still parses with gate pass, and the
  plan bridge loudly rejects a ledger.
- CSS: chip vocabulary reuses the existing moss/err/ink-soft tokens; page
  JSX verified parse-clean via esbuild (no build run needed).
- Verified: 105/105 tests, check exit 0, CLI plan blob round-trips through
  the bridge exactly as CI would paste it.
