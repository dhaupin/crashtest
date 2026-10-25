---
permalink: discussions/announcing-v1.1.0
layout: default
title: Announcing crashtest v1.1.0
description: The crashtest v1.1.0 release post - the file IS the announcement; copy the raw markdown from GitHub into Discussions. Technical, changelog-style.
---

# crashtest v1.1.0

crashtest is seeded, in-process adversarial QA for agent-built app code. v1.1.0 is the first minor release since 1.0.0, and every change in it is additive - new engine surface, new library families, new QA primitives, a packstruct lane. This post ships with the v1.1.0 tag: npm has the tarball by the time you read it.

```bash
npm i -g crashtest
# or run without installing:
npx crashtest init
npx crashtest run
```

## The fake bindings grew up

FakeD1 reaches v0.3: an in-memory SQL subset that throws D1-shaped errors, now with `IN (SELECT ...)` subqueries, one-key joins, GROUP BY/HAVING with scoped aggregates, multi-key ORDER BY, FROM-less scalar selects, scalar functions, JSON extraction, `CREATE TABLE [IF NOT EXISTS]` / `ALTER TABLE ADD COLUMN` (the ensureSchema pattern), and SQLite-compatible date functions that all read one fixed epoch - the determinism law holds: same seed, same rows, no `Date.now` anywhere.

FakeKV reaches v0.2: deterministic TTLs against the same fixed clock, `getWithMetadata`, honest cursor pagination, and a loud per-value size cap (Workers-KV 25 MiB default). Both bindings keep their v1.0 wire contracts byte-for-byte, so older scenarios keep running.

## Harness primitives for stateful QA

The engine surface agents can now build on directly:

- `harness.snapshotStore()` + `harness.diffSnapshots(before, after)` - a uniform snapshot-diff oracle across every fake binding (D1 rows match by id, KV by key, tables added/removed wholesale), fully sorted, fully copied, byte-stable in evidence.
- `crashtest lint-determinism` - a flat grep over your declared surfaces for the wall-clock/unseeded-randomness family (`Date.now`, `new Date(`, `Math.random`), findings exit 2 naming every file:line; runs as a one-line CI pre-flight (`run --lint-determinism`).
- declarative pods (`buildPods`) - two or more env specs sharing one route table, cross-talk by construction.
- `evalExpectations` - a table-is-complete validator that names both sides of any mismatch.
- `crashtest init` scaffolds a working pack (manifest + entry + a running attack immediately) instead of placeholder files.
- scenario contract lifecycle hooks (`beforeAll`/`afterAll`) are live.
- campaign runner with per-attack op/cost deltas, and a pinned two-way proof: a hardened campaign root scores REFUSED end-to-end, its naive twin scores EXPLOITED on the same handler table.

## The library: 49 attacks, 14 modules

The general library grows from 30 attacks/12 modules to 49 attacks/14 modules, both additions armed from the vant census: memory (9 attacks) grades versioned-note discipline - silent overwrite, stale-read poisoning, contradiction carrying, hallucination probes, resolution order; governance (10 attacks) grades succession, escrow, trust floors, and locks - two-key release, expiry fail-closed, capability containment, TTL honesty, owner fencing. Every module is still proven two ways: vulnerable fixtures score EXPLOITED, hardened fixtures score REFUSED.

## Packs: the packstruct lane

The pack contract is frozen at SPEC v1, and the CI lane moved to the published linter: an exact `packstruct@1.0.0` devDependency, `packstruct lint packs/` plus a byte-equality proof of the SPEC transcript straight out of node_modules, and committed pack self-audit fixtures for all 8 shipped packs. The shared refusal battery (18 hostile manifest shapes) runs in-repo against a transcribed corpus with a self-verifying generator - the columns between host and linter are observed, not hand-written, and the six documented host differences are locked as findings-per-silence. Eight packs still ship: the self-check site pack, the qs/vite/Next.js wire packs, the offline KEV/NVD cve-feed, and the three WordPress packs riding the v0.3 subprocess spike.

Adapters for hono, express, fastify, and plain node wrap your existing handlers in-process; the composite GitHub Action (`action.yml`) and builder presets (lovable, bolt, replit) carry over unchanged.

## Zero everything (by design)

Zero runtime dependencies. Plain Node ESM and `node:test`, JavaScript plus JSDoc types, no build step to run, test, or publish. Node >= 18.17. The suite is the wall: the v1.1.0 floor is 317 passing tests plus the double-run dogfood check, where the same commit must produce byte-identical ledgers.

## Provenance

Releases publish from GitHub Actions via npm Trusted Publishing (OIDC) - no publish tokens anywhere. Provenance attestations are signed automatically; verify an install:

```bash
npm audit signatures
```

## Links

- npm: <https://www.npmjs.com/package/crashtest>
- Docs: <https://docs.creadev.org/crashtest>
- Site (built with the repo's own `/web`): <https://crashtest.creadev.org>
- Dashboard (render any ledger in-browser, zero backend): <https://crashtest.creadev.org/dashboard>
- GitHub: <https://github.com/dhaupin/crashtest>
- Full changelog: <https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md>

The service contract carries over from 1.0.0: exit rules and ledger shape untouched, old configs keep running, findings are the compatibility surface. If you gate a repo on it, tell us what got through.
