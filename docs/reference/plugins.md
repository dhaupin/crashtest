---
permalink: reference/plugins
layout: default
title: Plugin Imports
description: Plugins are the packs surface's bundled-import mechanism - one contract, one loader, one campaign. Config-direct specifiers are the top-level escape hatch.
---

# Plugin imports (inside packs, or config-direct)

Plugins are **not a separate system** - they are the bundled-import mechanism
of the [Scenario Packs](/crashtest/reference/packs) master surface. The same
scenario contract, the same loader rules, the same campaign. Choosing
between the surfaces is a packaging decision, not a learning problem:

| How the scenario reaches your run | What it is called |
|---|---|
| files in `packs/<visibility>/<name>/` + manifest entry | **pack** (the default) |
| an import specifier listed in the pack's own `pack.json` | **plugin (bundled)** - the pack ships its imports |
| an import specifier listed in `crashtest.config.js` | **plugin (config-direct)** - the escape hatch |

A **plugin** is a scenario module delivered as an importable specifier - an
npm package, or a local ESM file. The same contract as libraries and packs;
everything lands in one campaign.

## Bundled (inside a pack) - the unified path

```json
// packs/public/your-pack/pack.json
{
  "schemaVersion": 1,
  "name": "your-pack",
  "description": "entry + bundled imports, self-contained",
  "entry": "index.js",
  "plugins": ["./bundled-canary.js", "some-npm-shape-pack"]
}
```

Bundled specifiers resolve against the **pack directory** (a pack ships its
own files), join the same campaign, and the module plan carries the pack
origin with them: `pack:public/your-pack -> plugin:./bundled-canary.js`.
An adopting repo picks up the whole pack - entry + imports - with zero
config wiring.

## Config-direct (the escape hatch)

```js
// crashtest.config.js
export default {
  routes: buildRoutes(),
  env: ENV_SPEC,
  plugins: [
    'crashtest-plugin-rails-shapes',   // npm package (imported as-is)
    './shims/wallet-profile.js',       // local file, relative to this config
  ],
};
```

Use this when the scenario belongs to no pack - a one-off shim, a registry
package you don't vendor. Relative paths resolve against the **config
file's directory**, not the cwd - a run root beside the target resolves
plugin paths the same way the target sees them.

## The rules (shared with packs, non-negotiable)

1. **Same contract.** A plugin must default-export `{ name, description,
   attacks: [{ name, run(harness, ctx) => one verdict }] }` - the same
   validator `src/scenarios/contract.js` applies to libraries, packs, and
   plugins alike.
2. **Fail loudly at cause.** An unresolvable specifier, a TypeScript plugin
   (crashtest imports plain ESM JS only - it never transpiles), a syntax
   error inside the module, or a contract violation fails the run naming
   both the specifier and the reason. A broken import is a config error,
   never a silent gap.
3. **One name, one module.** A module exporting a scenario name that is
   already loaded (library, pack, bundled import, or another plugin) throws
   with the origin of the earlier claim. Rename one of them.
4. **Knob shape matters.** The manifest's `plugins` and the config's
   `plugins:` must both be arrays of non-empty strings; anything else fails
   at validation time with the expected shape.

## Determinism and dependencies

Plugins run under the same seeded ctx as every other module - a plugin is
as reproducible as the built-ins. The zero-dependency rule covers what
*crashtest* ships; a plugin that imports its own dependencies owns them,
and a missing dependency surfaces as the honest resolver error, not a
crash.

## Where plugins show in the plan

`crashtest run --module-plan --json` labels every module with its delivery
surface. Config-direct rows read `plugin:<specifier>`; bundled rows carry
the pack they came in with. Libraries, packs, bundled imports, and plugins
sort together by module name - one campaign, one plan, honest labels.
