// v0.3 — the ecosystem: plugins (importable scenario modules) + presets.
// Every surface here obeys the same two rules as packs:
//   house rule 3: broken plugins/presets fail loudly, never silently
//   house rule 7: detection names repo EVIDENCE, never builder-name fiction

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadPlugins, configDir } from '../src/plugins/loader.js';
import { listPresets, detect, scaffoldPreset } from '../src/presets.js';

async function tempRepo(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ct-v03-'));
  for (const [rel, content] of Object.entries(files)) {
    const parts = rel.split('/');
    const dirs = parts.slice(0, -1);
    if (dirs.length) await mkdir(join(dir, ...dirs), { recursive: true });
    await writeFile(join(dir, ...parts), content);
  }
  return dir;
}

const PLUGIN_MODULE = `
export default {
  name: 'canary-plugin',
  description: 'smoke: one plugin attack lands via the plugins knob',
  attacks: [{
    name: 'canary',
    async run(harness, ctx) {
      return { verdict: 'REFUSED', detail: 'canary fired', skipped: false };
    },
  }],
};
`;

test('plugins: an ESM file spec (relative to the config) loads + validates through the contract', async () => {
  const dir = await tempRepo({ 'shims/canary.js': PLUGIN_MODULE });
  const rows = await loadPlugins(['./shims/canary.js'], dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].module.name, 'canary-plugin');
  assert.equal(rows[0].origin, 'plugin:./shims/canary.js');
});

test('plugins: a module missing the contract fails loudly naming the plugin', async () => {
  const dir = await tempRepo({
    'shims/broken.js': `export default { name: 'x', no_attacks: true };`,
  });
  await assert.rejects(
    loadPlugins(['./shims/broken.js'], dir),
    /invalid scenario module \(plugin:\.\/shims\/broken\.js\)/,
  );
});

test('plugins: a nonexistent specifier fails loudly with the honest resolver reason', async () => {
  const dir = await tempRepo({});
  await assert.rejects(
    loadPlugins(['./shims/ghost.js'], dir),
    /plugin "\.\/shims\/ghost\.js" failed to load/,
  );
});

test('plugins: name collisions against an earlier surface throw with the earlier origin', async () => {
  const dir = await tempRepo({ 'shims/canary.js': PLUGIN_MODULE });
  const seen = new Map([['canary-plugin', 'pack:public/canary']]);
  await assert.rejects(
    loadPlugins(['./shims/canary.js'], dir, seen),
    /plugin name collision: .*already loaded from pack:public\/canary/,
  );
});

test('plugins: junk shapes fail loudly (string entry, non-string array item)', async () => {
  const dir = await tempRepo({ 'shims/canary.js': PLUGIN_MODULE });
  await assert.rejects(loadPlugins('canary-plugin', dir), /must be/);
  await assert.rejects(loadPlugins(['./shims/canary.js', 42], dir), /non-empty strings/);
  await assert.rejects(loadPlugins(['./shims/canary.js', ''], dir), /non-empty strings/);
});

test('plugins: configDir points at the config file’s dir (resolution root)', (t) => {
  assert.equal(configDir('/a/b/crashtest.config.js'), '/a/b');
});

test('plugins: cmdRun honors the plugins knob end-to-end (canary lands in the ledger)', async () => {
  // Dealers-choice integration proof: drive main() like test/cli.test.js does.
  const work = await mkdtemp(join(tmpdir(), 'ct-v03-run-'));
  const pluginDir = await tempRepo({ 'canary.js': PLUGIN_MODULE });
  const prevCwd = process.cwd();
  process.chdir(work);
  try {
    await writeFile(join(work, 'crashtest.config.js'), [
      "import { buildRoutes, ENV_SPEC } from 'dummy-does-not-exist';",
    ].join('\n')); // placeholder — replaced below with real fixture imports
  } finally {
    process.chdir(prevCwd);
  }
  // Rewritten: use absolute imports of the REAL demo fixture, same pattern
  // as test/self-site.test.js run roots.
  const repoRoot = join(new URL('..', import.meta.url).pathname);
  await writeFile(join(work, 'crashtest.config.js'), [
    `const { buildRoutes, ENV_SPEC } = await import(${JSON.stringify(join(repoRoot, 'fixtures/demo/app.js'))});`,
    `export default {`,
    `  baseUrl: 'https://dogfood.crashtest.local',`,
    `  env: ENV_SPEC,`,
    `  routes: buildRoutes({ vulnerable: false }),`,
    `  packs: false,`,
    `  plugins: [${JSON.stringify(join(pluginDir, 'canary.js'))}],`,
    `  seed: 0xC0FFEE,`,
    `};`,
    ``,
  ].join('\n'));
  // The plugin module must ALSO fail the baseline gate silently — its REFUSED
  // verdict adds an attack the ledger's baseline doesn't know; per §7 a NEW
  // REFUSED row is not a failure (only new EXPLOITED / regressed REFUSED are).
  process.chdir(work);
  const { main, LEDGER_PATH } = await import('../src/cli.js');
  try {
    await main(['run']);
    assert.equal(process.exitCode, 0, 'a new REFUSED-only plugin never trips the gate');
    const ledger = JSON.parse(await writeFileRead(LEDGER_PATH));
    const canary = ledger.findings.find((f) => f.id === 'canary-plugin/canary');
    assert.ok(canary, 'the plugin attack landed in the ledger');
    assert.equal(canary.verdict, 'REFUSED');
    process.exitCode = undefined;
  } finally {
    process.chdir(prevCwd);
  }
});

