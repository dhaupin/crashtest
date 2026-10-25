// Packaging probe (audit item #2 + issue #34): the npm tarball must ship the
// reusable shape packs so the documented `packs: ['node_modules/crashtest/packs']`
// adoption shape is real, and must NOT ship the repo-bound crashtest-site
// self-dogfood pack (it attacks the OSS repo's own checkout - shipping it
// vendored would be a footgun). Also pins the minimal publish surface, and
// (issue #34) must ship the WP adapter's worker so an npm install can boot.
//
// Zero-runtime-deps rule untouched: this probe shells the LOCAL npm (a
// dev-only tool) -- a --dry-run file census plus one REAL pack + local file
// install into a temp project (crashtest is zero-runtime-deps, so the
// install touches no registry) -- nothing is downloaded, nothing persists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
  for (const pack of ['wp-money-shapes', 'wp-stock-smoke', 'wp-roles', 'cve-feed', 'qs-shapes', 'vite-dev-shapes', 'next-middleware-shapes']) {
    assert.ok(
      files.includes(`packs/public/${pack}/pack.json`),
      `packs/public/${pack} must ship in the npm tarball`,
    );
  }
  // The shipped packs' scenario modules ride along (a manifest without its
  // entry would be a silently broken surface).
  assert.ok(files.includes('packs/public/wp-stock-smoke/index.js'), 'shipped packs carry their entry modules');
  assert.ok(files.includes('packs/public/wp-roles/index.js'), 'wp-roles ships its entry module (experimental, PRD section 10)');
  assert.ok(files.includes('packs/public/cve-feed/index.js'), 'cve-feed ships its entry module (extended sources)');
  assert.ok(files.includes('packs/public/cve-feed/snapshot.json'), 'cve-feed ships its committed offline snapshot');
  assert.ok(files.includes('packs/public/qs-shapes/index.js'), 'qs-shapes ships its entry module (bracket-notation parser shapes)');
  assert.ok(files.includes('packs/public/vite-dev-shapes/index.js'), 'vite-dev-shapes ships its entry module (dev-server fs wire)');
  assert.ok(files.includes('packs/public/next-middleware-shapes/index.js'), 'next-middleware-shapes ships its entry module (middleware subrequest wire)');
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

test('tarball ships the WP adapter worker + stub so npm installs boot (issue #34)', () => {
  assert.ok(
    files.includes('fixtures/wordpress/wp-worker.php'),
    'fixtures/wordpress must ship - src/adapters/wordpress.js resolves its WORKER_DEFAULT there and npm installs cannot fall back to a checkout',
  );
  assert.ok(
    files.includes('fixtures/wordpress/stub-wp/wp-load.php'),
    'stub-wp must ship so a fresh npm install is an honest zero-config WP run root, not a hole',
  );
  assert.ok(
    !files.some((f) => f.startsWith('fixtures/') && !f.startsWith('fixtures/wordpress/')),
    `only the WP adapter subset ships from fixtures/ (leaked: ${files.filter((f) => f.startsWith('fixtures/') && !f.startsWith('fixtures/wordpress/')).join(', ')})`,
  );
});

test('install smoke: the REAL tarball installs clean and its WP worker is on disk (issue #34)', () => {
  const work = mkdtempSync(join(tmpdir(), 'crashtest-pack-smoke-'));
  try {
    const tgz = execFileSync('npm', ['pack', '--pack-destination', work], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    }).trim().split('\n').pop();
    const smokeDir = join(work, 'smoke');
    mkdirSync(smokeDir);
    writeFileSync(
      join(smokeDir, 'package.json'),
      JSON.stringify({ name: 'crashtest-pack-smoke', version: '1.0.0', private: true }, null, 2) + '\n',
    );
    execFileSync('npm', ['install', join(work, tgz), '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: smokeDir, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    const installed = join(smokeDir, 'node_modules', 'crashtest');
    for (const needed of ['src/adapters/wordpress.js', 'fixtures/wordpress/wp-worker.php', 'fixtures/wordpress/stub-wp/wp-load.php']) {
      assert.ok(existsSync(join(installed, ...needed.split('/'))), `${needed} must exist under node_modules/crashtest after installing the real tarball`);
    }
    // proven where it counts: the packaged tree's own WORKER_DEFAULT target
  } finally {
    try { rmSync(work, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
});
