// check-prestruct-pins.test.js - the prestruct pin guard's own battery.
//
// Both ways, per the house rule: a below-floor or floating declaration must
// fail, a compliant one must pass. Temp dirs, no network - the guard is spawned
// as a subprocess over a fixture repo so the exit code is what CI sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-prestruct-pins.cjs');

function runGuard(pkg, lock = null, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prestruct-pins-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  if (lock) writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2));
  for (const [rel, body] of Object.entries(extra)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(body, null, 2));
  }
  const res = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return res;
}

test('a ^1.3.0 declaration passes', () => {
  const res = runGuard({ devDependencies: { prestruct: '^1.3.0' } });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /PASS/);
});

test('a below-floor ^1.0.0 declaration fails', () => {
  const res = runGuard({ devDependencies: { prestruct: '^1.0.0' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /below the family floor/);
});

test('the old floor ^1.2.0 now fails (the floor moved to ^1.3.0)', () => {
  const res = runGuard({ devDependencies: { prestruct: '^1.2.0' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /below the family floor/);
});

test('an exact 1.1.0 declaration fails', () => {
  const res = runGuard({ devDependencies: { prestruct: '1.1.0' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /below the family floor/);
});

test('a bare github commit spec fails (not a managed semver pin)', () => {
  const res = runGuard({ devDependencies: { prestruct: 'github:dhaupin/prestruct#498ab5f' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not a semver pin/);
});

test('a dependency (not devDependency) declaration is scanned too', () => {
  const res = runGuard({ dependencies: { prestruct: '^1.0.0' } });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /below the family floor/);
});

test('a nested web/package.json is scanned', () => {
  const res = runGuard({ name: 'root' }, null, {
    'web/package.json': { devDependencies: { prestruct: '^1.0.0' } },
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /web\/package\.json/);
});

test('a fixed spec with a stale below-floor lockfile fails', () => {
  const res = runGuard(
    { devDependencies: { prestruct: '^1.3.0' } },
    { packages: { 'node_modules/prestruct': { version: '1.1.0' } } },
  );
  assert.equal(res.status, 1);
  assert.match(res.stderr, /resolves prestruct 1\.1\.0/);
});

test('a fixed spec with a floor-or-above lockfile passes', () => {
  const res = runGuard(
    { devDependencies: { prestruct: '^1.3.0' } },
    { packages: { 'node_modules/prestruct': { version: '1.3.0' } } },
  );
  assert.equal(res.status, 0, res.stderr);
});

test('a repo with no prestruct declaration is a clean pass', () => {
  const res = runGuard({ devDependencies: { vite: '^6.0.0' } });
  assert.equal(res.status, 0, res.stderr);
});

test('the repo itself is at or above the family floor', () => {
  const res = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /PRESTRUCT PINS: PASS/);
});
