---
permalink: reference/plugins
layout: default
title: Plugins
description: Community scenario modules by import specifier - the same contract as packs and libraries, loaded straight from npm or a local file.
---

# Plugins (importable scenario modules)

A **plugin** is a scenario module delivered as an importable specifier - an
npm install or a local ESM file - listed in the config's `plugins` knob. It is
the third delivery surface for the ONE scenario contract; libraries, packs,
and plugins all load through the same validator and land in the same campaign:

| Surface | How it ships | Where it lives |
|---|---|---|
| libraries | ship with crashtest | `src/scenarios/library/` |
| packs | file-bundles, manifest + entry | `packs/public/`, `packs/local/` |
| plugins | import specifiers | npm package, or config-relative ESM file |

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

Relative paths resolve against the **config file's directory**, not the cwd -
a run root beside the target resolves plugin paths the same way the target
sees them.

## The rules (shared with packs, non-negotiable)

1. **Same contract.** A plugin must default-export `{ name, description,
   attacks: [{ name, run(harness, ctx) => one verdict }] }` - the same
   validator `src/scenarios/contract.js` applies to libraries and packs.
2. **Fail loudly at cause.** An unresolvable specifier, a TypeScript plugin
   (crashtest imports plain ESM JS only - it never transpiles), a syntax
   error inside the module, or a contract violation fails the run naming both
   the plugin and the reason. A broken plugin is a config error, never a
   silent gap.
3. **One name, one module.** A plugin exporting a scenario name that is
   already loaded (library, pack, or another plugin) throws with the origin
   of the earlier claim. Rename one of them.
4. **Shape of the knob.** `plugins` must be an array of non-empty strings.
   Anything else - a bare string, a number, an empty string entry - fails at
   config-read time with the expected shape.

## Determinism and dependencies

Plugins run under the same seeded ctx as every other module - a plugin is as
reproducible as the built-ins. The zero-dependency rule covers what
*crashtest* ships; a plugin that imports its own dependencies owns them, and
a missing dependency surfaces as the honest resolver error, not a crash.

## Where plugins show in the plan

`crashtest run --module-plan --json` labels every module with its delivery
surface. A plugin row reads `source: "plugin:<specifier>"`, and packs,
libraries, and plugins sort together by module name - one campaign, one plan,
honest labels.
