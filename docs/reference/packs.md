---
permalink: reference/packs
layout: default
title: Scenario Packs
description: The extension surface — author packs once, keep them public or private by directory, load them without config changes.
---

# Scenario packs (the extension surface)

A **pack** is a bundle you author once and reuse across run roots: scenario
modules (same contract as the built-ins), and — going forward — recipes and
target declarations. Zero new concepts to learn: a pack's scenario modules
satisfy the exact same contract the seed libraries do.

## The schema (pack.json, v1)

```json
{
  "schemaVersion": 1,
  "name": "my-money-pack",
  "description": "one line — what it attacks and how honest its oracles are",
  "version": "0.1.0",
  "entry": "index.js"
}
```

`entry` points at an ESM file under the pack directory whose default export
is a scenario module (`{ name, description, attacks: [{ name, run }] }`). A
pack.json that exists but is broken fails the run loudly — a config error,
never a silent gap.

## Where packs live

```
packs/
├── public/          ← tracked: shipped examples + shared packs
│   └── my-pack/
└── local/           ← gitignored: machine-private packs
    └── my-private-pack/
```

`crashtest run` discovers BOTH visibility dirs under `packs/` at the run
root — automatically, with no config changes. Visibility is a privacy
convention, not a semantic difference: code in `local/` runs exactly like
code in `public/`; only the file location (and the gitignore) changes.

The naming decision, so it doesn't come as a surprise: crashtest deliberately
does **not** use vant's `models/public` + `models/private` layout. "Models"
carries an AI/ML meaning in this ecosystem's vocabulary; "pack" is already
crashtest's own word (scenario pack), and `public`/`local` names the git
reality directly — tracked vs machine-private.

## Natural extension points

- **Public packs** (like the shipped [`wp-money-shapes`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-money-shapes/pack.json)
  and [`wp-stock-smoke`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-stock-smoke/pack.json)
  examples) live in the OSS repo and get versioned, reviewed, and shared.
- **Private packs** (the khf-style case: money paths guarded by a
  maintainer's own plugin, scenarios nobody else should have) live in
  `packs/local/` of a run root OUTSIDE the target repo. Nothing on disk is
  tracked; nothing is published.
- **npm packages**: a pack is just a directory of ESM files — publish it as
  a package and point `packs:` at its installed path (e.g.
  `packs: ['node_modules/@you/crashtest-pack']`), or vendor it into
  `packs/local/`. First-class npm metadata (`packs add`) is a planned step
  once the schema settles.

## Config knobs

```js
// crashtest.config.js
export default {
  packs: true,       // default — discover packs/public/ + packs/local/
  // packs: false,   // opt out entirely (the dogfood does: shipped packs
  //                 //   which need their own worker must not join the demo)
  // packs: ['/abs/path', 'node_modules/@you/crashtest-pack'],
};
```

Name collisions between a pack and the built-in libraries (or another pack)
fail the run loudly — one name, one attack, no ambiguity.

Inventory any run root with:

```bash
npx crashtest packs
# public 0.3.0 — wp-money-shapes: 3 attacks from public/wp-money-shapes
#         WP money-flow attacks (nonce-less volley, payment replay, gate burst)…
```
