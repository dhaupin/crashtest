// src/presets.js - PRD v0.3 "framework recipes: one-line presets for
// Lovable/Bolt/Replit exports".
//
// DESIGN CONSTRAINT (researched, not guessed - primary docs checked
// 2026-10-20): none of the three agent-builders guarantees ONE universal
// handler shape in every export. Lovable rides Supabase Edge Functions (whose
// docs show two different module interfaces: a `default.fetch(req)` export
// AND `Deno.serve(...)` registration); Bolt's managed edge functions have no
// documented portable source layout; Replit Agent scaffolds project-specific
// servers identified by the project's own `.replit` run command. So a preset
// does not NAME a builder and emit a claimed handler - that would be fiction
// (house rule 7). A preset DETECTS what is actually in the repo and emits a
// config for what's really there, loudly naming anything it cannot find:
//
//   detect():    honest scan of the target repo (no builder-name claims)
//   scaffoldPreset(name) -> { configSource, notes[], warnings[] }
//
// Every plugin/preset surface obeys principle 5: zero dependencies, plain
// node:fs, no network - inspects files, never phones home.

import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRESETS = {
  lovable: {
    oneLine: 'Lovable export (Supabase Edge Functions / TanStack Start / static SPA)',
    // Detection is detect()'s job (repo features, never the builder's name
    // alone); nothing is claimed here that the CLI does not run.
  },
  bolt: {
    oneLine: 'Bolt.new export (Bolt Cloud / Supabase-backed or bolt-managed functions)',
    // No unconditional Bolt marker found: bolt.new exports are ZIP/npm
    // outlines, no documented universal backend filename.
  },
  replit: {
    oneLine: 'Replit export (project-specific server; entry named by .replit run command)',
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
 * detect(repoRoot) - what is really in this repo, expressed as preset-relevant
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
 * into crashtest.config.js - never a claim about what the builder "always"
 * makes. When detection is ambiguous (no Supabase, no .replit, nothing
 * recognizable), warnings name exactly what was checked so the human can wire
 * the handler by hand rather than trusting a guess.
 *
 * @param {"lovable"|"bolt"|"replit"} name
 * @param {string} repoRoot
 * @param {import('./harness/harness.js').Harness|null} [probeHarness]
 *   optional - when present, the preset can EXECUTE the found handler once to
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
  configParts.push(`// crashtest.config.js - preset "${name}" (${preset.oneLine})`);
  configParts.push('// Generated from what detect() actually found in this repo; not a builder claim.');

  if (name === 'lovable' || name === 'bolt') {
    if (d.supabase.functions.length) {
      // Supabase Edge Functions, the documented layout:
      //   supabase/functions/<fn>/index.ts exporting { fetch } (quickstart)
      //   OR calling Deno.serve(...) - two documented module interfaces.
      // crashtest never imports TS. The preset emits an ADAPTER-style config
      // that names each found function with the import the config author
      // replaces once they know their interface (fetch-export vs serve).
      for (const fn of d.supabase.functions) {
        const tsRel = `supabase/functions/${fn}/index.ts`;
        const src = await readIfPresent(repoRoot, tsRel);
        const isFetchExport = src != null && /export\s+default\s*{[\s\S]*fetch\s*[:(]/.test(src); // fetch: or fetch( (method style)
        const isDenoServe = src != null && /Deno\.serve\s*\(/.test(src);
        notes.push(`found edge function ${fn}: ${isFetchExport ? 'default { fetch } export' : isDenoServe ? 'Deno.serve()' : 'unknown interface (read the file; pick the matching adapter shape)'}`);
        // The probe: execute what was found ONCE (detect-then-prove). The
        // source of truth for the probe is a compilable JS entry - the .ts
        // source's own compiled neighbor (index.js) when the repo carries
        // one, else the probe reports the no-transpile reason, never a fake:
        const probe = await probeHandler(join(repoRoot, `supabase/functions/${fn}/index.js`));
        if (probe.probed) {
          notes.push(`probe ${fn}: GET /__ct-probe -> ${probe.status} ok=${probe.ok} ${probe.bodyBytes}B in ${probe.ms}ms - the dispatch path WORKS in-process`);
        } else if (probe.reason) {
          notes.push(`probe ${fn}: not executed - ${probe.reason}`);
        }
        // The TS/Deno warning is honest ONLY when there is no JS neighbor:
        // a compiled index.js that the probe just ran IS the JS entry this
        // warning would tell the user to create (fiction by omission).
        const hasJsNeighbor = await existsSafe(repoRoot, `supabase/functions/${fn}/index.js`);
        if (!hasJsNeighbor) {
          warnings.push(`${tsRel} is TypeScript/Deno - the in-process adapter needs the handler imported as JS. Options: a JS shim in your repo exporting { fetch }, OR a compiled copy. crashtest does not transpile and never runs Deno APIs in Node.`);
        }
      }
      configParts.push(`// Supabase Edge Functions found: ${d.supabase.functions.join(', ')}`);
      configParts.push('// Mark the USE of the fetch interface explicitly in your config - example shape:');
      configParts.push(`//   plugins: ['./shims/${d.supabase.functions[0] ?? 'your-function'}.js'],`);
      configParts.push('//   // shims/<fn>.js exports { name, description, attacks: [...] } - the standard scenario contract.');
      configParts.push(`export default {\n  // your env: { d1: {...}, kv: {...} } here\n  // adapters: { node: { handle: yourHandler } }\n};`);
    } else if (d.tanstackStart) {
      notes.push('TanStack Start detected (src/routeTree.gen.ts) - server functions are framework-managed routes, not plain (req)=>Response handlers.');
      warnings.push('No direct handler export path for TanStack Start server functions in this preset version. Wire the built output manually (.output/server/index.mjs, node adapter) - PRD v0.3 "framework recipes" documents this as a detected-but-not-yet-automatable shape.');
      configParts.push('// TanStack Start: wire .output/server/index.mjs through the node adapter in this config.');
    } else {
      notes.push('No supabase/ or TanStack Start markers in this export.');
      warnings.push('This looks like a static-SPA export (no server handlers found). crashtest attacks server HANDLERS; a pure-static site has nothing to attack - point the config at your real backend if there is one.');
      configParts.push(`// Detection result: no server handlers found in this export.\nexport default {\n  // routes/adapters must be filled in by hand - nothing was auto-detected.\n};`);
    }
  }

  if (name === 'replit') {
    if (d.replit.runCommand) {
      notes.push(`.replit run command: ${d.replit.runCommand}`);
      warnings.push('Replit exports are project-specific servers: the run command starts a LISTENING server, which is not directly the shape crashtest dispatches against. Wire the adapter entry that exports your app (hono/fastify/express), not the `node server.js` listening shell - the presets doc in DEPLOY.md shows the one-line wiring.');
      configParts.push(`// .replit run: ${d.replit.runCommand}`);
      configParts.push(`export default {\n  // adapters: { express: yourApp } (or hono/fastify/node)\n  // env: { ... }\n};`);
    } else {
      warnings.push('No .replit run command and no replit.nix found - this does not look like a Replit-managed repo. Nothing guessed.');
      configParts.push(`// Detection result: no Replit markers. Fill config by hand.\nexport default {};`);
    }
  }

  if (d.packageJson.parseFailed) warnings.push('package.json exists but is not valid JSON - that is a repo-level error crashtest will not paper over.');

  return { preset: name, detection: d, configSource: configParts.join('\n') + '\n', notes, warnings };
}

export default { listPresets, detect, scaffoldPreset, probeHandler };

// --- the probe: detect-then-prove ---------------------------------------------

/**
 * probeHandler(fnPath, opts) - the v0.3.1 stronger proof: execute a FOUND
 * handler ONCE in-process and report what came back, so the preset's answer
 * is "here's what I measured" rather than "here's what the shape looks like".
 *
 * The rules that keep this safe and honest:
 * - **No sockets.** The handler is import()'d and CALLED with a WHATWG
 *   Request, exactly like the harness does. If it calls app.listen() at
 *   module scope, the import itself fails loudly with the caught error - the
 *   probe reports that as the finding, it does not wrap the listen in a fake.
 * - **Plain ESM import().** TS/Deno files cannot be probed - the caller
 *   (cmdPreset) skips probing for `.ts` paths and says why instead of
 *   pretending. This is the same no-transpile rule the loader enforces.
 * - **Fetch-export interface only** (default { fetch }) - the documented
 *   Supabase quickstart shape. A Deno.serve() file has no callable export
 *   object; the probe reports `probed: false` with that reason instead of
 *   guessing at a wrapper.
 * - **Determinism**: a fixed GET on the module origin + `/__ct-probe`, no
 *   randomness, timeout-guarded - the fetch AND the body read both race a
 *   timer (default 3000ms, opts.timeoutMs); a hung handler is a probe
 *   finding, never a hang.
 *
 * @param {string} fnPath absolute path to the JS entry of a found handler
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<{
 *   probed: boolean,
 *   reason?: string,
 *   status?: number,
 *   ok?: boolean,
 *   bodyBytes?: number,
 *   ms?: number,
 *   error?: string,
 * }>} a probe RESULT record - never a throw (probing is evidence, and a
 *   failed probe is evidence too; the caller renders it as such).
 */
export async function probeHandler(fnPath, opts = {}) {
  const out = (r) => ({ probed: false, ...r });
  // A probe that HANGS is worse than a probe that fails: without a cap the
  // CLIverb never returns and the operator cannot even see the finding.
  // (The doc always said "timeout-guarded"; the timer now exists to prove it.)
  // Timers are tracked and cleared in the finally below + unref'd: a probe
  // over N edge functions must not hold the CLI's event loop open for
  // timeoutMs apiece after the answer is already in hand (the preset verb
  // would exit seconds late - a real exit-latency bug, not style).
  const timeoutMs = opts.timeoutMs ?? 3000;
  const timers = [];
  const raceTimeout = (ms, what) => {
    let reject;
    const p = new Promise((_, rej) => { reject = rej; });
    const t = setTimeout(() => { clearTimeout(t); const e = new Error(`${what} hung past ${ms}ms (probe timeout)`); e.probeReason = e.message; reject(e); }, ms);
    t.unref?.();
    timers.push(t);
    return p;
  };
  if (!/\.(m?js)$/i.test(fnPath)) {
    return out({ reason: 'not plain ESM JS (.ts/.deno cannot be probed - crashtest does not transpile)' });
  }
  let mod;
  try {
    mod = await import(pathToFileURL(fnPath).href);
  } catch (e) {
    return out({ reason: `import failed (watch for top-level listen() errors): ${e.message}` });
  }
  const candidate = mod.default;
  if (!candidate || typeof candidate !== 'object' || typeof candidate.fetch !== 'function') {
    return out({ reason: 'no default { fetch } export found (the documented quickstart interface); Deno.serve() files have no callable export object' });
  }
  const request = new Request('https://crashtest-probe.local/__ct-probe', { method: 'GET' });
  const started = performance.now();
  try {
    const response = await Promise.race([
      candidate.fetch(request),
      raceTimeout(timeoutMs, 'handler'),
    ]);
    if (!response || typeof response.status !== 'number' || typeof response.headers?.get !== 'function') {
      return out({ reason: `default.fetch did not return a Response (got ${typeof response})` });
    }
    const text = await Promise.race([response.text(), raceTimeout(timeoutMs, 'response body')]);
    return {
      probed: true,
      status: response.status,
      ok: response.ok,
      bodyBytes: new TextEncoder().encode(text).length, // BYTES, not JS chars (utf-8 bodies misreport by \u oversampling)
      ms: Math.round(performance.now() - started),
    };
  } catch (e) {
    // A genuine throw keeps its named evidence wording (pinned); a timer
    // rejection carries its own probe reason through e.probeReason.
    return out({ reason: e?.probeReason ?? `handler threw on a plain GET: ${e?.message ?? e}` });
  } finally {
    closeProbeTimers(timers);
  }
}

function closeProbeTimers(timers) {
  for (const t of timers) clearTimeout(t);
}
