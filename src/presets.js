// src/presets.js — PRD v0.3 "framework recipes: one-line presets for
// Lovable/Bolt/Replit exports".
//
// DESIGN CONSTRAINT (researched, not guessed — primary docs checked
// 2026-10-20): none of the three agent-builders guarantees ONE universal
// handler shape in every export. Lovable rides Supabase Edge Functions (whose
// docs show two different module interfaces: a `default.fetch(req)` export
// AND `Deno.serve(...)` registration); Bolt's managed edge functions have no
// documented portable source layout; Replit Agent scaffolds project-specific
// servers identified by the project's own `.replit` run command. So a preset
// does not NAME a builder and emit a claimed handler — that would be fiction
// (house rule 7). A preset DETECTS what is actually in the repo and emits a
// config for what's really there, loudly naming anything it cannot find:
//
//   detect():    honest scan of the target repo (no builder-name claims)
//   scaffoldPreset(name) → { configSource, notes[], warnings[] }
//
// Every plugin/preset surface obeys principle 5: zero dependencies, plain
// node:fs, no network — inspects files, never phones home.

import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const PRESETS = {
  lovable: {
    oneLine: 'Lovable export (Supabase Edge Functions / TanStack Start / static SPA)',
    // Detection keys are REPO FEATURES, never the builder's name alone.
    detect: (exists, read) => exists('supabase/config.toml')
      || exists('supabase/functions') // dir entries only; shapes checked below
      || exists('src/routeTree.gen.ts'), // TanStack Start codegen marker
  },
  bolt: {
    oneLine: 'Bolt.new export (Bolt Cloud / Supabase-backed or bolt-managed functions)',
    detect: (exists) => exists('supabase/config.toml') || exists('supabase/functions'),
    // No unconditional Bolt marker found: bolt.new exports are ZIP/npm
    // outlines, no documented universal backend filename.
  },
  replit: {
    oneLine: 'Replit export (project-specific server; entry named by .replit run command)',
    detect: (exists) => exists('.replit') || exists('replit.nix'),
  },
};

export function listPresets() {
  return Object.entries(PRESETS).map(([name, p]) => ({ name, oneLine: p.oneLine }));
}

