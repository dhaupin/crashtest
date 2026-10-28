---
permalink: reference/packs
layout: default
title: Scenario Packs
description: The ONE extension surface - files in packs/, bundled imports, config-direct specifiers - all under the same contract and loader rules.
---

# Scenario packs (the ONE extension surface)

A **pack** is a bundle you author once and reuse across run roots: scenario
modules (same contract as the built-ins), bundled imports, and - going
forward - recipes and target declarations. Zero new concepts to learn: a
pack's scenario modules satisfy the exact same contract the seed libraries
do (that contract is now on the site:
[The Scenario Contract](/crashtest/reference/scenario-contract)).

> **One surface, three ways in.** Packs used to sit beside two other words
> ("plugins" via config import specifiers, "presets" via repo scaffolding).
> Since the unified-surface merge (v0.3, 2026-10) **packs are the master
> surface**: a pack can carry files in its own directory AND declare
> `"plugins"` imports in its manifest; the config's `plugins:` knob is the
> top-level escape for specifiers that belong to no pack. Presets are not a
> runtime surface at all - they are a CLI helper that *writes a config* for
> an agent-builder export (see
> [Builder Presets](/crashtest/reference/presets)). Language-wise: if it has
> a pack directory, it is a pack; if it is a bare specifier in the config,
> it is a plugin; if it scaffolds the config, it is a preset.

## The schema (pack.json, v1)

```json
{
  "schemaVersion": 1,
  "name": "my-money-pack",
  "description": "one line - what it attacks and how honest its oracles are",
  "version": "0.1.0",
  "entry": "index.js",
  "plugins": ["./bundled-canary.js", "some-npm-shape-pack"]
}
```

`entry` points at an ESM file under the pack directory whose default export
is a scenario module (`{ name, description, attacks: [{ name, run }] }`).
The scenario shape is crashtest's own profile and `loadPacks()` enforces it
by default. Host faces that carry OTHER entry profiles (the packstruct SPEC
section 7 clean case - a manifest-conformant, entry-importable minimal pack
of any profile) can defer just the shape check with
`loadPacks(roots, seen, check, { validateProfile: false })`: the manifest
contract (schemaVersion/name/description/entry) stays fully enforced, only
the scenario-shape validation moves to the host's own run-time check. The
CLI's `run` and `packs` surfaces keep the strict default - byte-identical
behavior, never silently weaker.

## Spec lint (`crashtest lint-packs`)

When your tree has packs, run the packstruct spec linter over them at
author time - the failure classes it catches (bad schemaVersion, name/dir
mismatch, missing entry, dotted-version rule) read better at edit time than
at first red-team run:

```bash
npx crashtest lint-packs [--deep] [--json] [--against <lib>] [dir]
crashtest run --lint-packs        # same lint INSTEAD of the campaign
```

