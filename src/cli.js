// crashtest CLI - zero runtime dependencies, Node >=18.17, ESM.
// Verbs: init | run | --version | --help
// Exit rules (PRD section 7, binding from 0.1): non-zero ONLY on a new EXPLOITED
// finding or a regression of a previously REFUSED check.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHarness } from './harness/harness.js';
import { registerAdapters } from './adapters/index.js';
import { loadScenarios } from './scenarios/loader.js';
import { loadPacks } from './packs/loader.js';
import { loadPlugins, configDir } from './plugins/loader.js';
import { runCampaign } from './campaigns/runner.js';
import { buildLedger, diffAgainstBaseline, exitCode, renderMarkdown } from './report.js';
import { buildModulePlan } from './plans.js';
import { listPresets, scaffoldPreset, probeHandler } from './presets.js';

const VERSION = '1.0.0';
const LEDGER_PATH = 'labs/crashledger.json';
const REPORT_PATH = 'labs/hardening.md';

const HELP = `
crashtest v${VERSION} - "We break it so they can't."
Adversarial QA for agent-built apps: redteam/fuzz/barrage/guards campaigns
against your REAL handlers, in-process. No sockets, ever.

QUICK START (about 2 minutes)
  npx crashtest init            # labs/crashledger.json + labs/hardening.md stub
  # write crashtest.config.js: your routes/adapters + a fake env (see docs)
  npx crashtest run --module-plan   # WHICH attacks would fire? (dry-run)
  npx crashtest run                 # attack for real; exit 0 unless a NEW
                                    # EXPLOITED finding or a regression
  # commit labs/ - CI now fails when old defenses rot

COMMANDS
  crashtest init [--force]    Scaffold labs/ (+ packs/public + packs/local stubs)
  crashtest run               Attack the target declared in crashtest.config.js
    --config <path>           Target config (default ./crashtest.config.js)
    --json                    Append the machine run blob to stdout (LAST line)
    --module-plan             Dry-run: which attack ids WOULD fire (exit 0 always)
    --expect-baseline <path>  Diff against a given ledger WITHOUT touching labs/
                              (read-only CI/hosted mode; exit rules unchanged)
    --out-dir <dir>           ALSO write run-blob.json + crashledger.json +
                              hardening.md copies into dir (artifact fan-out;
                              the repo's labs/ rules are untouched)
  crashtest packs             List discovered packs (public + local)
    --config <path>           Honor the config's packs knob
    --json                    Machine inventory (versions, armedByKey, npm pkg)
  crashtest packs add <name> [--public]
                              Scaffold a fresh pack (local + gitignored by default)
  crashtest preset <name> [--root <dir>]
                              Generate a starter config for an agent-builder
                              export (lovable | bolt | replit) from what is
                              ACTUALLY in the repo - never a guess
  crashtest --version
  crashtest --help

EXIT CODES (the CI contract)
  0  baseline held (nothing new weak, nothing old broke)
  1  NEW EXPLOITED finding, or a REFUSED -> EXPLOITED regression
  2  config problem (missing/bad config or baseline) - the run is wrong,
     not your code

MODULES  auth - guards - input - state - volume (plus your own via packs/,
labs/scenarios/, or config plugins: [npm-package-or-path]). Every attack
returns one verdict:
  REFUSED   the defense held
  EXPLOITED you got hit (CI fails the FIRST time this is new)
  BOUNDED   accepted risk; needs owner + bound or it is a finding

FIRST RUN INFO
  - init scaffolds packs/local/ and appends it to .gitignore (private packs
    stay on your machine); packs/public/ is tracked + sharable
  - run --module-plan: the coverage dry-run. NEEDS-ARMING rows mean a pack
    wants moduleCtx['<key>'] in your config; at run time they REFUSE-skip,
    never false-positive.
  - run rewrites labs/crashledger.json + labs/hardening.md; that is how you
    cut a baseline. In CI/hosted read-only lanes use --expect-baseline.
  - the run blob (run --json, last stdout line) - and ledgers - paste straight
    into the dashboard: https://crashtest.creadev.org/dashboard

DOCS       https://docs.creadev.org/crashtest/ (quick start, playbooks per
           framework, attack catalog, ledger format, module plans)
SITE       https://crashtest.creadev.org/
`;

