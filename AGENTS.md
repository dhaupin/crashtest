# AGENTS.md — working conventions for agents on this repo

> Crashtest is adversarial QA **for** agent-built software; this file is the
> conventions for agents building / maintaining **it**. Humans welcome too —
> this doubles as the project's contributor cheat sheet.
> See [README.md](./README.md) for the product, [docs/DEPLOY.md](./DEPLOY.md)
> for install/adopt/publish, [labs/prd-crashtest.md](./labs/prd-crashtest.md)
> for the contract, [labs/TASKS.md](./labs/TASKS.md) for the rolling log.

## The one law

**Attack code, not people. No sockets. Ever.** Every request the harness
fires is an in-process WHATWG `Request` handed to a registered handler. If a
scenario, attack, or test can't be expressed without opening a socket —
including "just one localhost fetch" — it's out of scope by design
(PRD principle 2). The fake transport IS the product.

## Layout

```
bin/crashtest.js        CLI entrypoint — shebang + main() from src/cli.js
src/cli.js              verbs: init | run [--config path] | --version | --help
src/harness/            counters (ops+cost), d1 (SQL-subset fake), kv, env, harness
src/scenarios/          contract.js (module contract) + loader.js + library/*
src/campaigns/runner.js campaign execution, verdict rows, cost accounting
src/report.js           ledger build/diff, §7 exit rules, markdown renderer
src/adapters/           hono / express / fastify in-process adapters + registry
src/rng.js              seeded xorshift (determinism)
fixtures/demo/app.js    the self-dogfood target (hardened + vulnerable variants)
crashtest.config.js     THIS repo's dogfood target config
labs/                   PRD · TASKS (rolling log) · crashledger.json · hardening.md
docs/publish.md         maintainer publish runbook (OIDC trusted publishing)
docs/                   PUBLIC docs (Jekyll, mirrors vant — deploys at
                        docs.creadev.org/crashtest via the freestruct layer);
                        every claim here is verified against the CLI (rule 7)
.github/workflows/      publish.yml (npm release on v* tags) · ci.yml (test+dogfood gate)
action.yml              composite GitHub Action for OTHER repos (crashtest gate)
```

## House rules (each one paid for in real bugs)

1. **Zero runtime dependencies.** Plain Node ESM, `node:test`, nothing else.
   `tsc` may only land in devDependencies (checkJs / `.d.ts` generation).
2. **JavaScript + JSDoc types**, no build step to run/test/publish (D3 in TASKS).
3. **Fail loudly, fail at cause.** Unsupported SQL, bad scenario modules, hung
   express routes — every gap names itself. Fix causes, never symptoms; no
   swallowed errors or suppressed tests.
4. **Deterministic.** Same commit → same findings. Seeded RNG
   (`src/rng.js`); anything time-derived (e.g. default keys) breaks the
   determinism principle — derive from `ctx.seed` instead.
5. **Exit rules are the CI contract** (PRD §7): exit non-zero ONLY on a new
   EXPLOITED finding or a REFUSED→EXPLOITED regression. Undeclared routes
   degrade to skipped-REFUSED (`skipped: true`) — never a false positive.
6. **Example-code vigilance:** `JSON.stringify` silently drops `__proto__`
   own- keys (see `hostileSerialize` in library/input.js); capture exit
   status explicitly when piping; `node --test` with a dir arg treats the dir
   as a module on some Node versions — use bare `node --test`.
7. **No fiction in docs.** Every README/AGENTS/DEPLOY claim must be verified
   against the actual CLI before it lands. If you can't run it, don't write it.

## Scenario library contract (summary)

```js
export default {
  name: 'my-module',            // kebab-case, unique
  description: 'one line',
  attacks: [{
    name: 'my-attack',          // kebab-case, unique in module
    async run(harness, ctx) {   // ctx: seed + config overrides
      // fire harness.run(...) requests, then return EXACTLY one record:
      return { verdict: 'REFUSED' | 'EXPLOITED' | 'BOUNDED', detail, ... };
    },
  }],
};
```
BOUNDED requires `owner` + `bound` or it is demoted to EXPLOITED. Drop modules
into `labs/scenarios/` (or any dir via config `scenarioDirs`) and they load.
Full semantics: `src/scenarios/contract.js` + tests in `test/scenarios/`.

## Common commands

```bash
npm test          # full suite (node --test)
npm run check     # syntax check across every source/test file
npx crashtest init
npx crashtest run # dogfoods fixtures/demo against the committed ledger
```

## Release procedure (maintainers)

Documented in [docs/publish.md](./docs/publish.md). Short version:
npm Trusted Publishing (OIDC) — **no publish tokens anywhere**; release =
bump version (package.json + `VERSION` in `src/cli.js`), commit, tag `vX.Y.Z`,
push tag. If a tag-driven run fails and you need a retry, re-push the tag
(`git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z`) — the
integration cannot re-run a failed run directly. Provenance is signed
automatically (attestations verifiable in the npm UI / Sigstore log).

## Project memory (vant)

This session chain runs on [vant](https://github.com/dhaupin/vant) — per-
project brains (crashtest brain) persisted inside the rook horcrux stone in
[dhaupin/rookworks](https://github.com/dhaupin/rookworks) (password references
live in rook's identity files; ask the maintainer, don't fish for secrets).
Session milestones land via `VANT_BRAIN=crashtest vant memory learn ...`;
process lessons are the source of most house rules above.

## Porting backlog

gistory's proven suites (tests/{sync-smoke,redteam,barrage}.ts) are the seed
library source — the gistory repo is not yet reachable from this workspace;
the libraries ship contract-first in the meantime. Port when access exists:
strip the test-framework wrapper, keep the attack logic, delete project
fixtures during the port. Watch vant issues #119/#120/#121 for org-grant
hydration fixes.
