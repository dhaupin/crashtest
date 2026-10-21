// Packaging probe (audit item #2): the npm tarball must ship the reusable
// shape packs so the documented `packs: ['node_modules/crashtest/packs']`
// adoption shape is real, and must NOT ship the repo-bound crashtest-site
// self-dogfood pack (it attacks the OSS repo's own checkout - shipping it
// vendored would be a footgun). Also pins the minimal publish surface.
//
// Zero-runtime-deps rule untouched: this probe shells the LOCAL npm (a
// dev-only tool) with --dry-run; nothing is downloaded or packed to disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

function dryRunFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return parsed.flatMap((pkg) => pkg.files.map((f) => f.path));
}

const files = dryRunFiles();

test('tarball ships the reusable shape packs (adoption shapes stay real)', () => {
  for (const pack of ['wp-money-shapes', 'wp-stock-smoke']) {
    assert.ok(
      files.includes(`packs/public/${pack}/pack.json`),
      `packs/public/${pack} must ship in the npm tarball`,
    );
  }
  // The shipped packs' scenario modules ride along (a manifest without its
  // entry would be a silently broken surface).
  assert.ok(files.includes('packs/public/wp-stock-smoke/index.js'), 'shipped packs carry their entry modules');
});

test('tarball does NOT ship repo-bound packs (crashtest-site is self-dogfood only)', () => {
  const leaked = files.filter((f) => f.startsWith('packs/public/crashtest-site'));
  assert.deepEqual(leaked, [], 'crashtest-site reads web/ from the OSS repo checkout - vendoring it blinds the pack');
});

test('tarball carries the publish surface: bin, full CLI src, harness, libraries', () => {
  for (const needed of ['bin/crashtest.js', 'src/cli.js', 'src/harness/harness.js', 'src/scenarios/contract.js']) {
    assert.ok(files.includes(needed), `${needed} must ship`);
  }
  for (const lib of ['input', 'auth', 'guards', 'state', 'volume']) {
    assert.ok(files.includes(`src/scenarios/library/${lib}.js`), `seed library ${lib} must ship`);
  }
});
