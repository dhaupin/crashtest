// S1.2 - scenario loader. Discovers scenario modules from
//   1. built-ins: src/scenarios/library (ships with crashtest)
//   2. user dirs: any directory passed in (a "module" is just a dir of ESM files)
// Each "*.js" default-export is validated via the contract - a broken module
// blocks the whole run loudly (PRD principle 4: FAILING LOUD beats silent gaps).

import { readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateScenario, attackIds } from './contract.js';

const LIBRARY_DIR = join(dirname(fileURLToPath(import.meta.url)), 'library');

async function loadFromDir(dir, seen = new Map(), { optional = true } = {}) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    // optional dir (default): the labs/scenarios auto-scan may simply not
    // exist yet. Declared dirs (config scenarioDirs marked optional: false)
    // are config, not guesswork - a missing one is a config error, never a
    // quiet no-op (rule 3: the module shelf you pointed at is gone).
    if (!optional) {
      throw new Error(`scenario dir "${dir}" does not exist - a declared dir is config, not optional; fix the path (the labs/scenarios auto-scan stays optional)`);
    }
    return [];
  }
  const loaded = [];
  for (const entry of entries.filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))) {
    const modPath = join(dir, entry);
    const mod = await import(pathToFileURL(modPath).href);
    const origin = `${basename(dir)}/${entry}`;
    if (seen.has(mod.name ?? entry)) {
      throw new Error(`scenario name collision: "${mod.name ?? entry}" at ${origin} (also loaded from ${seen.get(mod.name ?? entry)})`);
    }
    seen.set(mod.name ?? entry, origin);
    loaded.push({ origin, module: validateScenario(mod.default, origin) });
  }
  return loaded;
}

/**
 * @param {string|string[]} [userDirs] additional directories to scan
 * @returns {Promise<Array<{origin, module}>>} sorted by module name (deterministic)
 */
export async function loadScenarios(userDirs = []) {
  if (typeof userDirs === 'string') userDirs = [userDirs];
  const seen = new Map();
  const out = [
    ...(await loadFromDir(LIBRARY_DIR, seen)),
    ...(await Promise.all((userDirs ?? []).map((d) => {
      const spec = (d !== null && typeof d === 'object') ? d : { dir: d };
      return loadFromDir(spec.dir, seen, { optional: spec.optional !== false });
    }))).flat(),
  ];
  out.sort((a, b) => a.module.name.localeCompare(b.module.name));
  return out;
}

export { attackIds };
