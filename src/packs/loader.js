// src/packs/loader.js - the extension surface (packs).
//
// A pack is a bundle of crashtest artifacts a user (or the project itself)
// authors ONCE and reuses across run roots: scenario modules, recipes, and
// eventually their own targets. Private packs stay private by directory -
// packs/local/ is gitignored-by-default, public packs are tracked. There is
// no "models/" wording here on purpose: packs are crashtest's own vocabulary.
//
// Layout (created by `crashtest init`, discovered by `crashtest run/packs`):
//
//   packs/public/<name>/pack.json + files   -> shipped / shared, tracked
//   packs/local/<name>/pack.json + files    -> machine-private, gitignored
//
// Every pack.json (schemaVersion 1):
//   {
//     "schemaVersion": 1,
//     "name": "my-pack",              // kebab-case, unique
//     "description": "one line",
//     "entry": "index.js",            // optional; ESM file(s) under this pack,
//                                     // validated with the scenario contract
//     "plugins": ["npm-pkg"|"./rel.js"], // optional; import specifiers the pack
//                                     // BUNDLES - resolved like config
//                                     // `plugins`, relative to the pack dir
//     "env": {                        // optional; BINDING CLAIMS (see below)
//       "d1": { "DB": { "tables": ["charges"] } },
//       "kv": { "UPLOADS": {} },
//       "routes": ["charge", "profile"],
//       "seed": {
//         "kv":  { "UPLOADS": { "canary": "..." } },
//         "d1":  { "DB": { "charges": { "rows": [...], "uniques": {...} } } }
//       }
//     }
//   }
//
// env claims (additive, same schemaVersion - a pack states what it needs of
// the run root instead of every attack hand-probing):
//   - `d1`/`kv` name bindings the pack EXPECTS in the harness env; `d1` may
//     additionally name tables inside the binding. `routes` names routes the
//     pack expects the harness route table to have.
//   - With a check context given, loadPacks() computes each pack's
//     `prerequisites`: the UNMET claims only. The CLI/report render them;
//     the attack-level skip verdicts stay the ground truth - claims are
//     DISPLAY, and a missing binding never invents one.
//   - `env.seed` is a deterministic fixture passthrough: seed rows land ONLY
//     where the claimed binding already exists (kv keys absent-or-identical;
//     d1 seed tables must be new - the run root owns its own tables).
//     Identical values are a no-op; conflicts fail the run loudly.
//
// Rule 3 applies: a pack.json that exists but is unreadable/invalid FAILS
// THE RUN loudly - a broken pack is a config error, never a silent gap.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateScenario } from '../scenarios/contract.js';
import { FakeD1 } from '../harness/d1.js';
import { FakeKV } from '../harness/kv.js';

const REQUIRED_KEYS = ['schemaVersion', 'name', 'description'];
const ENTRY_DEFAULT = 'index.js';
const ENV_KINDS = ['d1', 'kv', 'routes', 'seed'];
const BINDING_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate one pack manifest - throws (loudly) on anything wrong. */
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
  // registry LOOKUP stays in npm's own tools - the CLI never dials out).
  if (manifest.package !== undefined && typeof manifest.package !== 'string') {
    throw new Error(`pack manifest at ${origin}: "package" must be a string (npm package name)`);
  }
  // Optional bundled-plugin imports (PRD v0.3 unified-surfaces): the pack
  // BUNDLES scenario modules by import specifier - npm packages or ESM files
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
  const env = validateEnvClaims(manifest.env, origin);
  return { ...manifest, entry: manifest.entry ?? ENTRY_DEFAULT, env: manifest.env === undefined ? undefined : env };
}

/**
 * Validate the optional `env` claims block (issue #12). Additive and
 * strictly typed when present: every wrong shape is a loud manifest error,
 * never a silent pretending-the-claim-was-there. Returns a normalized
 * { d1, kv, routes, seed } copy (insertion-ordered, plain JSON only).
 */
