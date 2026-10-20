# Crashtest — TASKS

> Rolling log. Companion to labs/prd-crashtest.md (the product contract).
> Reconstructed 2026-10-19 from the rook horcrux (crashtest brain goals.md +
> lessons.md) after the original scaffold never left the old workspace.
>
> Session log format: `- [DATETIME] note` (newest at top). Struck items are done.

## Open decisions (resolve before S1 lands in git)

- [ ] **D1 · Scenario library contract**: port gistory's suites as-is into
  `src/scenarios/` (Rook lesson: "Do not fork the ideas; port the code") vs.
  re-derive a fresher neutral `{ name, attacks: [{ name, run(harness) }] }`.
  **Rec: port first; generalize second** — PRD §8 makes gistory the seed and
  the working code is proven.
- [ ] **D2 · Zero-dependency scope**: PRD principle 5 ("the attacker ships
  light"). **Rec: zero *runtime* deps, plain Node ESM + `node:test`; dev-only
  `tsc`/ESLint allowed in `devDependencies`.** Harness implements its own
  fake-transport + in-memory D1/KV rather than pulling supertest/better-sqlite3
  (matches the proven gistory gistory harness shape: fake D1 + op counters).

## Sprint S1 — v0.1 "the gistory extraction" (order matters)

- [ ] **S1.0** Repo skeleton: package.json (bin: `crashtest`), `src/`,
  tsconfig, CI workflow (typecheck + tests + report-snapshot).
- [ ] **S1.1** `src/harness/`: explicit route table (PRD open question: static
  import analysis is v0.2/v0.3 — no convention sniffing yet), fake transport
  (Request/Response objects, never sockets), in-memory D1 shim + KV/env
  bindings, op counters + cost meters per request.
- [ ] **S1.2** `src/scenarios/`: port gistory suites → `auth`, `input`, 
  `guards` libraries under the §6 contract. Delete gistory-specific bits
  (deviceId regex fixtures etc.) during the port, not after.
- [ ] **S1.3** `src/campaigns/`: runner + verdict model (REFUSED /
  EXPLOITED / BOUNDED) + seeded RNG for deterministic runs (principle 3).
- [ ] **S1.4** `src/report/`: `labs/hardening.md` + `labs/crashledger.json`
  + exit rules — non-zero **only** on new EXPLOITED or a regression of a
  previously REFUSED check (PRD §7 CI rule). Accepted risks require
  owner + bound in the ledger.
- [ ] **S1.5** Fixtures demo app (Pages Functions + D1) and dogfood: 
  `crashtest run` attacks crashtest's own fixtures; suite is green.
- [ ] **S1.6** CLI glue: `crashtest run [target]`, `crashtest init`.

## Log

- [2026-10-20 ~03Z] **Name-stake release staged (S1.0 partial, done).** Repo now
  carries a publishable 0.0.1: package.json (exact name `crashtest`, zero
  runtime deps, node >=18.17, MIT), bin + src/cli.js (`init` scaffolds
  labs/crashledger.json schema v1 + hardening.md stub — run is an honest
  exit-2 placeholder), 7 passing node:test cases (TAP, TEST_EXIT=0), chmod +x
  on the bin, and tag-driven publish via npm Trusted Publishing (OIDC, no
  NPM_TOKEN) in .github/workflows/publish.yml. Publish runbook in
  docs/publish.md — first publish is manual bootstrap (OIDC cannot create a
  package); after that v* tags publish+test automatically. Waiting on:
  dhaupin manual `npm publish`, then npmjs.com Trusted Publisher config
  (dhaupin/crashtest, workflow publish.yml).
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