function repoRoot() {
  // v0.0.x: run tests/targets relative to CWD (the project being attacked).
  return process.cwd();
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const EMPTY_LEDGER = () => ({
  schemaVersion: 1,
  crashtestVersion: VERSION,
  generatedAt: new Date().toISOString(),
  // Findings are keyed by attack id; verdicts: REFUSED | EXPLOITED | BOUNDED.
  findings: [],
  // Accepted risks live here with owners and bounds - an accepted risk
  // without a bound is a finding (PRD principle 6).
  acceptedRisks: [],
  // Baseline of previously-REFUSED check results for CI regression gates.
  baseline: []
});

const REPORT_STUB = () => `# Hardening report

> Generated by crashtest v${VERSION}. Companion machine file: ${LEDGER_PATH}.
> CI rule (binding from 0.1): fail on a NEW EXPLOITED finding, or on a
> regression of anything previously REFUSED. Accepted risks on this page
> must carry an owner and a bound.

## Findings

_Run pending - campaigns ship in 0.1._

## Accepted risks

_None - the ledger is empty._

## Cost economics

_Pending - op counters ship in 0.1._

## Baseline diff

- NEW: unknown / REGRESSED: unknown (no campaign run yet)
`;

async function cmdInit({ force }) {
  const root = repoRoot();
  const ledgerAbs = join(root, LEDGER_PATH);
  const reportAbs = join(root, REPORT_PATH);

  for (const [abs, rel] of [[ledgerAbs, LEDGER_PATH], [reportAbs, REPORT_PATH]]) {
    if ((await exists(abs)) && !force) {
      console.error(`crashtest init: ${rel} already exists (use --force to overwrite)`);
      process.exitCode = 1;
      return;
    }
  }

  await mkdir(join(root, 'labs'), { recursive: true });
  await writeFile(ledgerAbs, JSON.stringify(EMPTY_LEDGER(), null, 2) + '\n');
  await writeFile(reportAbs, REPORT_STUB());
  // Pack scaffold (the extension surface): public = tracked/sharable,
  // local = machine-private (gitignored). crashtest never writes your
  // private pack's contents - just the empty directories + a stub manifest.
  const publicPack = join(root, 'packs', 'public', 'my-pack');
  const localPack = join(root, 'packs', 'local', 'my-private-pack');
  await mkdir(publicPack, { recursive: true });
  await mkdir(localPack, { recursive: true });
  const PACK_STUB = (name, desc) => JSON.stringify({
    schemaVersion: 1,
    name,
    description: desc,
    entry: 'index.js',
    _notes: 'Set entry to your scenario-module file; every export must satisfy the scenario contract (see docs/reference/packs).',
  }, null, 2) + '\n';
  await writeFile(join(publicPack, 'pack.json'), PACK_STUB('my-pack', 'A public pack: share it, track it, version it'));
  await writeFile(join(localPack, 'pack.json'), PACK_STUB('my-private-pack', 'A private pack: packs/local/ is gitignored by default - stays on your machine'));
  // Root .gitignore owns the local-pack privacy (created or appended once).
  const dotIgnore = join(root, '.gitignore');
  const ignoreEntry = 'packs/local/\n';
  const existingIgnore = (await exists(dotIgnore)) ? await readFile(dotIgnore, 'utf8') : '';
  if (!existingIgnore.split('\n').includes(ignoreEntry.trim())) {
    await writeFile(dotIgnore, existingIgnore + (existingIgnore && !existingIgnore.endsWith('\n') ? '\n' : '') + ignoreEntry);
  }
  console.log(`crashtest init: wrote ${LEDGER_PATH}`);
  console.log(`crashtest init: wrote ${REPORT_PATH}`);
  console.log('crashtest init: packs/ scaffold - packs/public/ (tracked) + packs/local/ (gitignored) with stub manifests');
  console.log('Next: commit labs/ so CI has a baseline, then `crashtest run` (0.1).');
}

async function cmdRun(opts = {}) {
  // PRD section 14 alignment: `run --json` appends the machine run blob (tally,
  // verdict rows, cost economics) as the LAST stdout line - the exact shape
  // the dashboard bridge (/dashboard and web/src/lib/ledgerModel.js) and any
  // future hosted runner read. Human output is unchanged.
  const root = repoRoot();
  const configPath = join(root, opts.config ?? 'crashtest.config.js');
  if (!(await exists(configPath))) {
    console.error(`crashtest run: no ${configPath.split('/').pop()} in ${root}`);
    console.error('A target needs a config declaring its routes + env, e.g.:');
    console.error('  export default { routes: { enroll: handler }, env: { d1: {...}, secrets: {...} } }');
    console.error('Directories: labs/scenarios/ is auto-scanned for extra scenario modules.');
    process.exitCode = 2;
    return;
  }

  const target = (await import(pathToFileURL(configPath).href)).default;
  const harness = buildHarness(target.routes ?? {}, {
    env: target.env ?? {},
    cost: target.cost ?? {},
    baseUrl: target.baseUrl,
  });
  if (target.adapters) registerAdapters(harness, target.adapters);
  // routeAliases: name => { route: baseName, path, method } - maps the
  // scenario vocabulary (enroll/device/admin/kvwrite/burst) onto real paths
  // of ONE dispatching app (raw Node or framework adapter). Read the docs:
  // DEPLOY.md "routeAliases".
  if (target.routeAliases) {
    for (const [name, spec] of Object.entries(target.routeAliases)) {
      const { route, path, method } = typeof spec === 'string' ? { route: spec } : spec;
      if (!route) throw new TypeError(`routeAliases.${name}: needs a source "route"`);
      harness.aliasRoute(name, route, { path, method });
    }
  }

  const scenarios = await loadScenarios([
    ...(target.scenarioDirs ?? []),
    join(root, 'labs', 'scenarios'),
  ]);
  // Packs (PRD section 14 extension surface): `packs` config knob = true (default:
  // discover packs/public + packs/local), false (dogfooded targets opt out),
  // or an explicit list of pack roots. Loaded modules join the same campaign.
  const packsOpt = target.packs ?? true;
  let packScenarios = [];
  let loadedPacks = [];
  if (packsOpt !== false) {
    const packRoots = Array.isArray(packsOpt) ? packsOpt : [join(root, 'packs')];
    loadedPacks = await loadPacks(packRoots);
    packScenarios = loadedPacks.map((p) => ({ origin: p.origin, module: p.module }));
    // Bundled plugin imports (pack.json "plugins"): the unified surface - a
    // pack ships BOTH its own entry module and imported scenario modules,
    // with the plan labels naming the packing pack honestly.
    for (const p of loadedPacks) {
      for (const b of p.bundled ?? []) {
        packScenarios.push({ origin: `pack:${p.origin} -> ${b.origin}`, module: b.module });
      }
    }
    const names = new Map(scenarios.map((s) => [s.module.name, s.origin]));
    for (const s of packScenarios) {
      if (names.has(s.module.name)) {
        throw new Error(`scenario name collision: "${s.module.name}" at ${s.origin} (also in ${names.get(s.module.name)})`);
      }
      names.set(s.module.name, s.origin);
    }
  }
  // Plugins (PRD v0.3 "the ecosystem"): config `plugins` = an array of
  // importable ESM specifiers (npm package names / local paths relative to
  // the config file). Same contract as packs and libraries - the plan's
  // source labels distinguish the surfaces honestly. This stays as the
  // top-level escape hatch; the UNIFIED surface is pack.json "plugins"
  // (packs can bundle their own imports), so a pack is fully self-contained.
  let pluginScenarios = [];
  if (Array.isArray(target.plugins)) {
    const names = new Map(scenarios.map((s) => [s.module.name, s.origin]));
    const pluginRows = await loadPlugins(target.plugins, configDir(configPath), names);
    pluginScenarios = pluginRows.map((p) => ({ origin: p.origin, module: p.module }));
  } else if (target.plugins !== undefined) {
    throw new TypeError('config `plugins` must be an array of ESM specifiers (npm names or .js/.mjs paths)');
  }
  const allScenarios = [...scenarios, ...packScenarios, ...pluginScenarios]
    .sort((a, b) => a.module.name.localeCompare(b.module.name));
  if (!allScenarios.length) throw new Error('no scenario modules found (built-ins missing?)');

  // PRD section 14: `run --module-plan` - the coverage dry-run. Same loaders, same
  // filters, same arming rules as the real run; NO harness, NO requests,
  // nothing written. Exit 0 always (informational, not a gate).
  if (opts.modulePlan) {
    const plan = buildModulePlan(target, loadedPacks, allScenarios);
    for (const m of plan.modules) {
      const mark = { 'WILL-FIRE': '▶', 'NEEDS-ARMING': '⚑', 'SKIPPED-FILTER': '-' }[m.status] ?? '?';
      console.log(`${mark} ${m.name} [${m.source}${m.version ? ` @${m.version}` : ''}] ${m.attacks.length} attack(s) - ${m.status}${m.reason ? `: ${m.reason}` : ''}`);
      for (const a of m.attacks) console.log(`    ${a.id} - ${a.status}`);
    }
    console.log(`plan: ${plan.totals.attacks} attack ids - ${plan.totals.willFire} WILL-FIRE / ${plan.totals.needsArming} NEEDS-ARMING / ${plan.totals.skippedFilter} SKIPPED-FILTER`);
    if (opts.json) console.log(JSON.stringify(plan));
    return;
  }

  const run = await runCampaign(harness, allScenarios, {
    modules: target.modules,
    attackCtx: target.attackCtx,
    moduleCtx: target.moduleCtx,
    seed: target.seed,
  });

  const ledgerPath = join(root, LEDGER_PATH);
  let prior = null;
  if (opts.expectBaseline) {
    // PRD section 14: `run --expect-baseline <path>` - diff against a ledger the
    // caller hands in, WITHOUT touching labs/. The hosted/CI read-only mode:
    // the service (or a PR run against the target's committed ledger) must
    // not write into the repo it attacks. Exit rules (section 7) are unchanged.
    const baselinePath = join(root, opts.expectBaseline);
    if (!(await exists(baselinePath))) {
      console.error(`crashtest run: --expect-baseline: no ledger at ${opts.expectBaseline}`);
      process.exitCode = 2;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(baselinePath, 'utf8'));
    } catch (e) {
      console.error(`crashtest run: --expect-baseline: ${opts.expectBaseline} is not valid JSON (${e.message})`);
      process.exitCode = 2;
      return;
    }
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== 1 || !Array.isArray(parsed.baseline)) {
      console.error(`crashtest run: --expect-baseline: ${opts.expectBaseline} is not a schema-1 ledger (wants { schemaVersion: 1, findings, acceptedRisks, baseline })`);
      process.exitCode = 2;
      return;
    }
    prior = parsed;
  } else if (await exists(ledgerPath)) {
    prior = JSON.parse(await readFile(ledgerPath, 'utf8'));
  }
  const ledger = buildLedger(run, prior);
  const diff = diffAgainstBaseline(run, prior);

  if (opts.expectBaseline) {
    // Read-only: no labs/ writes at all - the caller owns the baseline.
    console.log(`baseline: read-only diff against ${opts.expectBaseline} / labs/ untouched`);
  } else {
    await mkdir(join(root, 'labs'), { recursive: true });
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
    await writeFile(join(root, REPORT_PATH), renderMarkdown(run, ledger, diff, { version: VERSION, seed: target.seed }));
  }

  // PRD section 14/section 15: `run --out-dir <dir>` - artifact fan-out for the CI/service
  // thread. Writes COPIES of the run blob, ledger, and report into the given
  // directory (created if needed) WITHOUT touching the repo's labs/ rules:
  // the gate artifacts stay where the contract says they live; --out-dir is
  // a rendering surface, never authoritative (section 15.3's hosted-copies rule).
  // Deterministic filenames, no timestamps - same run, same bytes.
  let outDirStat = null;
  if (opts.outDir) {
    const outDir = resolve(root, opts.outDir);
    if (outDir === root) {
      console.error('crashtest run: --out-dir must be a distinct directory (the repo root already owns labs/)');
      process.exitCode = 2;
      return;
    }
    await mkdir(outDir, { recursive: true });
    const fanout = [
      ['run-blob.json', JSON.stringify(run, null, 2) + '\n'],
      ['crashledger.json', JSON.stringify(ledger, null, 2) + '\n'],
      ['hardening.md', renderMarkdown(run, ledger, diff, { version: VERSION, seed: target.seed })],
    ];
    for (const [name, body] of fanout) {
      await writeFile(join(outDir, name), body);
    }
    console.log(`artifacts: ${fanout.map(([n]) => n).join(', ')} -> ${outDir}`);
    outDirStat = { dir: outDir, files: fanout.map(f => f[0]) };
  }

  // Console summary: verdicts as they land, ledger + exit rule at the end.
  for (const row of run.rows) {
    const mark = { REFUSED: '🛡', EXPLOITED: '⚡', BOUNDED: '🔒' }[row.verdict] ?? '?';
    console.log(`${mark} ${row.id}: ${row.detail}`);
  }
  console.log(`\ntally: ${JSON.stringify(run.tally)} / cost: ${run.cost.totals.ops} ops / ${run.cost.totals.requests} requests`);
  if (opts.expectBaseline) {
    console.log(`target: ${opts.expectBaseline} (read-only diff - no ledger/report written)`);
  } else {
    console.log(`ledger: ${LEDGER_PATH} / report: ${REPORT_PATH}`);
  }
  console.log(`baseline: ${diff.newExploited.length} new / ${diff.regressed.length} regressed / ${diff.acceptedHits.length} accepted hits`);
  if (opts.json) console.log(JSON.stringify(outDirStat ? { ...run, artifacts: outDirStat } : run));
  process.exitCode = exitCode(diff);
}