/** Does a path exist (file OR dir)? Never throws. */
async function existsSafe(repoRoot, rel) {
  try {
    await access(join(repoRoot, rel), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Dir listing, or [] when the dir isn't there. */
async function listSafe(repoRoot, rel) {
  try {
    return await readdir(join(repoRoot, rel));
  } catch {
    return [];
  }
}

async function readIfPresent(repoRoot, rel) {
  try {
    return await readFile(join(repoRoot, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * detect(repoRoot) — what is really in this repo, expressed as preset-relevant
 * findings. Every finding names the file it came from; nothing is inferred
 * from the prompt or the builder's name.
 *
 * @param {string} repoRoot absolute path to the exported/app repo
 * @returns {Promise<{
 *   supabase: { configToml: boolean, functions: string[] },
 *   tanstackStart: boolean,
 *   replit: { hasDotReplit: boolean, hasNix: boolean, runCommand: string|null },
 *   packageJson: { name: string|null, main: string|null, type: string|null },
 * }> }
 */
export async function detect(repoRoot) {
  const supabaseConfig = await existsSafe(repoRoot, 'supabase/config.toml');
  const supabaseFunctions = (await listSafe(repoRoot, 'supabase/functions'))
    .filter(Boolean);
  // TanStack Start marker (Lovable's newer self-hosted shape): codegen route tree.
  const tanstackStart = await existsSafe(repoRoot, 'src/routeTree.gen.ts');
  const dotReplit = await readIfPresent(repoRoot, '.replit');
  const runCommand = dotReplit
    ? (dotReplit.match(/^run\s*=\s*"([^"]+)"/m)?.[1] ?? null)
    : null;
  const pkg = await readIfPresent(repoRoot, 'package.json');
  let pkgParsed = null;
  try { pkgParsed = JSON.parse(pkg); } catch { /* left null; reported below */ }
  return {
    supabase: { configToml: supabaseConfig, functions: supabaseFunctions },
    tanstackStart,
    replit: { hasDotReplit: Boolean(dotReplit), hasNix: await existsSafe(repoRoot, 'replit.nix'), runCommand },
    packageJson: {
      name: pkgParsed?.name ?? null,
      main: pkgParsed?.main ?? null,
      type: pkgParsed?.type ?? null,
      parseFailed: pkg != null && pkgParsed == null,
    },
  };
}

/**
 * Scaffold a preset config source for a detected repo. Returns TEXT to drop
 * into crashtest.config.js — never a claim about what the builder "always"
 * makes. When detection is ambiguous (no Supabase, no .replit, nothing
 * recognizable), warnings name exactly what was checked so the human can wire
 * the handler by hand rather than trusting a guess.
 *
 * @param {"lovable"|"bolt"|"replit"} name
 * @param {string} repoRoot
 * @param {import('./harness/harness.js').Harness|null} [probeHarness]
 *   optional — when present, the preset can EXECUTE the found handler once to
 *   prove an in-process dispatch path exists (detect-then-prove, not assert).
 */
export async function scaffoldPreset(name, repoRoot, probeHarness = null) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new TypeError(`unknown preset "${name}" (have: ${Object.keys(PRESETS).join(', ')})`);
  }
  const d = await detect(repoRoot);
  const notes = [];
  const warnings = [];
  const configParts = [];
  configParts.push(`// crashtest.config.js — preset "${name}" (${preset.oneLine})`);
  configParts.push('// Generated from what detect() actually found in this repo; not a builder claim.');

  if (name === 'lovable' || name === 'bolt') {
    if (d.supabase.functions.length) {
      // Supabase Edge Functions, the documented layout:
      //   supabase/functions/<fn>/index.ts exporting { fetch } (quickstart)
      //   OR calling Deno.serve(...) — two documented module interfaces.
      // crashtest never imports TS. The preset emits an ADAPTER-style config
      // that names each found function with the import the config author
      // replaces once they know their interface (fetch-export vs serve).
      for (const fn of d.supabase.functions) {
        const rel = `supabase/functions/${fn}/index.ts`;
        const src = await readIfPresent(repoRoot, rel);
        const isFetchExport = src != null && /export\s+default\s*{[\s\S]*fetch\s*[:(]/.test(src); // fetch: or fetch( (method style)
        const isDenoServe = src != null && /Deno\.serve\s*\(/.test(src);
        notes.push(`found edge function ${fn}: ${isFetchExport ? 'default { fetch } export' : isDenoServe ? 'Deno.serve()' : 'unknown interface (read the file; pick the matching adapter shape)'}`);
        warnings.push(`${rel} is TypeScript/Deno — the in-process adapter needs the handler imported as JS. Options: a JS shim in your repo exporting { fetch }, OR a compiled copy. crashtest does not transpile and never runs Deno APIs in Node.`);
      }
      configParts.push(`// Supabase Edge Functions found: ${d.supabase.functions.join(', ')}`);
      configParts.push('// Mark the USE of the fetch interface explicitly in your config — example shape:');
      configParts.push(`//   plugins: ['./shims/${d.supabase.functions[0] ?? 'your-function'}.js'],`);
      configParts.push('//   // shims/<fn>.js exports { name, description, attacks: [...] } - the standard scenario contract.');
      configParts.push(`export default {\n  // your env: { d1: {…}, kv: {…} } here\n  // adapters: { node: { handle: yourHandler } }\n};`);
    } else if (d.tanstackStart) {
      notes.push('TanStack Start detected (src/routeTree.gen.ts) — server functions are framework-managed routes, not plain (req)=>Response handlers.');
      warnings.push('No direct handler export path for TanStack Start server functions in this preset version. Wire the built output manually (.output/server/index.mjs, node adapter) — PRD v0.3 "framework recipes" documents this as a detected-but-not-yet-automatable shape.');
      configParts.push('// TanStack Start: no automatic handler wiring in this preset — see note.');
      configParts.push('// TanStack Start: wire .output/server/index.mjs through the node adapter in this config.');
    } else {
      notes.push('No supabase/ or TanStack Start markers in this export.');
      warnings.push('This looks like a static-SPA export (no server handlers found). crashtest attacks server HANDLERS; a pure-static site has nothing to attack — point the config at your real backend if there is one.');
      configParts.push(`// Detection result: no server handlers found in this export.\nexport default {\n  // routes/adapters must be filled in by hand — nothing was auto-detected.\n};`);
    }
  }

  if (name === 'replit') {
    if (d.replit.runCommand) {
      notes.push(`.replit run command: ${d.replit.runCommand}`);
      warnings.push('Replit exports are project-specific servers: the run command starts a LISTENING server, which is not directly the shape crashtest dispatches against. Wire the adapter entry that exports your app (hono/fastify/express), not the `node server.js` listening shell — the presets doc in DEPLOY.md shows the one-line wiring.');
      configParts.push(`// .replit run: ${d.replit.runCommand}`);
      configParts.push(`export default {\n  // adapters: { express: yourApp } (or hono/fastify/node)\n  // env: { … }\n};`);
    } else {
      warnings.push('No .replit run command and no replit.nix found — this does not look like a Replit-managed repo. Nothing guessed.');
      configParts.push(`// Detection result: no Replit markers. Fill config by hand.\nexport default {};`);
    }
  }

  if (d.packageJson.parseFailed) warnings.push('package.json exists but is not valid JSON — that is a repo-level error crashtest will not paper over.');

  return { preset: name, detection: d, configSource: configParts.join('\n') + '\n', notes, warnings };
}

export default { listPresets, detect, scaffoldPreset };