export function validateEnvClaims(env, origin) {
  if (env === undefined) return undefined;
  const fail = (why) => { throw new Error(`pack manifest at ${origin}: "env" ${why}`); };
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    fail(`claims must be an object (got ${Array.isArray(env) ? 'array' : typeof env})`);
  }
  for (const key of Object.keys(env)) {
    if (!ENV_KINDS.includes(key)) {
      fail(`unrecognized claim "${key}" - claim kinds are: ${ENV_KINDS.join(', ')}`);
    }
  }
  const out = { d1: {}, kv: {}, routes: [], seed: {} };
  for (const kind of ['d1', 'kv']) {
    if (env[kind] === undefined) continue;
    const claims = env[kind];
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      fail(`"${kind}" must be an object of binding claims`);
    }
    for (const [binding, def] of Object.entries(claims)) {
      if (!BINDING_RE.test(binding)) {
        fail(`"${kind}[${binding}]" - binding names must match [A-Za-z_][A-Za-z0-9_]*`);
      }
      if (!def || typeof def !== 'object' || Array.isArray(def)) {
        fail(`"${kind}[${binding}]" must be an object`);
      }
      if (kind === 'kv') {
        if (Object.keys(def).length) {
          fail(`"${kind}[${binding}]" takes an empty object for now (per-binding kv props are future schema)`);
        }
        out.kv[binding] = {};
        continue;
      }
      const extras = Object.keys(def).filter((k) => k !== 'tables');
      if (extras.length) {
        fail(`"${kind}[${binding}]" accepts only "tables" - unrecognized prop(s): ${extras.join(', ')}`);
      }
      if (def.tables === undefined) {
        out.d1[binding] = {};
        continue;
      }
      if (!Array.isArray(def.tables) || def.tables.some((t) => typeof t !== 'string' || !t.trim())) {
        fail(`"${kind}[${binding}].tables" must be an array of table names`);
      }
      out.d1[binding] = { tables: [...def.tables] };
    }
  }
  if (env.routes !== undefined) {
    if (!Array.isArray(env.routes) || env.routes.some((r) => typeof r !== 'string' || !r.trim())) {
      fail('"routes" must be an array of route names');
    }
    out.routes = [...env.routes];
  }
  if (env.seed !== undefined) {
    const seed = env.seed;
    if (!seed || typeof seed !== 'object' || Array.isArray(seed)) fail('"seed" must be an object');
    for (const key of Object.keys(seed)) {
      if (key !== 'kv' && key !== 'd1') fail(`"seed.${key}" is not a seed kind (have: kv, d1)`);
    }
    for (const kind of ['kv', 'd1']) {
      if (seed[kind] === undefined) continue;
      const byBinding = seed[kind];
      if (!byBinding || typeof byBinding !== 'object' || Array.isArray(byBinding)) {
        fail(`"seed.${kind}" must be an object keyed by binding`);
      }
      out.seed[kind] = out.seed[kind] ?? {};
      for (const [binding, payload] of Object.entries(byBinding)) {
        if (!BINDING_RE.test(binding)) fail(`"seed.${kind}[${binding}]" - binding names must match [A-Za-z_][A-Za-z0-9_]*`);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          fail(`"seed.${kind}[${binding}]" must be an object`);
        }
        if (kind === 'kv') {
          out.seed.kv[binding] = { ...payload };
          continue;
        }
        // d1 seed: binding -> table -> { rows, uniques } (FakeD1's own table shape)
        const tables = {};
        for (const [tname, def] of Object.entries(payload)) {
          if (!tname.trim()) fail(`"seed.d1[${binding}]" - table names must be non-empty`);
          if (!def || typeof def !== 'object' || Array.isArray(def)) {
            fail(`"seed.d1[${binding}][${tname}]" must be an object ({ rows, uniques? })`);
          }
          if (!Array.isArray(def.rows) || def.rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
            fail(`"seed.d1[${binding}][${tname}].rows" must be an array of row objects`);
          }
          if (def.uniques !== undefined) {
            const u = def.uniques;
            if (!u || typeof u !== 'object' || Array.isArray(u)
              || Object.values(u).some((cols) => !Array.isArray(cols) || cols.some((c) => typeof c !== 'string'))) {
              fail(`"seed.d1[${binding}][${tname}].uniques" must be an object of name -> column list`);
            }
          }
          tables[tname] = { rows: def.rows.map((r) => ({ ...r })), ...(def.uniques !== undefined ? { uniques: { ...def.uniques } } : {}) };
        }
        out.seed.d1[binding] = tables;
      }
    }
  }
  return out;
}

