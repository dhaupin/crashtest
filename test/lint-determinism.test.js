// Determinism linter (issue #13 crate-tooling blocker 3): the flat grep over
// the DECLARED sources for wall-clock / unseeded-randomness tokens. Pins:
// exact file:line findings, bounded walk, the verb's exit contract (0 flat /
// 2 findings), and the `run --lint-determinism` pre-flight shape (no
// campaign artifacts written).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSourceFiles, lintDeterminism } from '../src/lint.js';
import { main } from '../src/cli.js';

async function withCwd(root, fn) {
  const prev = process.cwd();
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  process.chdir(root);
  try {
    await fn();
  } finally {
    console.log = orig;
    process.chdir(prev);
  }
  return out.join('\n');
}

test('lintDeterminism: exact file:line findings for the wall-clock / randomness token family', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lint-det-'));
  const dirty = join(root, 'dirty.js');
  await writeFile(dirty, [
    'const at = Date.now();',
    "const stamp = new Date('2026-01-01');",
    'const roll = Math.random();',
    'const clean = 42;',
  ].join('\n') + '\n');
  await writeFile(join(root, 'clean.js'), 'export const x = 1;\n');
  const findings = await lintDeterminism([join(root, 'clean.js'), dirty]);
  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map((f) => [f.file.split('/').pop(), f.line, f.token]), [
    ['dirty.js', 1, 'Date.now'],
    ['dirty.js', 2, 'new Date('],
    ['dirty.js', 3, 'Math.random'],
  ]);
  assert.match(findings[0].why, /same-commit -> same-findings/);
});

test('collectSourceFiles: bounded walk, skips node_modules/.git and *.test.js, sorted output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lint-walk-'));
  await mkdir(join(root, 'node_modules', 'junk'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'junk', 'x.js'), 'Date.now()\n');
  await mkdir(join(root, 'packs', 'public', 'p'), { recursive: true });
  await writeFile(join(root, 'packs', 'public', 'p', 'index.js'), 'export default {};\n');
  await writeFile(join(root, 'packs', 'public', 'p', 'index.test.js'), 'Date.now()\n');
  await writeFile(join(root, 'packs', 'public', 'p', 'extra.mjs'), 'export {};\n');
  const files = await collectSourceFiles([root]);
  assert.deepEqual(files.map((f) => f.slice(root.length + 1)), [
    join('packs', 'public', 'p', 'extra.mjs'),
    join('packs', 'public', 'p', 'index.js'),
  ]);
});

test('CLI: crashtest lint-determinism exits 0 when flat and 2 with every file:line named', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lint-cli-'));
  await mkdir(join(root, 'packs', 'public', 'probe'), { recursive: true });
  await writeFile(join(root, 'packs', 'public', 'probe', 'index.js'),
    "export default { name: 'probe', description: 'd', attacks: [{ name: 'a', run() { return { verdict: 'REFUSED', detail: 'clean' }; } }] };\n");
  const flat = await withCwd(root, async () => { process.exitCode = undefined; await main(['lint-determinism']); });
  assert.equal(process.exitCode, undefined, 'flat surface exits clean');
  assert.match(flat, /determinism lint: 1 source file\(s\) scanned - flat/);

  // make it dirty: the same surface now carries a wall-clock read
  await writeFile(join(root, 'packs', 'public', 'probe', 'index.js'),
    "export default { name: 'probe', description: 'd', attacks: [{ name: 'a', run() { return { verdict: 'REFUSED', detail: String(Date.now()) }; } }] };\n");
  const out = await withCwd(root, async () => { process.exitCode = undefined; await main(['lint-determinism', 'packs']); });
  assert.equal(process.exitCode, 2, 'findings are a config-class failure (exit 2)');
  assert.match(out, /packs\/public\/probe\/index\.js:1: Date\.now/);
  assert.match(out, /derive from ctx\.seed instead/);
  process.exitCode = undefined;
});

test('CLI: run --lint-determinism is a pre-flight - no campaign, no artifacts written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lint-preflight-'));
  await mkdir(join(root, 'labs', 'scenarios'), { recursive: true });
  await writeFile(join(root, 'labs', 'scenarios', 'sneaky.js'),
    "export default { name: 'sneaky', description: 'd', attacks: [{ name: 'a', run() { return { verdict: 'REFUSED', detail: String(Math.random()) }; } }] };\n");
  await writeFile(join(root, 'crashtest.config.js'), 'export default { routes: {} };\n');
  const out = await withCwd(root, async () => { process.exitCode = undefined; await main(['run', '--lint-determinism']); });
  assert.equal(process.exitCode, 2);
  assert.match(out, /labs\/scenarios\/sneaky\.js:1: Math\.random/);
  // the pre-flight wrote nothing - labs/ holds the scenario, never a ledger
  await assert.rejects(readFile(join(root, 'labs', 'crashledger.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, 'labs', 'hardening.md')), { code: 'ENOENT' });
  process.exitCode = undefined;
});

test('CLI: --config scenarioDirs join the scan; explicit dirs override the defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lint-cfg-'));
  await mkdir(join(root, 'attackers'), { recursive: true });
  await writeFile(join(root, 'attackers', 'a.js'), 'const t = Date.now();\n');
  await writeFile(join(root, 'crashtest.config.js'),
    "export default { scenarioDirs: ['attackers'], packs: false };\n");
  const out = await withCwd(root, async () => { process.exitCode = undefined; await main(['lint-determinism', '--config', 'crashtest.config.js']); });
  assert.equal(process.exitCode, 2);
  assert.match(out, /attackers\/a\.js:1: Date\.now/);
  process.exitCode = undefined;
});