/**
 * `crashtest preset <name> [--root <dir>]` - the v0.3 one-line preset verb.
 * Detects what is actually in an exported repo and prints the config source
 * plus honest notes/warnings. Never guesses a handler shape from the
 * builder's name (rule 7: no fiction).
 */
async function cmdPreset(name, opts = {}) {
  if (!name || name === 'list') {
    console.log('presets: one-line configs generated from what detect() finds in a repo');
    for (const p of listPresets()) console.log(`  ${p.name} - ${p.oneLine}`);
    if (!name) console.log('usage: crashtest preset <lovable|bolt|replit> [--root <dir>]');
    return;
  }
  const out = await scaffoldPreset(name, opts.repoRoot);
  console.log(`preset ${name} - detection against ${opts.repoRoot}`);
  for (const n of out.notes) console.log(`  / ${n}`);
  for (const w of out.warnings) console.log(`  ! ${w}`);
  const probes = await probeDetectedHandlers(name, opts.repoRoot, out);
  for (const [fn, p] of probes) {
    if (p.probed) {
      console.log(`  [ok] probe ${fn}: GET -> ${p.status} (ok=${p.ok}, ${p.bodyBytes}B, ${p.ms}ms) - in-process dispatch PROVEN, no socket opened`);
    } else if (p.reason) {
      console.log(`  - probe ${fn}: not executed - ${p.reason}`);
    }
  }
  if (!out.notes.length && !out.warnings.length) console.log('  (nothing notable)');
  console.log('\n--- crashtest.config.js ---');
  console.log(out.configSource);
  if (out.warnings.length) {
    console.log('warnings above name exactly what detect() could not resolve - wire the handler by hand; nothing was guessed.');
  }
}

