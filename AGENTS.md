# AGENTS.md - working conventions for agents on this repo

> Crashtest is adversarial QA **for** agent-built software; this file is the
> conventions for agents building / maintaining **it**. Humans welcome too -
> this doubles as the project's contributor cheat sheet.
> See [README.md](./README.md) for the product, [docs/DEPLOY.md](./DEPLOY.md)
> for install/adopt/publish, [labs/prd-crashtest.md](./labs/prd-crashtest.md)
> for the contract, [labs/TASKS.md](./labs/TASKS.md) for the rolling log.

## The one law

**Attack code, not people. No sockets. Ever.** Every request the harness fires is an in-process WHATWG `Request` handed to a registered handler. If a scenario, attack, or test can't be expressed without opening a socket - including "just one localhost fetch" - it's out of scope by design (PRD principle 2). The fake transport IS the product.

## Layout

```text
bin/crashtest.js        CLI entrypoint - shebang + main() from src/cli.js
src/cli.js              verbs: init | run [--config path] | --version | --help
src/harness/            counters (ops+cost), d1 (SQL-subset fake), kv, env, harness
src/scenarios/          contract.js (module contract) + loader.js + library/*
src/campaigns/runner.js campaign execution, verdict rows, cost accounting
src/report.js           ledger build/diff, section 7 exit rules, markdown renderer
src/adapters/           hono / express / fastify / node in-process adapters + registry
                        + wordpress (v0.3 subprocess spike - NDJSON stdio, wire format,
                        not a transport; PRD section 10 note + section 14 service thread)
src/rng.js              seeded xorshift (determinism)
fixtures/demo/app.js    the self-dogfood target (hardened + vulnerable variants)
fixtures/wordpress/     wp-worker.php + stub-wp/ (the generic subprocess worker
                        + the deterministic stub WP core the WP packs' teeth run on)
fixtures/site/          second site shape the pack tests exercise
test/   426 tests; count pins live here - the guarantee -> pin
                        map is in the project brain's pins.md (see Project memory)
web/                    the shipped site (prestruct-prerendered): Home, attack
                        catalog, dashboard (renders any ledger), FAQ; version
                        badge rides the nav (`web/src/components/Nav.jsx`)
horcrux/                the project brain stone (vant horcrux) + README only -
                        never read by tests/tooling/CI; see "Project memory"
packs/                  extension surface: public/<name>/pack.json (tracked,
                        shipped packs) + local/<name>/ (gitignored, private);
                        loader src/packs/loader.js, `crashtest packs` verb;
                        dogfood config opts out (packs: false)
crashtest.config.js     THIS repo's dogfood target config
labs/                   PRD / TASKS (rolling log) / crashledger.json / hardening.md
docs/publish.md         maintainer publish runbook (OIDC trusted publishing)
docs/                   PUBLIC docs (Jekyll, mirrors vant - deploys at
                        docs.creadev.org/crashtest via the freestruct layer);
                        every claim here is verified against the CLI (rule 7)
.github/workflows/      publish.yml (npm release on v* tags) / ci.yml (test+dogfood gate)
action.yml              composite GitHub Action for OTHER repos (crashtest gate)
```

## House rules (each one paid for in real bugs)

1. **Zero runtime dependencies.** Plain Node ESM, `node:test`, nothing else. `tsc` may only land in devDependencies (checkJs / `.d.ts` generation).
2. **JavaScript + JSDoc types**, no build step to run/test/publish (D3 in TASKS).
3. **Fail loudly, fail at cause.** Unsupported SQL, bad scenario modules, hung express routes - every gap names itself. Fix causes, never symptoms; no swallowed errors or suppressed tests.
4. **Deterministic.** Same commit -> same findings. Seeded RNG (`src/rng.js`); anything time-derived (e.g. default keys) breaks the determinism principle - derive from `ctx.seed` instead.
5. **Exit rules are the CI contract** (PRD section 7): exit non-zero ONLY on a new EXPLOITED finding or a REFUSED->EXPLOITED regression. Undeclared routes degrade to skipped-REFUSED (`skipped: true`) - never a false positive.
6. **Example-code vigilance:** `JSON.stringify` silently drops `__proto__` own- keys (see `hostileSerialize` in library/input.js); capture exit status explicitly when piping; `node --test` with a dir arg treats the dir as a module on some Node versions - use bare `node --test`.
7. **No fiction in docs.** Every README/AGENTS/DEPLOY claim must be verified against the actual CLI before it lands. If you can't run it, don't write it.

## Scenario library contract (summary)

```js
export default {
  name: 'my-module',            // kebab-case, unique
  description: 'one line',
  attacks: [{
    name: 'my-attack',          // kebab-case, unique in module
    async run(harness, ctx) {   // ctx: seed + config overrides
      // fire harness.run(...) requests, then return EXACTLY one record:
      return { verdict: 'REFUSED' | 'EXPLOITED' | 'BOUNDED' | 'PASSED', detail, ... };
    },
  }],
};
```
BOUNDED requires `owner` + `bound` or it is demoted to EXPLOITED. Drop modules into `labs/scenarios/` (or any dir via config `scenarioDirs`) and they load. Full semantics: `src/scenarios/contract.js` + tests in `test/scenarios/`.

