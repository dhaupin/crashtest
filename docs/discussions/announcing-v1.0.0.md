---
permalink: discussions/announcing-v1.0.0
layout: default
title: Announcing crashtest v1.0.0
description: The crashtest v1.0.0 release post - the file IS the announcement; copy the raw markdown from GitHub into Discussions. Technical, changelog-style.
---

# crashtest v1.0.0

crashtest is seeded, in-process adversarial QA for agent-built app code.
v1.0.0 is the first stable release. It is on npm now:

```bash
npm i -g crashtest
# or run without installing:
npx crashtest init
npx crashtest run
```

This post covers what the harness actually does, how a run executes, and
why it fails CI the way it does. Repo links at the end.

## Why it exists

Agent-built code ships fast, and "looks green" is not the same as "held up
under attack". SAST finds code smells; a pentest is slow, manual, and long
after the commit. crashtest closes the gap: it fires seeded campaigns of
real attacks at your route handlers and turns the results into a ledger
your CI can gate on. Every miss that matters - an attack the handler used
to refuse and now serves - fails the build.

## The transport is the product

Every request the harness fires is an in-process WHATWG `Request` handed to
a registered handler. No sockets, ever - not even "just one localhost
fetch". If an attack or scenario cannot be expressed without opening a
socket, it is out of scope by design. Same commit, same findings: the RNG
is seeded, and the committed ledger is byte-stable per commit (the cut
stamp lives in a sidecar, `labs/run-meta.json`, so the artifacts never
move).

## How a run executes

`crashtest run [--config path]` walks one pipeline:

1. **config** - `crashtest.config.js` declares the target: routes, env
   spec, packs (bundled or config-direct), plugins. Missing config is an
   honest exit 2 with a shape hint, not a mysterious 500.
2. **harness** - an explicit route table plus the fake bindings:
   FakeD1 (an in-memory SQL subset that throws D1-shaped errors),
   FakeKV, env. Op counters and cost meters meter every request.
3. **attacks** - the library and your loaded packs run as scenario
   modules. Each attack returns exactly one record:
   `REFUSED`, `EXPLOITED`, or `BOUNDED` (owner + bound, or it demotes).
4. **ledger + diff** - findings diff against the committed baseline.
5. **exit rules** - the CI contract: nonzero ONLY on a new `EXPLOITED`
   finding or a `REFUSED -> EXPLOITED` regression. Undeclared routes
   degrade to skipped `REFUSED` rows, never false positives. Accepted
   risks need an owner and a bound or they count as findings.

## The attack library

49 attacks across 14 modules ship in v1.0.0: auth, authz, governance,
guards, input, memory, proto-hygiene, recursion, upload, race, state,
volume, taxonomy, and session. Every module is proven two ways in the
suite: vulnerable fixtures score `EXPLOITED`, hardened fixtures score
`REFUSED`.

## Packs: the one extension surface

A pack is a bundle authored once and reused across run roots - scenario
modules under the same contract, bundled imports, per-pack fixtures.
crashtest implements the [packstruct@1](https://github.com/dhaupin/packstruct)
contract (SPEC v1, pinned commit in the README). Eight production packs
ship (36 attacks): the release self-check site pack (18, dogfoodes this
repo end to end), the wire packs for `qs`-style query expansion,
vite dev files, and Next.js middleware subrequests, the offline KEV/NVD
`cve-feed`, and three WordPress packs riding the v0.3 subprocess spike
(NDJSON over stdio - a wire format to design against, not a transport).

## Harness primitives you can build on

The engine surface is meant to be picked up by agents writing their own
scenarios: seeded fixtures, the route-diff comparator (`diff(a, b)` and
`snapshot(name)`), declarative pods (`buildPods` - two or more env specs
sharing one route table, cross-talk by construction), the campaign runner
with per-attack cost deltas, and `evalExpectations` (a table-is-complete
validator that names both sides of any mismatch).

Adapters for hono, express, fastify, and plain node wrap your existing
handlers in-process; a composite GitHub Action (`action.yml`) makes the
CI gate a one-file add. Builder presets (`lovable`, `bolt`, `replit`)
print a starter config from what `detect()` actually finds in an exported
repo, and name plainly what they could NOT resolve rather than guessing
from the builder's name.

## Zero everything (by design)

Zero runtime dependencies. Plain Node ESM and `node:test`, JavaScript
plus JSDoc types, no build step to run, test, or publish. Node >= 18.17.
The suite is the wall: the v1.0.0 floor is 176 passing tests plus the
dogfood run, where every commit attacks crashtest's own fixtures against
the committed baseline.

## Provenance

Releases publish from GitHub Actions via npm Trusted Publishing (OIDC) -
no publish tokens anywhere. Provenance attestations are signed
automatically; verify an install:

```bash
npm audit signatures
```

## What v1 does not do

- No sockets and no live targets: if it needs a wire, bring the wire to
  the harness. The WordPress path is the one published exception-shaped
  spike, and it is a subprocess contract, not a transport.
- The docs narrate packs, plugins, presets, and `--out-dir` (v0.2-v0.4
  surface); v1.0.0 is the release that locks every version surface to the
  same number after the `package.json` lagged through the pre-1.0
  lineage.

## Links

- npm: <https://www.npmjs.com/package/crashtest>
- Docs: <https://docs.creadev.org/crashtest>
- Site (built with the repo's own `/web`): <https://crashtest.creadev.org>
- Dashboard (render any ledger in-browser, zero backend):
  <https://crashtest.creadev.org/dashboard>
- GitHub: <https://github.com/dhaupin/crashtest>
- Issues: <https://github.com/dhaupin/crashtest/issues>
- Full changelog:
  <https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md>

The service contract is stable from here: breaking changes get a major
bump, findings and exit rules are the compatibility surface, and the
seeded ledgers keep old `crashtest.config.js` files running. If you gate
a repo on it, tell us what got through.