/**
 * Probe every JS-eligible handler the preset found (v0.3.1 probe): the
 * preset's notes carry the per-function detail; this renders the one-line
 * proof/not-executed statement per handler. Evidence, never a throw - a
 * failed probe is reported as the finding it is.
 */
async function probeDetectedHandlers(name, repoRoot, presetOutput) {
  const out = [];
  const fns = presetOutput.detection?.supabase?.functions ?? [];
  for (const fn of fns) {
    const rel = `supabase/functions/${fn}/index.ts`;
    const candidate = join(repoRoot, rel.replace(/\.ts$/, '.js'));
    // Only plain-JS entries are probeable: the compiled-output / shim path.
    // A .ts path probes its .js neighbor IF the repo compiled one; otherwise
    // probeHandler answers with the no-transpile reason.
    const p = await probeHandler(candidate);
    out.push([fn, p]);
  }
  return out;
}

async function cmdPacks(opts = {}) {
  const root = repoRoot();
  const roots = [join(root, 'packs')];
  if (opts.config) {
    const target = (await import(pathToFileURL(join(root, opts.config)).href)).default;
    if (target.packs === false) { console.log('packs: disabled in this config'); return; }
    if (Array.isArray(target.packs)) {
      roots.length = 0;
      roots.push(...target.packs);
    }
  }
  const packs = await loadPacks(roots);
  if (!packs.length) {
    console.log('packs: none found - `crashtest init` scaffolds packs/public/ (tracked) + packs/local/ (gitignored)');
    return;
  }
  for (const p of packs) {
    const pkg = p.manifest.package ? ` (npm: ${p.manifest.package})` : '';
    const arm = p.manifest.armedByKey ? ` / armedBy moduleCtx['${p.manifest.armedByKey}']` : '';
    console.log(`${p.visibility}${p.manifest.version ? ` @${p.manifest.version}` : ''} - ${p.manifest.name}: ${p.module.attacks.length} attacks from ${p.origin}${pkg}${arm}`);
    console.log(`         ${p.manifest.description}`);
  }
  if (opts.json) {
    // Machine inventory (PRD section 14 artifact): the registry VERSION JOIN stays
    // outside the CLI on purpose - a CI step pairs this with `npm view <pkg>
    // version` and diffs, keeping the drone fully offline.
    console.log(JSON.stringify({
      packs: packs.map((p) => ({
        name: p.manifest.name,
        visibility: p.visibility,
        version: p.manifest.version ?? null,
        package: p.manifest.package ?? null,
        entry: p.manifest.entry ?? 'index.js',
        origin: p.origin,
        attacks: p.module.attacks.length,
        armedByKey: p.manifest.armedByKey ?? null,
        description: p.manifest.description,
      })),
    }));
  }
}