Library state at 1.1.0: **49 attacks across 14 modules** (auth, authz, governance, guards, input, memory, proto-hygiene, recursion, upload, race, state, volume, taxonomy, session). Adding/renaming any attack means updating, in the SAME commit: the attacks doc + web catalog, the count pins (catalog=49, per-module census), and the changelog. The suite will find you otherwise; that is the pin wall doing its job.

Shipped packs (`packs/public/`, latest first): `next-middleware-shapes` (2, Next.js middleware subrequest wire), `vite-dev-shapes` (2, vite dev-file wire), `qs-shapes` (2, express-qs bracket-notation parser shapes), `cve-feed` (2, offline KEV/NVD snapshot), `crashtest-site` (18, the release self-check), `wp-money-shapes` (3, armedByKey), `wp-roles` (3, experimental), `wp-stock-smoke` (4). Pack manifests carry their own semver - never bump those for CLI-level releases.

## Common commands

```bashnpm test             # full suite (node --test); 317 pass was the 1.1.0 floor,
                     # 414 was the 1.1.1 tree, 426 is the 1.2.0 tree
                     # with PHP (the 7 armed WP e2e rows skip on PHP-less
                     # hosts, where the same tree reads 419 pass / 7 skips)
npm run check        # syntax check across every source/test file
npm run lint:docs    # docs links + style + fiction-signature scan
npx crashtest init
npx crashtest run    # dogfoods fixtures/demo against the committed ledger
(cd web && npm run build)   # the site: 6/6 pages prerendered is healthy
```

## Receipts before "green" (and the pre-tag ritual)

Only say a gate passed if you ran it this turn. The pre-tag ritual (caught three real bugs right before 1.0.0 - two determinism leaks, one count fiction):

1. Name census - attack names in code vs docs vs web vs tests.
2. Numeric claims vs code constants - every number in prose must have a constant behind it (9 headers x 6 values = 54 spoof VARIANTS, not "54 headers").
3. Determinism double-run - two consecutive `crashtest run`s must give byte-identical baselines (`labs/crashledger.json` + `labs/hardening.md`). `Date.now()` in a shipped surface is a bug; the ONE blessed exception is `labs/run-meta.json`, the sidecar cut stamp - it may move, the artifacts never do (pinned by the double-run test in test/cli.test.js).

## Version surfaces (one release, released as one number)

`package.json` is THE single version truth (crashtest#51, the eyestruct worked example) + `src/cli.js` VERSION (kept equal by `test/version.test.js`) + `web/package.json` (rides the root; drift refused by the same leg's census). Living surfaces never hand-copy the current number: dated era rows and `(vX.Y.Z)` annotations stay lawful, range pins stay lawful, everything that names the CURRENT version either derives from package.json or loses the number. Pack manifest semvers and the historical 0.1.0 Sigstore provenance link are their own truths - do not sweep them along on a bump.

## The walk-exit rule (crashtest#48)

A manual walk/probe session is not done until nothing it found is uncommissioned - every finding lands the same session as a battery leg, a pack verdict row, contract bullet, or a named docket row (owner + bound for accepted risks). crashledger is the memory rung: today's walk is where tomorrow's ledger rows come from, and a walk that closes without commissioning its probes wasted its one shot at novelty. Worked example: eyestruct@`70dfbea` (the walk's bug + its prose-only claims all became permanent legs at once).

## Prose flow (#49)

Living prose never hard-wraps at commit time: paragraphs flow (see `scripts/unwrap-prose.cjs`, adopted from eyestruct@`3adda1d`). Dated history keeps its era wording.

## Release procedure (maintainers)

Documented in [docs/publish.md](./docs/publish.md). Short version: npm Trusted Publishing (OIDC) - **no publish tokens anywhere**; release = bump version (package.json + `VERSION` in `src/cli.js`), commit, tag `vX.Y.Z`, push tag. If a tag-driven run fails and you need a retry, re-push the tag (`git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z`) - the integration cannot re-run a failed run directly. Provenance is signed automatically (attestations verifiable in the npm UI / Sigstore log).

## Project memory (vant)

This session chain runs on [vant](https://github.com/dhaupin/vant) - the crashtest dev-brain (12 public brain files + private working notes; nothing secret in either). Restorable anywhere from the stone in this repo:

```bash
# in a vant clone:
VANT_BRAIN_PASSWORD='quillstone-9fold' \
  node ./bin/vant.js horcrux restore /path/to/this/repo/horcrux/crashtest-p_quillstone-9fold.svg
```

- `horcrux/README.md` maps the folder; the brain's `boot.md` is the wake sequence, `state.md` carries receipts, `pins.md` the guarantee map.
- Re-seal after brain edits: edit the markdown in the vant install, then `vant horcrux create` (or `refresh`), swap the stone here, update the README in the same commit.
- The older rookworks horcrux lineage predates this repo stone; password references for THAT live in rook's identity files - ask the maintainer, don't fish for secrets.
- Session milestones also land via `VANT_BRAIN=crashtest vant memory learn ...`; process lessons are the source of most house rules above.

## Porting backlog

gistory's proven suites (tests/{sync-smoke,redteam,barrage}.ts) are the seed library source - the gistory repo is not yet reachable from this workspace; the libraries ship contract-first in the meantime. Port when access exists: strip the test-framework wrapper, keep the attack logic, delete project fixtures during the port. Watch vant issues #119/#120/#121 for org-grant hydration fixes.