Pin rules (issue #32):

- **The lane is opt-in passthrough, zero deps kept.** It executes the
  packstruct binary CURRENT REPO has installed (`node_modules/.bin` first,
  then PATH) and never downloads or bundles one. Own it: packstruct is an
  EXACT devDependency of the repo (`"packstruct": "1.0.0"`, no float -
  same commit -> same findings applies to the linter too).
- **Requested but not installed = exit 2** naming the fix
  (`npm i -D packstruct@<exact>`). Explicitly asked and never-working reads
  as a broken config, not as "skipped": OFF, not half-on. With no flag and
  no install, `run` behaves byte-identically to before (the loader's own
  checks stay the ground truth mid-run).
- **Exit codes ride through verbatim** (0 clean / 1 findings / 2 config-
  class); this lane is author-time DX + the id census + cross-host
  uniformity, never a correctness gate over the loader.
- **The dir is the packs ROOT**, with its `public`/`local` children - NOT
  `packs/public` (packstruct's contract root; passing the public dir reads
  as "0 packs checked, missing packs/public/public/"). An explicit dir
  passes through untouched, and the header line names the actual dir
  checked.

**`plugins` (optional, bundled imports)** - a pack can carry MORE scenario
modules than its own files: the manifest lists import specifiers (npm
packages, or ESM files the pack itself ships, relative to the **pack
directory**). They load through the same validator as everything else, join
the same campaign, and the plan labels carry the pack they came in with
(`pack:public/your-pack -> plugin:./bundled-canary.js`). A self-contained
pack can therefore ship its whole attack surface - files plus imports -
with zero config wiring by the adopting repo. A broken listing (missing
file, wrong shape, name collision) fails the run loudly naming the pack,
the same rule as every other surface.

**`env` (optional, binding claims)** - the pack TELLS the run root what it
needs of the harness instead of every attack hand-probing `harness.env` and
stringing its own skip prose:

```json
{
  "schemaVersion": 1,
  "name": "my-money-pack",
  "description": "one line",
  "env": {
    "d1":    { "DB": { "tables": ["charges", "settings"] } },
    "kv":    { "UPLOADS": {} },
    "routes": ["charge", "profile"],
    "seed": {
      "kv": { "UPLOADS": { "canary": "v1" } },
      "d1": { "DB": { "devices": { "rows": [{ "id": 1, "name": "d0" }] } } }
    }
  }
}
```

Semantics, pinned the same way everything else is:

- A pack loads with a `prerequisites` array of its **UNMET claims only**,
  computed against the built harness surface (bindings + registered
  routes). The CLI renders it; the attack-level skip verdicts stay the
  ground truth - claims are display, and a missing binding never invents
  one.
- `crashtest packs` (with a config) prints the claims on the pack line and
  an `UNMET` diagnostics line under any unmet claim:

```text
public @0.3.1 - my-money-pack: 3 attacks from public/my-money-pack / claims d1[DB: charges, settings], kv[UPLOADS], routes[charge, profile]
         a pack example
         prerequisites UNMET - d1[DB:charges], kv[UPLOADS], route[charge]
```

- `run --module-plan` carries the same rows into the plan blob
  (`plan.packs[].prerequisites`) and prints a flagged diagnostics line
  per affected pack (`pack <name> [<origin>]: N env claim(s) unmet (...)
  -`), so the plan answers "what would fire AND what would not fire" in
  one place. `run` prints the same line before the campaign.
- `env.seed` is the deterministic fixture passthrough. Seed rows land ONLY
  where the claimed binding already exists in the run root: kv keys set
  when absent, a no-op when identical, and **loud failures on conflict**
  (`env.seed may not overwrite run-root state`); d1 seed tables must be
  NEW tables (the run root owns its own) with FakeD1's own `{ rows,
  uniques }` shape and constructor-identical autoincrement. Seeds tick no
  counters. Same commit -> same seeds -> same findings (determinism law).
- A broken `env` block (wrong kind, wrong shape) fails the run loudly at
  pack validation, like every other manifest error.

## Where packs live

```text
packs/
+-- public/          <- tracked: shipped examples + shared packs
|   `-- my-pack/
`-- local/           <- gitignored: machine-private packs
    `-- my-private-pack/
```

`crashtest run` discovers BOTH visibility dirs under `packs/` at the run
root - automatically, with no config changes. Visibility is a privacy
convention, not a semantic difference: code in `local/` runs exactly like
code in `public/`; only the file location (and the gitignore) changes.

Installing `crashtest` from npm ships the two reusable shape packs
(`wp-money-shapes`, `wp-stock-smoke`) as installed files, so the
`packs: ['node_modules/crashtest/packs']` adoption shape is real, offline,
and version-clean. The `crashtest-site` pack is NOT in the tarball on
purpose: it is this repo's self-dogfood, bound to the OSS checkout's own
`web/` tree - vendoring it would blind it. `test/packaging.test.js` pins
the tarball contents either way.

## Packs from other repos (the killer feature, spelled out)