/**
 * evaluatePackEnv(manifest, check) - the claim checker. `check` is the flat
 * harness surface: { env: <harness.env or config env object>, routeNames: [] }.
 * Returns ONLY the unmet claims, as structured rows the CLI/report render.
 * The attack-level skip verdicts stay the ground truth - this is DISPLAY.
 *
 * @param {{ env?: object }} manifest
 * @param {{ env?: object, routeNames?: string[] } | null} check null = unchecked
 */
export function evaluatePackEnv(manifest, check) {
  const claims = manifest.env;
  if (!claims) return [];
  const out = [];
  for (const [binding, def] of Object.entries(claims.d1 ?? {})) {
    const bind = check && binding in (check.env ?? {}) ? check.env[binding] : undefined;
    if (!bind) {
      out.push({ kind: 'd1', name: binding, satisfied: false, checked: !!check, detail: `no d1 binding "${binding}" in the run root` });
      continue;
    }
    for (const t of def.tables ?? []) {
      const have = bind instanceof FakeD1 ? bind._t.has(t) : true; // non-FakeD1 bindings are out of introspection's write
      if (!have) out.push({ kind: 'd1-table', binding, name: t, satisfied: false, checked: !!check, detail: `d1 "${binding}" is missing table "${t}"` });
    }
  }
  for (const binding of Object.keys(claims.kv ?? {})) {
    const bind = check && binding in (check.env ?? {}) ? check.env[binding] : undefined;
    if (!bind) out.push({ kind: 'kv', name: binding, satisfied: false, checked: !!check, detail: `no kv binding "${binding}" in the run root` });
  }
  for (const route of claims.routes ?? []) {
    const names = check ? (check.routeNames ?? []) : [];
    if (!names.includes(route)) out.push({ kind: 'route', name: route, satisfied: false, checked: !!check, detail: `no route "${route}" registered in the harness` });
  }
  return out;
}

/** "d1[DB]" / "d1[DB:charges]" / "kv[UPLOADS]" / "route[charge]" - the unmet row. */
export function renderPrerequisite(row) {
  if (row.kind === 'd1-table') return `d1[${row.binding}:${row.name}]`;
  if (row.kind === 'route') return `route[${row.name}]`;
  return `${row.kind}[${row.name}]`;
}

/** The claims line ("needs: ...") for a manifest - display without a harness. */
export function renderEnvClaims(claims) {
  if (!claims) return '';
  const parts = [];
  for (const [binding, def] of Object.entries(claims.d1 ?? {})) {
    parts.push(`d1[${binding}${(def.tables ?? []).length ? `: ${(def.tables ?? []).join(', ')}` : ''}]`);
  }
  for (const binding of Object.keys(claims.kv ?? {})) parts.push(`kv[${binding}]`);
  if ((claims.routes ?? []).length) parts.push(`routes[${claims.routes.join(', ')}]`);
  return parts.join(', ');
}

/**
 * applyPackSeed(packs, env) - the env.seed passthrough. Deterministic fixture
 * rows land ONLY where the claimed binding already exists in the harness env
 * (a missing binding is an unmet prerequisite - seeds never invent bindings).
 *   kv: absent keys are set (buildEnv stringifies non-strings), keys present
 *       with the identical value are a no-op, differing values FAIL LOUDLY.
 *   d1: seed tables must be NEW tables (the run root owns its own); conflicts
 *       fail loudly. Rows carry FakeD1's own shape ({ rows, uniques }),
 *       autoincrement derived exactly like the FakeD1 constructor does.
 * Seeds tick NO counters - they are fixture state, not campaign requests.
 */
export function applyPackSeed(packs, env) {
  for (const p of packs) {
    const seed = p.manifest?.env?.seed;
    if (!seed) continue;
    const pack = p.manifest.name;
    for (const [binding, entries] of Object.entries(seed.kv ?? {})) {
      const bind = env[binding];
      if (!(bind instanceof FakeKV)) continue;
      for (const [key, value] of Object.entries(entries)) {
        const stored = typeof value === 'string' ? value : JSON.stringify(value);
        if (bind._store.has(key)) {
          if (bind._store.get(key)?.value !== stored) {
            throw new Error(`pack "${pack}" env.seed: kv[${binding}].${key} is already set by the run root with different content - env.seed may not overwrite run-root state`);
          }
          continue;
        }
        bind._store.set(key, { value: stored, metadata: null, expiresAt: null });
      }
    }
    for (const [binding, tables] of Object.entries(seed.d1 ?? {})) {
      const bind = env[binding];
      if (!(bind instanceof FakeD1)) continue;
      for (const [tname, def] of Object.entries(tables)) {
        if (bind._t.has(tname)) {
          throw new Error(`pack "${pack}" env.seed: d1[${binding}][${tname}] is already declared by the run root - env.seed may not extend run-root tables`);
        }
        const rows = def.rows.map((r) => ({ ...r }));
        const nextId = rows.reduce((max, r) => Math.max(max, typeof r.id === 'number' ? r.id : 0), 0) + 1;
        bind._t.set(tname, {
          name: tname,
          rows,
          nextId,
          uniques: new Map(Object.entries(def.uniques ?? {}).map(([k, cols]) => [k, cols])),
        });
      }
    }
  }
}

