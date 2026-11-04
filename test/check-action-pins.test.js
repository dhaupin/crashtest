// check-action-pins.test.js - the pin guard's own battery (packstruct#69).
//
// Both ways, per the house rule: a floating ref must fail, a pinned ref must
// pass. Temp dirs, no network - the guard is spawned as a subprocess over a
// fixture workflows dir so the exit code is what CI sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-action-pins.cjs');

const SHA = '11d5960a326750d5838078e36cf38b85af677262';

function runGuard(files) {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'));
  const wf = join(dir, 'workflows');
  mkdirSync(wf, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(wf, name), body);
  }
  const res = spawnSync(process.execPath, [GUARD, wf], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return res;
}

test('a SHA-pinned ref with a tag comment passes', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v4\n` });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /PASS/);
});

test('a floating @vN ref fails', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n` });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /floating ref/);
});

test('a floating branch ref (ruby/setup-ruby@v1) fails', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: ruby/setup-ruby@v1\n` });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /floating ref/);
});

test('a docker:// image ref fails (an unpinned image is the same float)', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: docker://alpine:3\n` });
  assert.equal(res.status, 1);
});

test('a local action (./path) is not required to be pinned', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: ./.github/actions/setup\n` });
  assert.equal(res.status, 0, res.stderr);
});

test('a pinned ref with no tag comment passes but is flagged as a note', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA}\n` });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /note:/);
});

test('a quoted uses value is unwrapped before the shape check', () => {
  const res = runGuard({ 'ci.yml': `jobs:\n  a:\n    steps:\n      - uses: "actions/checkout@v4"\n` });
  assert.equal(res.status, 1);
});

test('the repo itself is fully SHA-pinned', () => {
  const res = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /all SHA-pinned/);
});

test('the action.yml leg scans the composite Action manifest too (a float there fails)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pins-'));
  const wf = join(dir, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'ci.yml'), `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA} # v4\n`);
  writeFileSync(join(dir, 'action.yml'), `runs:\n  using: 'composite'\n  steps:\n    - uses: actions/setup-node@v6\n`);
  const res = spawnSync(process.execPath, [GUARD, wf], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /action\.yml.*floating ref/);
});
