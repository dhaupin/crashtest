// check-catalog-sync.test.js - the catalog guard's own battery (crashtest#82).
//
// Both ways, per the house rule: a catalog missing a shipped row/pack must
// fail (naming it), and the real, complete catalog must pass. The fixture is a
// real copy of the repo's own sources (src/ + packs/) plus the real catalog
// surfaces, so the guard runs over genuine loader output - then one surface is
// mutated to plant the exact drift. No network; temp dirs, removed after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(REPO_ROOT, 'scripts', 'check-catalog-sync.cjs');

const COPY = ['src', 'packs'];
const CATALOG = ['docs/reference/attacks.md', 'docs/reference/packs.md', 'web/src/pages/Attacks.jsx'];

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'catalog-sync-'));
  for (const rel of COPY) cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: true });
  for (const rel of CATALOG) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO_ROOT, rel), dest);
  }
  return root;
}

function runGuard(root) {
  return spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
}

test('the real catalog passes (every shipped row and pack is catalogued)', () => {
  const root = fixtureRoot();
  try {
    const res = runGuard(root);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /CATALOG SYNC: PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a library row missing from the web page fails, naming the row', () => {
  const root = fixtureRoot();
  try {
    const page = join(root, 'web/src/pages/Attacks.jsx');
    writeFileSync(page, readFileSync(page, 'utf8').replace("['privilege-escalation',", "['x-removed',"));
    const res = runGuard(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /privilege-escalation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a library row missing from the docs catalog fails on the row count', () => {
  const root = fixtureRoot();
  try {
    const md = join(root, 'docs/reference/attacks.md');
    const body = readFileSync(md, 'utf8').replace(/^\| `privilege-escalation` \|.*$/m, '');
    writeFileSync(md, body);
    const res = runGuard(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /catalog row\(s\) vs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stale pack entry on the page fails (drift in the other direction)', () => {
  const root = fixtureRoot();
  try {
    const page = join(root, 'web/src/pages/Attacks.jsx');
    writeFileSync(page, readFileSync(page, 'utf8').replace("dir: 'cve-feed', attacks: 2", "dir: 'cve-feed', attacks: 99"));
    const res = runGuard(root);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /cve-feed.*99.*2|cve-feed.*ships 2/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
