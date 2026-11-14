---
permalink: discussions/announcing-v1.4.0/
layout: default
title: Announcing crashtest v1.4.0
description: The crashtest v1.4.0 release post - the file IS the announcement; copy the raw markdown from GitHub into Discussions. Technical, changelog-style.
version: 1.4.0
---

# crashtest v1.4.0

crashtest is seeded, in-process adversarial QA for agent-built app code. v1.4.0 is additive on the 1.3.0 line: a pack-relevance filter that fails closed, native row sharding that puts the serial phase on a CI matrix, and a public harness builder so the campaign runner is adoptable from the library API. This post ships with the v1.4.0 tag: npm has the tarball by the time you read it.

```bash
npm i -g crashtest
```

## What landed

**Pack relevance (`requires` / `provides`), and an escape hatch (`ignore` / `.packignore`).** A pack can declare the target capabilities it needs (`"requires": ["wordpress"]`); a run root declares what its target IS (`provides: ['node', 'cloudflare-pages']`). The loader skips any pack whose `requires` the target does not provide - before import, so a WordPress-only pack costs a Cloudflare Pages run nothing. This is the honest inverse of a deny-list: a `.packignore`-style deny-list fails open (a newly-shipped pack runs everywhere until someone remembers to deny it there), while `requires` fails closed (a pack that names an unmet capability skips itself, forever, with no per-app upkeep), travels with the pack as a manifest field packstruct can lint, and reports the skip honestly - named and tallied, never a silent green. Relevance engages only once a run root declares a non-empty `provides`, so a run root that declares nothing is byte-identical to before. The escape hatch stays for what relevance cannot express: config `ignore: ['wp-*']` or a run-root `.packignore` file (one token per line, `#` comments, `*` globs). `ignore` wins over relevance. Every shipped target-specific pack carries its token - `wp-money-shapes`/`wp-roles`/`wp-stock-smoke` need `wordpress`, `next-middleware-shapes` needs `next`, `vite-dev-shapes` needs `vite`, `qs-shapes` needs `qs` - so the WP packs stop riding every non-WP run.

**Native row sharding for the serial phase (`--shard i/N`).** `--concurrency` only races rows that declare `isolated: true`; when the wall is a serial phase, the lever is now `--shard i/N`: run only the rows whose global position satisfies `position % N == index`, so a CI matrix of N processes covers the whole run with no coverage loss - every row lands in exactly one shard, in the same order, with the same verdict the unsharded run would give. A row that declares `fanout: true` (its work is a partitionable route sweep) runs in every shard on its own slice instead, so a single expensive sweep row divides by N too; merge fanout rows by worst verdict per `position`. A shard holds a partial row set, so it is read-only against `labs/` - union the shards in the caller, or pass `--expect-baseline` / `--out-dir`. Sharding refuses loudly when a module holds cross-row state, and a malformed or out-of-range `i/N` is a loud config error, never a silently-empty shard that greens. A fanout row reads the new `ctx.shard` descriptor to learn its slice - a distinct key from the overloaded `ctx.routes`, which is why `proto-hygiene` and `auth/secret-watermark` now declare `fanout: true`.

**`buildTargetHarness` is exported, so `--concurrency` is adoptable from the library API without forking the CLI.** A run root that drives `runCampaign` directly needs an equivalently-seeded harness per racer; the builder the CLI already uses is now public (`import { buildTargetHarness } from 'crashtest'`), and the `harnessFactory(moduleName, attack)` contract is documented in the scenario-contract reference.

## Also in this round

**Per-row request accounting is O(1), not O(rows x log).** `runOne` read `harness.log().length` twice per row, and `log()` returns a copy of the whole per-request log, so a campaign of R rows over a harness that served Q requests allocated O(R x Q) slots for a number it only ever read. The harness gains `logCount()` (a plain length read) and the runner uses it - same number, no copy.

**The packs-ROOT scan now forwards `validateProfile`**, so a root-shaped host load (the shape packstruct's `audit-conformance` materializes) honors the profile the one-pack-dir path already honored; the manifest contract stays fully enforced on both paths and the strict default is unchanged.

**The family floors moved with this cut:** the prestruct declaration floor is `^1.3.0` (refused below by `check-prestruct-pins.cjs`), and the exact `packstruct` devDependency advances `1.0.0 -> 1.1.0` with the SPEC v1 transcript re-cut byte-exact from the v1.1.0 release commit.

## Links

- Repo and docs: https://github.com/dhaupin/crashtest / https://docs.creadev.org/crashtest
- Attack catalog: https://docs.creadev.org/crashtest/reference/attacks
- Changelog: https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md
- Issues: https://github.com/dhaupin/crashtest/issues