/**
 * `crashtest packs add <name> [--public]` - scaffold a fresh pack.
 * local (gitignored) by default; --public means tracked/sharable. Writes a
 * schema-v1 manifest + a contract-valid scenario-module stub so `packs` and
 * `run` pick it up immediately; target vocabulary rides moduleCtx[<name>].
 */
async function cmdPackAdd(name, opts = {}) {
  if (!name) {
    console.error('crashtest packs add: usage: crashtest packs add <name> [--public]');
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`crashtest packs add: "${name}" is not kebab-case (lowercase letters, digits, hyphens; must start with a letter or digit)`);
    process.exitCode = 1;
    return;
  }
  const root = repoRoot();
  const visibility = opts.public ? 'public' : 'local';
  const dir = join(root, 'packs', visibility, name);
  if (await exists(dir)) {
    console.error(`crashtest packs add: packs/${visibility}/${name} already exists - refusing to overwrite`);
    process.exitCode = 1;
    return;
  }
  const manifest = JSON.stringify({
    schemaVersion: 1,
    name,
    description: `TODO: one line on what ${name} attacks`,
    version: '0.0.1',
    entry: 'index.js',
  }, null, 2) + '\n';
  const stub = `// packs/${visibility}/${name}/index.js - scaffolded by \`crashtest packs add ${name}\`.
// Scenario contract: { name, description, attacks: [{ name, run(harness, ctx) -> ONE record }] }.
// Record verdicts: 'REFUSED' (defense held) / 'EXPLOITED' / 'BOUNDED' (needs owner + bound).
// Target vocabulary (route names, CPTs, meta keys...) goes in crashtest.config.js as
//   moduleCtx: { ${name}: { ... } } - missing keys degrade to a REFUSED skip, never a false positive.
export default {
  name: '${name}',
  description: 'TODO: one line',
  // Coverage (module-plan) sees this: while your moduleCtx['${name}'] is
  // unset, the plan marks NEEDS-ARMING instead of assuming the pack fires.
  armedByKey: '${name}',
  attacks: [{
    name: 'first-attack',
    description: 'TODO: what this attack fires and what must hold',
    async run(harness, ctx) {
      const cfg = ctx?.config?.['${name}'] ?? null;
      if (!cfg) {
        return { verdict: 'REFUSED', skip: true, detail: "not armed - set moduleCtx['${name}'] in crashtest.config.js" };
      }
      // TODO: fire requests with harness.run(...) (or harness.wpState on the WP
      // adapter) and return EXACTLY one record. See docs/reference/packs.md.
      return { verdict: 'REFUSED', detail: 'scaffold attack - replace with a real probe' };
    },
  }],
};
`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'pack.json'), manifest);
  await writeFile(join(dir, 'index.js'), stub);
  console.log(`crashtest packs add: wrote packs/${visibility}/${name}/ (pack.json + index.js stub)`);
  if (visibility === 'public') {
    console.log('next: it is tracked content - list it in the check inventory / docs if this repo ships it');
  } else {
    // Local privacy: same rule `init` applies - root .gitignore owns it.
    const dotIgnore = join(root, '.gitignore');
    const ignoreEntry = 'packs/local/\n';
    const existing = (await exists(dotIgnore)) ? await readFile(dotIgnore, 'utf8') : '';
    if (!existing.split('\n').includes(ignoreEntry.trim())) {
      await writeFile(dotIgnore, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + ignoreEntry);
      console.log('crashtest packs add: appended packs/local/ to .gitignore (stays on your machine)');
    }
    console.log('next: fill moduleCtx[\'' + name + '\'] in crashtest.config.js, then `crashtest packs` to verify');
  }
}