/**
 * Discover and load packs from visibility dirs under the given roots.
 * Each root carries `public/` and `local/` - two roots may share a name
 * ONLY if they are the same pack triple-checked by origin (see below);
 * a real name collision throws.
 *
 * @param {string|string[]} packsRoots roots carrying public/ + local/ visibility dirs
 * @param {Map} [seen] shared with the scenario loader for cross-surface guards
 * @param {{ env?: object, routeNames?: string[] } | null} [check] when given
 *   (the built harness surface), every pack gains a `prerequisites` array
 *   of its unmet env claims; omitted = claims stay load-only (unchecked).
 * @returns {Array<{ origin: string, module: object, visibility: string, manifest: object, prerequisites?: any[] }>}
 */
export async function loadPacks(packsRoots = [], seen = new Map(), check = null, opts = {}) {
  // Profile enforcement (issue #33, packstruct SPEC section 7): the ENTRY
  // SHAPE is host-owned per profile - a manifest-conformant, entry-importable
  // minimal pack of ANY profile must be loadable. The scenario contract
  // ({ name, description, attacks }) is crashtest's profile and stays the
  // STRICT default (validateProfile: true), so `crashtest run` / `crashtest
  // packs` keep byte-identical behavior and every existing pin holds. Host
  // faces that carry other profiles (packstruct audit-conformance, check-
  // profile packs) pass { validateProfile: false }: the manifest contract
  // (schemaVersion/name/entry) stays fully enforced - only the scenario-
  // shape check is deferred to the host's own run-time validation.
  const validateProfile = opts.validateProfile !== false;
  if (typeof packsRoots === 'string') packsRoots = [packsRoots];
  const out = [];
  for (const root of packsRoots) {
    // Pointing at ONE pack dir (its pack.json directly inside) loads exactly
    // that pack - the documented "one pack dir only" shape. Visibility is
    // inherited from the path when it came from a visibility dir, else "inline".
    let selfManifest;
    try {
      selfManifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw new Error(`pack manifest at ${root} is unreadable JSON: ${err.message}`);
      }
    }
    if (selfManifest) {
      const inPublic = root.includes('/public/');
      const inLocal = root.includes('/local/');
      const visibility = inPublic ? 'public' : inLocal ? 'local' : 'inline';
      await loadPackDir(root, basename(root), visibility, seen, out, check, validateProfile);
      continue;
    }
    // Otherwise: a packs ROOT - scan its public/ + local/ visibility dirs.
    for (const dir of [join(root, 'public'), join(root, 'local')]) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue; // optional visibility dir
      }
      const visibility = basename(dir);
      for (const ent of entries.filter((e) => e.isDirectory())) {
        await loadPackDir(join(dir, ent.name), ent.name, visibility, seen, out, check);
      }
    }
  }
  out.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return out;
}

/**
 * Load ONE pack dir (manifest must exist inside; a loose WIP dir without
 * pack.json skips quietly - that is the local/ contract). Shared `seen`
 * keeps one name one origin across every load shape.
 */
async function loadPackDir(packDir, name, visibility, seen, out, check, validateProfile = true) {
  const origin = `${visibility}/${name}`;
  // dir without pack.json = not a pack (local dirs may carry loose WIP) - skip quietly
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(packDir, 'pack.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return;
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
    ...(check ? { prerequisites: evaluatePackEnv(spec, check) } : {}),
    module: validateProfile ? validateScenario(mod.default, `${origin}/${spec.entry}`) : mod.default,
  });
}
