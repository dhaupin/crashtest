// src/packs/loader.js — the extension surface (packs).
//
// A pack is a bundle of crashtest artifacts a user (or the project itself)
// authors ONCE and reuses across run roots: scenario modules, recipes, and
// eventually their own targets. Private packs stay private by directory —
// packs/local/ is gitignored-by-default, public packs are tracked. There is
// no "models/" wording here on purpose: packs are crashtest's own vocabulary.
//
// Layout (created by `crashtest init`, discovered by `crashtest run/packs`):
//
//   packs/public/<name>/pack.json + files   → shipped / shared, tracked
//   packs/local/<name>/pack.json + files    → machine-private, gitignored
//
// Every pack.json (schemaVersion 1):
//   {
//     "schemaVersion": 1,
//     "name": "my-pack",              // kebab-case, unique
//     "description": "one line",
//     "entry": "index.js",            // optional; ESM file(s) under this pack,
//                                     // validated with the scenario contract
//     "plugins": ["npm-pkg"|"./rel.js"] // optional; import specifiers the pack
//                                     // BUNDLES — resolved like config
//                                     // `plugins`, relative to the pack dir
//   }
//
// Rule 3 applies: a pack.json that exists but is unreadable/invalid FAILS
// THE RUN loudly — a broken pack is a config error, never a silent gap.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateScenario } from '../scenarios/contract.js';

const REQUIRED_KEYS = ['schemaVersion', 'name', 'description'];
const ENTRY_DEFAULT = 'index.js';

/** Validate one pack manifest — throws (loudly) on anything wrong. */
export function validatePackManifest(manifest, origin) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`pack manifest at ${origin} is not a JSON object`);
  }
  for (const key of REQUIRED_KEYS) {
    if (manifest[key] === undefined) {
      throw new Error(`pack manifest at ${origin} is missing "${key}" (pack.json schemaVersion 1)`);
    }
    if (key !== 'schemaVersion' && typeof manifest[key] !== 'string') {
      throw new Error(`pack manifest at ${origin}: "${key}" must be a string`);
    }
  }
  if (manifest.schemaVersion !== 1) {
    throw new Error(`pack manifest at ${origin}: unsupported schemaVersion ${manifest.schemaVersion} (have: 1)`);
  }
  // Optional npm metadata: the package name this pack ships as, for registry
  // version joins (`crashtest packs --json` inventories it; the actual
  // registry LOOKUP stays in npm's own tools — the CLI never dials out).
  if (manifest.package !== undefined && typeof manifest.package !== 'string') {
    throw new Error(`pack manifest at ${origin}: "package" must be a string (npm package name)`);
  }
  // Optional bundled-plugin imports (PRD v0.3 unified-surfaces): the pack
  // BUNDLES scenario modules by import specifier — npm packages or ESM files
  // inside the pack. They load through the same plugin validator, resolved
  // relative to the PACK dir, and join the same campaign with honest
  // `pack:<origin>` plan labels. A broken listing fails the run loudly, the
  // same rule as every other surface.
  if (manifest.plugins !== undefined) {
    if (!Array.isArray(manifest.plugins) || manifest.plugins.some((s) => typeof s !== 'string' || !s.trim())) {
      throw new Error(`pack manifest at ${origin}: "plugins" must be an array of non-empty ESM specifiers (npm names or .js/.mjs paths)`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)) {
    throw new Error(`pack manifest at ${origin}: name "${manifest.name}" is not kebab-case`);
  }
  return { ...manifest, entry: manifest.entry ?? ENTRY_DEFAULT };
}

/**
 * Discover and load packs from visibility dirs under the given roots.
 * Each root carries `public/` and `local/` — two roots may share a name
 * ONLY if they are the same pack triple-checked by origin (see below);
 * a real name collision throws.
 *
 * @param {string[]} packsRoots roots carrying public/ + local/ visibility dirs
 * @param {Map} [seen] shared with the scenario loader for cross-surface guards
 * @returns {Array<{ origin: string, module: object, visibility: string, manifest: object }>}
 */
export async function loadPacks(packsRoots = [], seen = new Map()) {
  if (typeof packsRoots === 'string') packsRoots = [packsRoots];
  const dirs = packsRoots.flatMap((root) =>
    // Two roots passing BOTH their visibility dirs keeps one call signature.
    [join(root, 'public'), join(root, 'local')]);
  const out = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // optional visibility dir
    }
    const visibility = basename(dir);
    for (const ent of entries.filter((e) => e.isDirectory())) {
      const packDir = join(dir, ent.name);
      const origin = `${visibility}/${ent.name}`;
      // dir without pack.json = not a pack (local dirs may carry loose WIP) — skip quietly
      let manifest;
      try {
        manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw new Error(`pack manifest at ${origin} is unreadable JSON: ${err.message}`);
      }
      const spec = validatePackManifest(manifest, origin);
      const seenOrigin = seen.get(spec.name);
      if (seenOrigin && seenOrigin !== origin) {
        throw new Error(`pack name collision: "${spec.name}" loaded from both ${seenOrigin} and ${origin}`);
      }
      seen.set(spec.name, origin);
      const modPath = join(packDir, spec.entry);
      let mod;
      try {
        mod = await import(pathToFileURL(modPath).href);
      } catch (err) {
        throw new Error(`pack "${spec.name}" (${origin}): entry "${spec.entry}" failed to import: ${err.message}`);
      }
      // Bundled plugin imports: resolved against the PACK dir (the manifest
      // lifelines its own imports), shared `seen` keeps cross-surface name
      // collisions one loud error with the earlier origin.
      let bundled = [];
      if (Array.isArray(spec.plugins) && spec.plugins.length) {
        const { loadPlugins } = await import('../plugins/loader.js');
        bundled = await loadPlugins(spec.plugins, packDir, seen);
      }
      out.push({
        origin,
        manifest: spec,
        bundled,
        visibility,
        module: validateScenario(mod.default, `${origin}/${spec.entry}`),
      });
    }
  }
  out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return out;
}

/** Human-facing inventory for the `crashtest packs` verb. */
export function describePacks(packs, extras = { library: 0, scenarioDirs: 0 }) {
  return packs.map((p) => ({
    name: p.manifest.name,
    visibility: p.visibility,
    version: p.manifest.version ?? null,
    attacks: p.module?.attacks?.length ?? 0,
    origin: p.origin,
    description: p.manifest.description,
  }));
}
