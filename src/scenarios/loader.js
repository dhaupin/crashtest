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

async function loadFromDir(dir, seen = new Map()) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return []; // optional dir
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
    ...(await Promise.all((userDirs ?? []).map(d => loadFromDir(d, seen)))).flat(),
  ];
  out.sort((a, b) => a.module.name.localeCompare(b.module.name));
  return out;
}

export { attackIds };
