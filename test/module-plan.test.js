// Coverage plan (PRD section 14 `run --module-plan`) - the dry-run inventory tests.
// Pins the three statuses, the arming-key duality (module export > pack
// manifest), filter parity with the runner's Set(opts.modules), and the
// `--json` last-line discipline shared with `run --json`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModulePlan } from '../src/plans.js';
import { main } from '../src/cli.js';

const ENTRY = (name, extra = '') =>
  `export default { name: '${name}', description: 'probe module',${extra ? ' ' + extra + ',' : ''} attacks: [{ name: 'probe-attack', description: 'probe', async run() { return { verdict: 'REFUSED', detail: 'held' }; } }] };\n`;

async function mkModule(dir, name, extra = '') {
  const file = join(dir, `${name}.js`);
  await writeFile(file, ENTRY(name, extra));
  return file;
}

test('buildModulePlan: will-fire by default, arming detected via pack manifest armedByKey', () => {
  const plan = buildModulePlan(
    {},
    [{ origin: 'public/wp-money-shapes', visibility: 'public', manifest: { name: 'wp-money-shapes', version: '0.3.0', armedByKey: 'wp-money-shapes' }, module: { name: 'wp-money-shapes', attacks: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } }],
    [
      { origin: 'library/auth.js', module: { name: 'auth', attacks: [{ name: 'x' }] } },
      { origin: 'public/wp-money-shapes/index.js', module: { name: 'wp-money-shapes', attacks: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } },
    ],
  );
  const auth = plan.modules.find((m) => m.name === 'auth');
  const wpm = plan.modules.find((m) => m.name === 'wp-money-shapes');
  assert.equal(auth.status, 'WILL-FIRE');
  assert.equal(wpm.status, 'NEEDS-ARMING');
  assert.match(wpm.reason, /moduleCtx\['wp-money-shapes'\]/);
  assert.deepEqual(plan.totals, { attacks: 4, willFire: 1, needsArming: 3, skippedFilter: 0 });
  // The arming rule must reach every attack id, not just the module summary.
  assert.ok(wpm.attacks.every((a) => a.status === 'NEEDS-ARMING' && a.id.startsWith('wp-money-shapes/')));
});

test('buildModulePlan: a target moduleCtx with the key arms the pack; module-level export outranks the manifest', () => {
  const pack = [{ origin: 'public/p', visibility: 'public', manifest: { name: 'p', armedByKey: 'p' }, module: { name: 'p', attacks: [{ name: 'a' }] } }];
  const armed = buildModulePlan({ moduleCtx: { p: { route: 'enroll' } } }, pack, [{ origin: 'public/p/index.js', module: { name: 'p', attacks: [{ name: 'a' }] } }]);
  assert.equal(armed.modules[0].status, 'WILL-FIRE');
  // A module that carries its own armedByKey overrides the manifest - and an
  // explicit null disables arming detection entirely.
  const overridden = buildModulePlan({}, pack, [{ origin: 'public/p/index.js', module: { name: 'p', armedByKey: null, attacks: [{ name: 'a' }] } }]);
  assert.equal(overridden.modules[0].status, 'WILL-FIRE');
});

test('buildModulePlan: filter rows mirror the runner Set(opts.modules) exactly', () => {
  const scenarios = [
    { origin: 'library/auth.js', module: { name: 'auth', attacks: [{ name: 'a' }, { name: 'b' }] } },
    { origin: 'library/input.js', module: { name: 'input', attacks: [{ name: 'c' }] } },
  ];
  const plan = buildModulePlan({ modules: ['auth', 'input'] }, [], scenarios);
  assert.ok(plan.modules.every((m) => m.status === 'WILL-FIRE'));
  const narrowed = buildModulePlan({ modules: ['auth'] }, [], scenarios);
  const input = narrowed.modules.find((m) => m.name === 'input');
  assert.equal(input.status, 'SKIPPED-FILTER');
  assert.match(input.reason, /modules filter/);
  assert.deepEqual(narrowed.totals, { attacks: 3, willFire: 2, needsArming: 0, skippedFilter: 1 });
});