export async function main(argv) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    process.stdout.write(HELP);
    return;
  }
  const verb = argv[0];
  if (verb === '--version' || verb === '-v' || verb === 'version') {
    console.log(`crashtest v${VERSION}`);
    return;
  }
  if (verb === 'init') {
    const force = argv.includes('--force') || argv.includes('-f');
    return cmdInit({ force });
  }
  if (verb === 'packs') {
    if (argv[1] === 'add') {
      const name = argv[2];
      return cmdPackAdd(name, { public: argv.includes('--public') });
    }
    const confIdx = argv.indexOf('--config');
    return cmdPacks({ config: confIdx > -1 ? argv[confIdx + 1] : undefined, json: argv.includes('--json') });
  }
  if (verb === 'preset') {
    const name = argv[1];
    const rootIdx = argv.indexOf('--root');
    const root = rootIdx > -1 ? argv[rootIdx + 1] : '.';
    return cmdPreset(name, { repoRoot: resolve(root) });
  }
  if (verb === 'run') {
    const confIdx = argv.indexOf('--config');
    const config = confIdx > -1 ? argv[confIdx + 1] : undefined;
    const json = argv.includes('--json');
    const modulePlan = argv.includes('--module-plan');
    const baseIdx = argv.indexOf('--expect-baseline');
    const expectBaseline = baseIdx > -1 ? argv[baseIdx + 1] : undefined;
    const outIdx = argv.indexOf('--out-dir');
    const outDir = outIdx > -1 ? argv[outIdx + 1] : undefined;
    return cmdRun({ config, json, modulePlan, expectBaseline, outDir });
  }
  console.error(`crashtest: unknown command "${verb}" (try --help)`);
  process.exitCode = 1;
}

const cliDir = dirname(fileURLToPath(import.meta.url));

// Exposed for tests.
export { LEDGER_PATH, REPORT_PATH, VERSION, EMPTY_LEDGER, REPORT_STUB, cliDir };
