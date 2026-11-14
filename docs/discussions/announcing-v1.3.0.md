---
permalink: discussions/announcing-v1.3.0/
layout: default
title: Announcing crashtest v1.3.0
description: The crashtest v1.3.0 release post - the file IS the announcement; copy the raw markdown from GitHub into Discussions. Technical, changelog-style.
version: 1.3.0
---

# crashtest v1.3.0

crashtest is seeded, in-process adversarial QA for agent-built app code. v1.3.0 is additive on the 1.2.0 line: a guard that stops the shipped attack catalog drifting from the code, opt-in row-level concurrency that races only rows declared safe to race, three new library rows from the vant audit round, and a ninth shipped pack for the outbound-request (SSRF) class. This post ships with the v1.3.0 tag: npm has the tarball by the time you read it.

```bash
npm i -g crashtest
```

## What landed

**The catalog-sync guard - the shipped catalog can no longer drift from the code.** `scripts/check-catalog-sync.cjs` reads the LIVE sources (the real scenario loader for `src/scenarios/library/*`, the real pack loader for `packs/public/*`) and refuses when a shipped row or pack is missing from `docs/reference/attacks.md`, `docs/reference/packs.md`, or `web/src/pages/Attacks.jsx` - or when any stated count disagrees with reality. It runs as `npm run lint:catalog` inside the gate and CI, and its battery proves it bites both ways over real loader output: a row missing from the page, a row missing from the docs catalog, and a stale pack entry each fail, naming the row.

**Row boot declarations + opt-in row-level concurrency.** A row may now declare `needs: [...]` (the env bindings / KV stores / D1 tables / routes it touches, surfaced in `--module-plan`) and `isolated: true` (it holds no cross-row state, so it MAY race). `crashtest run --concurrency <n>` races maximal runs of declared-isolated rows N-wide, each on its OWN fresh harness, so the fake backend is never shared; results land in original order regardless of completion order, so the run blob and ledger stay byte-stable per commit. A module with `beforeAll`/`afterAll` never races - the serial fallback is honest, never a wrong verdict. Default `concurrency: 1` is today's behavior byte-for-byte. `--per-row` prints a per-row accounting table so a run root can see where its wall went without hand-instrumenting.

**Three library rows from the vant audit round.** The `auth` module gains `invalid-credential-fail-open` (an unsigned alg:none, expired, and wrong-key token fired at the auth-check route; a grant to any is the `if (!verify())` bug where a verdict object reads as truthy) and `over-return-allowlist` (each declared route's JSON response top-level keys walked against its allowlist, or against the internal-field family plus any value carrying a planted secret). The `authz` module gains `low-priv-authority-verb-deny` (a declared SET of authority verbs driven as a low-priv principal; any allow is a finding naming the verb, so the blocklist becomes a living contract). All three carry two-way teeth, and the library census moves 49 attacks / 14 modules -> 52 / 14.

**`egress-guard-shapes` - a ninth shipped pack, the outbound-request (SSRF) lane.** A hostile internal-target corpus (the dotted v4 forms, the IPv6 wrappers that reach the same address - IPv4-mapped, IPv4-compatible, NAT64, dotted and hex tails - the full internal v6 ranges, and scheme/userinfo/encoding tricks) is fired at the target's OWN allow/deny guard route. The guard answers in-process and the pack never dials, so the one law holds; a public-control differential pins the other direction, so a blanket-deny guard is honestly REFUSED rather than mistaken for a strong one. The pack census moves 8 packs / 36 attacks -> 9 packs / 38 attacks.

**`crashtest-site` declares its `env.routes`.** The shipped site pack now carries the host-owned `env` block in its manifest instead of leaving the block spec'd-but-unused family-wide. The loader's claim checker resolves every declared route against the real run root, and the pack's self-audit fixture pins the block so it cannot rot.

## Also in this round

The docs lane folded into the family's one reusable workflow (this repo is a thin caller of it), the docs-lane pin moved `freestruct@1.1.0` -> `1.2.0` to clear the basePath false positives, `action.yml` pinned its actions and dropped a duplicate key, and every GitHub Action ref is a 40-hex commit SHA (pins, never floats).

**The release ladder's `verify` job now waits for `release`.** `verify` declares `needs: [publish, release]`, closing a race where a bare `needs: publish` ran it CONCURRENTLY with `release`: on a fresh cut the registry read replicas had not settled and the tarball was not yet attached, so a publish that in fact succeeded failed red and needed a manual re-run (first seen on the packstruct 1.1.0 cut). The release-attach poll widened 120s -> 300s and the registry poll 120s -> 360s, and `test/release-verify.test.js` pins the dependency so a regression fails by name.

## Links

- Repo and docs: https://github.com/dhaupin/crashtest / https://docs.creadev.org/crashtest
- Attack catalog: https://docs.creadev.org/crashtest/reference/attacks
- Changelog: https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md
- Issues: https://github.com/dhaupin/crashtest/issues