async function writeFileRead(p) {
  const { readFile } = await import('node:fs/promises');
  return readFile(p, 'utf8');
}

// ---- presets ----

test('presets: list names all three with one-liners', () => {
  const names = listPresets().map((p) => p.name).sort();
  assert.deepEqual(names, ['bolt', 'lovable', 'replit']);
  assert.ok(listPresets().every((p) => p.oneLine.length > 10));
});

test('presets: lovable detection finds supabase functions + identifies the fetch export', async () => {
  const dir = await tempRepo({
    'supabase/config.toml': 'project_id = "x"\n',
    'supabase/functions/my-func/index.ts': 'export default { async fetch(req) { return new Response("ok") } }\n',
  });
  const d = await detect(dir);
  assert.equal(d.supabase.configToml, true);
  assert.deepEqual(d.supabase.functions, ['my-func']);
  assert.equal(d.tanstackStart, false);
  const out = await scaffoldPreset('lovable', dir);
  assert.ok(out.notes.some((n) => n.includes('my-func') && n.includes('default { fetch } export')));
  assert.ok(out.configSource.includes('my-func'));
  assert.ok(out.warnings.some((w) => w.includes('index.ts is TypeScript/Deno')));
});

test('presets: lovable with Deno.serve shape reports the interface honestly', async () => {
  const dir = await tempRepo({
    'supabase/functions/greet/index.ts': 'Deno.serve(async (req) => new Response("hi"))\n',
  });
  const out = await scaffoldPreset('lovable', dir);
  assert.ok(out.notes.some((n) => n.includes('Deno.serve()')));
});

test('presets: lovable static export warns clearly (no handlers to attack)', async () => {
  const dir = await tempRepo({ 'index.html': '<html><h1>hi</h1>' });
  const out = await scaffoldPreset('lovable', dir);
  assert.ok(out.warnings.some((w) => w.includes('static-SPA')));
  assert.ok(out.notes.some((n) => n.includes('No supabase/ or TanStack Start markers')));
});

test('presets: lovable TanStack Start marker detected, wired-not-automatable warning', async () => {
  const dir = await tempRepo({ 'src/routeTree.gen.ts': '// generated\n' });
  const out = await scaffoldPreset('lovable', dir);
  assert.ok(out.notes.some((n) => n.includes('TanStack Start detected')));
  assert.ok(out.warnings.some((w) => w.includes('not-yet-automatable') || w.includes('TanStack')));
});

test('presets: replit reads .replit run command; no markers → clean refusal', async () => {
  const withFile = await tempRepo({ '.replit': 'run = "npm run dev"\nentrypoint = "index.jsx"\n' });
  const out = await scaffoldPreset('replit', withFile);
  assert.equal(out.detection.replit.runCommand, 'npm run dev');
  assert.ok(out.warnings.length > 0, 'listening-server caveat is always surfaced');

  const empty = await tempRepo({});
  const out2 = await scaffoldPreset('replit', empty);
  assert.equal(out2.detection.replit.runCommand, null);
  assert.ok(out2.warnings.some((w) => w.includes('No .replit run command')));
  assert.ok(out2.configSource.includes('nothing was guessed') || out2.configSource.includes('Fill config by hand'));
});

test('presets: bolt uses supabase evidence only (no builder-name guess)', async () => {
  const dir = await tempRepo({ 'supabase/functions/edge/index.ts': 'export default { fetch: () => new Response() }\n' });
  const out = await scaffoldPreset('bolt', dir);
  assert.ok(out.notes.some((n) => n.includes('edge')));
  // AND a bolt name without supabase evidence never claims a handler:
  const empty = await tempRepo({});
  const out2 = await scaffoldPreset('bolt', empty);
  assert.ok(out2.warnings.length > 0);
  assert.ok(!out2.configSource.includes('adapters: { node: { handle: yourHandler } }'));
});

test('presets: unknown preset name throws loudly', async () => {
  await assert.rejects(scaffoldPreset('cursor', '/tmp'), /unknown preset "cursor"/);
});

test('presets: invalid package.json gets a loud warning, never silently ignored', async () => {
  const dir = await tempRepo({ 'package.json': '{ nope' });
  const d = await detect(dir);
  assert.equal(d.packageJson.parseFailed, true);
  const out = await scaffoldPreset('replit', dir);
  assert.ok(out.warnings.some((w) => w.includes('not valid JSON')));
});