A pack does **not** need to live in the repo under attack. `crashtest run`
discovers `packs/` at the **run root** - the repo whose
`crashtest.config.js` declares the target - and the `packs:` knob accepts
any directory on disk. The natural shapes:

```js
// crashtest.config.js - in the run root, attacking ANOTHER repo's handlers
import { buildRoutes, ENV_SPEC } from '../target-repo/src/app.js';

export default {
  routes: buildRoutes(),
  env: ENV_SPEC,
  packs: [
    './packs',                                          // the run root's own
    '/abs/path/to/prestruct/packs',                     // another repo's packs/ wholesale
    '/abs/path/to/prestruct/packs/public/one-pack',     // one pack dir only
    'node_modules/@you/crashtest-pack',                 // an npm-vendored pack
  ],
};
```

A **self-contained pack** makes this even cleaner: because its manifest can
bundle its own imports (`"plugins"`), adopting a pack from another repo is
TWO lines in the consuming config - the `packs:` entry and nothing else.
No shims, no config wiring, no copy-paste; the loaded rows still label which
pack and repo they came from. Cross-repo name collisions fail the run
loudly, the same as everywhere else.

The ROOT-vs-visibility-dir footgun (the packstruct#13 family shape) is
closed on this side too: a `packs:` root whose basename is `public/` or
`local/` refuses LOUDLY (`pass the packs ROOT - the parent of public/`)
instead of silently scanning `public/public/` and loading zero packs. The
one-pack-dir shape above (a `pack.json` directly inside) stays legal -
that is a named pack, not a visibility dir.

This is how a pack *published in its own repo* (like a committed
`packs/public/` in the prestruct repo) gets consumed: point the consuming
run root's `packs:` at that repo's checkout - or, in CI, at the installed
npm package. The pack lives where the pack work lives; the attacks run
where the target code is.

The naming decision, so it doesn't come as a surprise: crashtest deliberately
does **not** use vant's `models/public` + `models/private` layout. "Models"
carries an AI/ML meaning in this ecosystem's vocabulary; "pack" is already
crashtest's own word (scenario pack), and `public`/`local` names the git
reality directly - tracked vs machine-private.

## Natural extension points

- **Public packs** (like the shipped [`wp-money-shapes`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-money-shapes/pack.json),
  [`wp-stock-smoke`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-stock-smoke/pack.json),
  and the experimental [`wp-roles`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-roles/pack.json)
  examples) live in the OSS repo and get versioned, reviewed, and shared.
  [`crashtest-site`](https://github.com/dhaupin/crashtest/blob/main/packs/public/crashtest-site/pack.json)
  is the OSS repo's own dogfood pack: it attacks the website crashtest
  ships (the /api/version Pages Function, deployed headers, prerendered
  HTML, sitemap, manifest, robots.txt) from any run root, and its first
  run caught a real bug in the version function (hostile registry shapes
  echoed straight through as a badge 200). [`cve-feed`](https://github.com/dhaupin/crashtest/blob/main/packs/public/cve-feed/pack.json)
  is the second shipped pack: a curated KEV/NVD snapshot slice for known-
  vulnerability disclosure -> checks the shipped banner set and the
  dependency version floor itself. Run time reads ONLY the committed
  `snapshot.json` (zero sockets, same commit -> same findings); refresh
  is a maintainer-side sync of the slice + CI byte-integrity join; the
  snapshot shape, the 27-row/8500-byte budget, and the word-boundary
  safety of its match tokens (the `ws`/`answer` case) are all pinned in
  [`test/cve-feed.test.js`](../../test/cve-feed.test.js). Adapter-prefix
  rule applies: it speaks the generic HTTP dialect, so no `wp-`-style
  prefix. [`qs-shapes`](https://github.com/dhaupin/crashtest/blob/main/packs/public/qs-shapes/pack.json)
  is the parser-shaped pack: it attacks the bracket-notation wire itself
  (the express extended-query / urlencoded parser and any qs-style
  expander) - a prototype-key canary carried on `__proto__` /
  `constructor.prototype` bracket keys, and a deep-`[0]`-nesting ladder
  that must stay under the fuzz floor (never 5xx, never an uncaught
  throw). Sweep semantics like cve-feed: every declared route fired,
  optional `ctx.routes` whitelist to narrow; two-way teeth (vulnerable
  parser EXPLOITED, hardened and ignorant wires honestly REFUSED, empty
  run roots skip honestly) pinned in
  [`test/qs-shapes.test.js`](../../test/qs-shapes.test.js).
  [`vite-dev-shapes`](https://github.com/dhaupin/crashtest/blob/main/packs/public/vite-dev-shapes/pack.json)
  and [`next-middleware-shapes`](https://github.com/dhaupin/crashtest/blob/main/packs/public/next-middleware-shapes/pack.json)
  complete the framework wire lane: vite-dev-shapes fires a differential
  over the `@fs`-module route (plain shape gated, bypass grammar like
  `?raw??` served = the gate was bypassed) plus a content-shape oracle for
  the `.`-env deny family (env-shaped bodies on deny-listed paths only -
  an anything-200 handler stays honestly REFUSED)
  [`test/vite-shapes.test.js`](../../test/vite-shapes.test.js); and
  next-middleware-shapes fires the middleware-subrequest header: known
  bypass grammars and a canary value probe, where bare-gated + served =
  the middleware got skipped, bare-gated + gated = the middleware verified
  its caller
  [`test/next-mw-shapes.test.js`](../../test/next-mw-shapes.test.js).
  All three speak the generic HTTP dialect (the adapter-prefix rule - no
  target-framework keys), so any run root can arm them.
- **Private packs** (the khf-style case: money paths guarded by a
  maintainer's own plugin, scenarios nobody else should have) live in
  `packs/local/` of a run root OUTSIDE the target repo. Nothing on disk is
  tracked; nothing is published.
- **npm packages**: a pack is just a directory of ESM files - publish it as
  a package and point `packs:` at its installed path (e.g.
  `packs: ['node_modules/@you/crashtest-pack']`), or vendor it into
  `packs/local/`.
- **npm metadata lives with the pack, offline-first.** A manifest may declare
  its `"package": "@you/crashtest-pack"` field (string, optional) and
  `"version"`; `npx crashtest packs` shows both inline and
  `npx crashtest packs --json` emits the machine inventory (last stdout
  line) with them. The REGISTRY LOOKUP stays in npm's own tools on purpose -
  the CLI is a drone that never dials out (PRD section 14): do the join in your CI
  script, e.g.
  `npx crashtest packs --json` paired with
  `npm view @you/crashtest-pack version`, and fail the step on drift.
  That keeps zero dependencies, zero sockets, and deterministic runs while
  still catching "a newer pack version is out" mechanically.
- **Scaffold by command**: `npx crashtest packs add <name>` creates
  `packs/local/<name>/` (schema-v1 manifest + a contract-valid stub module
  + the `.gitignore` entry) and `--public` puts it in `packs/public/`
  instead. The stub loads, lists, and runs immediately - fill in the
  `TODO` attacks and the pack's `moduleCtx[<name>]` vocabulary. The stub
  declares `armedByKey` in its module, so
  [`run --module-plan`](/crashtest/reference/module-plan) reports it as
  NEEDS-ARMING until you arm it.

## Naming convention

Pack names are kebab-case, and the prefix names the **surface the pack
speaks**, not the product that inspired it:

- Packs that ride a specific adapter get that surface as a prefix -
  `wp-money-shapes` speaks the WordPress harness dialect (`harness.wpState`
  ops), so `wp-`. Vant's private pack riding the raw-node adapter could be
  plain `vant-core` (no adapter prefix needed - it speaks generic HTTP).
- Transport-agnostic packs skip the prefix entirely.

**What "money" means here**: the dollar-shaped abuse family. The same
family the built-in `volume` library already covers (credential-stuffing,
storage-fill, cost-amplification) - attacks whose payoff is value: an
anonymous write with payment intent must not *stick* (write-volley), one
paid receipt must not buy a *second* registration (txn-replay), a metered
wall must *trip* under rapid floods (gate-burst). "Shapes" = engines, not
instances: every name (CPTs, meta keys, actions) is injected from the
target's `moduleCtx[<pack-name>]`, so one pack serves every plugin and the
khf/fm-specific lore stays in their private instantiations.

## Public vs local - the decision rule

- **`packs/public/`** is for **shapes reusable across many targets** -
  vocabulary comes from each target's config, no product's names hardcoded.
- **`packs/local/`** is for **instance lore** - one target's real routes,
  one maintainer's plugin internals (khf's money flows live here, in khf's
  own run root, not in this repo).

So: no `packs/public/vant-*` branded by target. Vant's generic surface is
already covered by the built-in libraries (the raw-node run-root recipe
landed 13/13 REFUSED with zero custom code), and anything vant-*specific*
- brain endpoints, identity-file guards - is instance lore by definition:
run `npx crashtest packs add vant-core` in the vant run root and keep it
private. A public pack earns that visibility by being provably
target-independent, like the shipped wp-money-shapes.

## Config knobs

```js
// crashtest.config.js
export default {
  packs: true,       // default - discover packs/public/ + packs/local/
  // packs: false,   // opt out entirely (the dogfood does: shipped packs
  //                 //   which need their own worker must not join the demo)
  // packs: ['/abs/path', 'node_modules/@you/crashtest-pack'],
};
```

Name collisions between a pack and the built-in libraries (or another pack)
fail the run loudly - one name, one attack, no ambiguity.

Inventory any run root with:

```bash
npx crashtest packs
# local @0.0.1 - vant-core: 1 attacks from local/vant-core / armedBy moduleCtx['vant-core']
#         TODO: one line on what vant-core attacks

npx crashtest packs add vant-core          # -> packs/local/vant-core/ (gitignored)
npx crashtest packs add my-shapes --public # -> packs/public/my-shapes/ (tracked)
npx crashtest packs --json                 # machine inventory (LAST stdout line) - pair with `npm view <pkg> version` in CI for version joins
```

## Family lanes (receipts, not asks)

The packstruct@1 grammar is shared with the wider struct family, and
this repo's lint lane is where the family's staged packs get grating
receipts (files-on-disk, no runtime dependency, exact-pin receipt):

- **eyestruct** (dhaupin/eyestruct-staging, staged on
dhaupin/gistory@`19f1db8049ff8a030e8abab2bee03e1b6c988477`): 3 packs
(`eye-ci-gate`, `eye-shapes`, `eye-text-leg`) lint CLEAN at both
shallow and deep levels through this repo's exact-pinned packstruct
1.0.0 - deep probes 3 modules, 0 census ids (check-profile shape:
verifier modules carry cases, not attacks). Receipt cut 2026-10-26
before eyestruct's npm debut, so the trifecta grammar (crashtest
scenario / eyestruct visual / poststruct audit, packstruct
orchestrating) was already true when it landed. Visit-later note,
recorded here so it isn't re-fished from the staging tree: eyestruct's
verdict taxonomy adds a PASSED bucket ("the safe path held") whose
crashtest counterpart opened in 1.2.0's own census - when this row
flips to the live repo citation on go-live day, re-read their ledger
semantics once against our PASSED contract and either cite the
alignment or argue the difference on their tracker.
- **poststruct**: staging lane still in flight (gistory's
`poststruct-staging/`); its own `run-packs.mjs` loader already receipts
8/8 on the packstruct conformance cases (gistory `labs/ecosystem.md`).
No crashtest-side copy exists yet - this lane will add its receipt when
the staging settles.

Citation rule for every row here: the exact gistory sha (the staging
trees move), grating receipt in THIS repo's lint lane unless the row
says otherwise. Same-commit->same-findings applies to receipts too.

