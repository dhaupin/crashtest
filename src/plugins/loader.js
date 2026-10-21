// src/plugins/loader.js - the v0.3 community plugin API (PRD "the ecosystem").
//
// A plugin is a scenario module shipped as an importable ESM specifier -
// an npm package, a local file, or a relative path. The `plugins` config
// knob lists them; every listed module must satisfy the SAME scenario
// contract the built-in libraries and packs use. One contract, three delivery
// surfaces:
//
//   libraries: src/scenarios/library/*.js   (ship with crashtest)
//   packs:     packs/{public,local}/<name>/ (file-bundles, manifest + entry)
//   plugins:   importable specifiers        (npm packages / local files)
//
// The zero-dependency rule (PRD principle 5) applies to what SHIPS here, not
// what plugins may bring; a plugin that imports `zod` makes its own deps its
// problem - `crashtest run` imports it with plain `import()` and reports the
// resolution failure loudly, exactly like a pack.json that doesn't parse.
//
// House rule 3: a listed plugin that doesn't exist, doesn't export a valid
// scenario module, or collides with another module's name FAILS THE RUN
// loudly - a broken plugin is a config error, never a silent gap.

import { join, dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateScenario } from '../scenarios/contract.js';

/**
 * Load every listed plugin, validating each against the scenario contract.
 *
 * @param {string[]} specifiers values of config `plugins` (string or array
 *   is rejected at the config level; see src/presets.js docs for shape)
 * @param {string} fromDir directory relative specifiers resolve against
 *   (the config file's directory - plugin paths are config-relative, the
 *   same way `scenarioDirs` are repo-root-relative rather than guessy)
 * @param {Map<string,string>} [seen] shared name-registry across surfaces
 *   (library/packs/plugins) so a name collision is caught at THIS surface
 *   with the origin of the earlier claim
 * @returns {Promise<Array<{ specifier: string, origin: string, module: object }>>}
 */
export async function loadPlugins(specifiers, fromDir, seen = new Map()) {
  if (typeof specifiers === 'string') specifiers = [specifiers];
  if (!Array.isArray(specifiers)) {
    throw new TypeError('config `plugins` must be an array of ESM specifiers (npm package names or paths)');
  }
  const out = [];
  for (const spec of specifiers) {
    if (typeof spec !== 'string' || !spec.trim()) {
      throw new TypeError(`config \`plugins\`: entries must be non-empty strings (got ${JSON.stringify(spec)})`);
    }
    const ipc = toImportable(spec, fromDir);
    let mod;
    try {
      mod = await import(importableHref(ipc));
    } catch (e) {
      // A missing npm package, a TS plugin (crashtest imports ESM JS only),
      // a syntax error inside the module - all config-time failures.
      throw new Error(
        `plugin "${spec}" failed to load from config: ${e.message} ` +
        `(plugins must be importable ESM - plain import(), no TS, no build step)`,
      );
    }
    const module = validateScenario(mod.default, `plugin:${spec}`);
    if (seen.has(module.name)) {
      throw new Error(
        `plugin name collision: "${spec}" exports scenario name "${module.name}" ` +
        `which is already loaded from ${seen.get(module.name)} - rename one of them`,
      );
    }
    seen.set(module.name, `plugin:${spec}`);
    out.push({ specifier: spec, origin: `plugin:${spec}`, module });
  }
  return out;
}

/**
 * One importable specifier, resolved the way the config file's location
 * implies:
 *   - npm package name (bare specifier)     -> import as-is (node resolves)
 *   - './file.js' or '../x/y.js' (relative) -> resolved against `fromDir`
 *   - absolute path                          -> imported by path
 * Anything NOT ending in an extension that a Node ESM import can honor
 * (".js", ".mjs") fails loudly here rather than at import time - "preset" and
 * "fail at cause" both mean naming the actual missing thing, not a resolver
 * error after the fact.
 */
function toImportable(spec, fromDir) {
  if (spec.startsWith('file://')) return spec;
  if (isAbsolute(spec)) return spec;
  // Bare specifier = npm package (or a Node builtin) - the runtime resolves
  // it and import() gives the honest error if it doesn't exist.
  if (!spec.startsWith('.')) return spec;
  return resolve(fromDir, spec);
}

function importableHref(absOrFile) {
  if (absOrFile.startsWith('file://')) return absOrFile;
  if (/^[a-z]+:/.test(absOrFile)) return absOrFile; // bare specifier / URL - pass through
  return pathToFileURL(absOrFile).href;
}

/** Directory a config file's own relative plugin specifiers resolve from. */
export function configDir(configPath) { return dirname(configPath); }

export default { loadPlugins, configDir };