test('buildModulePlan: shape carries the packs inventory (package field passes through)', () => {
  const plan = buildModulePlan(
    {},
    [{ origin: 'public/p', visibility: 'public', manifest: { name: 'p', version: '1.2.3', package: '@you/pack', armedByKey: null }, module: { name: 'p', attacks: [{ name: 'a' }] } }],
    [{ origin: 'public/p/index.js', module: { name: 'p', attacks: [{ name: 'a' }] } }],
  );
  assert.deepEqual(plan.packs, [{ name: 'p', visibility: 'public', version: '1.2.3', origin: 'public/p', attacks: 1, armedByKey: null, package: '@you/pack', prerequisites: [] }]);
});

async function tmpRoot() {
  const root = await mkdtemp(join(tmpdir(), 'ct-plan-'));
  await mkdir(join(root, 'packs', 'public', 'armed-pack'), { recursive: true });
  await writeFile(join(root, 'packs', 'public', 'armed-pack', 'pack.json'), JSON.stringify({ schemaVersion: 1, name: 'armed-pack', description: 'probe', entry: 'index.js', armedByKey: 'armed-pack' }) + '\n');
  await writeFile(join(root, 'packs', 'public', 'armed-pack', 'index.js'), ENTRY('armed-pack'));
  await mkdir(join(root, 'labs', 'scenarios'), { recursive: true });
  await mkModule(join(root, 'labs', 'scenarios'), 'loose-attacks');
  return root;
}

test('CLI: run --module-plan is a true dry-run - verdicts print, nothing executes, exit 0', async () => {
  const root = await tmpRoot();
  await writeFile(join(root, 'crashtest.config.js'), "export default { modules: ['loose-attacks', 'armed-pack'], moduleCtx: { 'armed-pack': { vocab: true } } };\n");
  const prev = process.cwd();
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await main(['run', '--module-plan']);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  const text = out.join('\n');
  assert.equal(process.exitCode, undefined);
  assert.match(text, /loose-attacks.*WILL-FIRE/);
  assert.match(text, /armed-pack.*WILL-FIRE/);
  // Built-in library modules always load (the loader ships them) and land
  // SKIPPED-FILTER under this config - the totals must count them honestly.
  assert.match(text, /2 WILL-FIRE \/ 0 NEEDS-ARMING \/ \d+ SKIPPED-FILTER/);
});

test('CLI: run --module-plan --json prints the plan blob as the LAST line', async () => {
  const root = await tmpRoot();
  await writeFile(join(root, 'crashtest.config.js'), "export default { modules: ['armed-pack'] };\n"); // pack loaded, filter excludes loose
  const prev = process.cwd();
  let out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await main(['run', '--module-plan', '--json']);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  const lastLine = out[out.length - 1];
  const plan = JSON.parse(lastLine);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.totals.skippedFilter, 50); // 49 built-in library attacks (14 modules) + loose-attacks, all outside the filter
  const armed = plan.modules.find((m) => m.name === 'armed-pack');
  // The filter keeps the pack in the inventory, but nothing arms it - the
  // JSON view must say NEEDS-ARMING just like the human lines (test below).
  assert.equal(armed.status, 'NEEDS-ARMING');
});

test('CLI: run --module-plan reports NEEDS-ARMING when the filter keeps an un-armed pack', async () => {
  const root = await tmpRoot();
  await writeFile(join(root, 'crashtest.config.js'), "export default { modules: ['armed-pack'] };\n");
  const prev = process.cwd();
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await main(['run', '--module-plan']);
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  const text = out.join('\n');
  assert.match(text, /armed-pack.*NEEDS-ARMING/);
  assert.match(text, /moduleCtx\['armed-pack'\]/);
  process.exitCode = undefined;
});
