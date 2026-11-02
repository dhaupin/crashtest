// test/release-verify.test.js - the release-verify leg, run OFFLINE on every
// push (the standing receipt the family ladder carries). It exercises the
// SAME script the publish lane's verify job runs on the served tarball, so
// the contents assertions are proven every push instead of living only on
// release days.
//
// Case 1 (positive): npm pack of THIS tree -> the pack ladder -> PASS. The
//   consumer-install half needs the registry; when offline the script prints
//   a NAMED skip - the leg asserts "no silent skip", not "always network".
// Case 2 (negative, fully offline): a doctored tarball carrying a file under
//   a forbidden prefix (labs/) is refused BY NAME, before any install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-release.cjs');
const NOTES = path.join(ROOT, 'scripts', 'release-notes.cjs');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const exportsKeys = Object.keys(pkg.exports).join(',');

function packTree(dest) {
  const r = spawnSync('npm', ['pack', '--pack-destination', dest], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, `npm pack failed: ${r.stderr}`);
  const tgz = path.join(dest, `${pkg.name}-${pkg.version}.tgz`);
  assert.ok(fs.existsSync(tgz), `npm pack produced nothing at ${tgz}`);
  return tgz;
}

test('the pack ladder verifies real npm pack output (contents + identity + bin)', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'release-verify-'));
  const tgz = packTree(work);
  const r = spawnSync('node', [SCRIPT, '--pack', tgz, '--version', pkg.version, '--exports', exportsKeys, '--allowed', 'packs/'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `pack ladder failed (${r.status}):\n${out}`);
  assert.ok(out.includes('PASS forbidden scan'), 'forbidden scan never ran');
  assert.ok(out.includes('PASS served set == npm pack of this tree'), 'expected-set equality never asserted');
  assert.ok(out.includes(`PASS identity: ${pkg.name}@`), 'identity line missing');
  assert.ok(out.includes('PASS exports map held'), 'the exports pin never ran');
  assert.ok(out.includes('PASS installed bin crashtest --version'), 'the installed bin --version probe never passed');
  if (!out.includes('PASS consumer probes')) {
    assert.ok(out.includes('SKIP consumer install'), `no PASS and no named SKIP for the consumer install:\n${out}`);
  }
  fs.rmSync(work, { recursive: true, force: true });
});

test('a doctored tarball is refused BY NAME before any install', () => {
  const toy = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-smuggle-'));
  fs.writeFileSync(path.join(toy, 'package.json'), JSON.stringify({ name: 'crashtest', version: pkg.version, files: ['package.json'] }, null, 2));
  const r = spawnSync('npm', ['pack', '--pack-destination', toy], { cwd: toy, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `toy npm pack failed: ${r.stderr}`);
  const base = path.join(toy, `crashtest-${pkg.version}.tgz`);
  const ex = path.join(toy, 'extracted');
  fs.mkdirSync(ex, { recursive: true });
  assert.equal(spawnSync('tar', ['-xzf', base, '-C', ex], { encoding: 'utf8' }).status, 0);
  fs.mkdirSync(path.join(ex, 'package', 'labs'), { recursive: true });
  fs.writeFileSync(path.join(ex, 'package', 'labs', 'smuggled.txt'), 'must never ship\n');
  const doctored = path.join(toy, 'doctored.tgz');
  assert.equal(spawnSync('tar', ['-czf', doctored, '-C', path.join(ex, 'package'), '.'], { encoding: 'utf8' }).status, 0);
  const rv = spawnSync('node', [SCRIPT, '--pack', doctored, '--version', pkg.version], { cwd: toy, encoding: 'utf8', timeout: 300000 });
  const out = `${rv.stdout}\n${rv.stderr}`;
  assert.equal(rv.status, 1, `the smuggle was not refused (${rv.status}):\n${out}`);
  assert.ok(out.includes('labs/smuggled.txt'), `the refusal does not name the smuggle:\n${out}`);
  fs.rmSync(toy, { recursive: true, force: true });
});

test('release-notes extracts the version section from this repo\'s heading shape', () => {
  // The changelog is Keep-a-Changelog (`## [1.2.0] - date`); the extractor
  // must read that shape (and refuse an absent version).
  const good = spawnSync('node', [NOTES, pkg.version], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(good.status, 0, `release-notes refused the current version: ${good.stderr}`);
  assert.ok(good.stdout.trim().length > 0, 'release-notes produced an empty section');
  const missing = spawnSync('node', [NOTES, '9.9.9'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(missing.status, 1, 'release-notes must refuse a version with no changelog section');
});

// ---- the two bugs the crashtest 1.2.0 live cut surfaced ----------------
// Both were real false negatives in the shared ladder and are pinned here so
// a regression fails the battery instead of the next release.

test('the release target check accepts a branch-name target_commitish (the 1.2.0 cut bug)', () => {
  // GitHub records `target_commitish` as the DEFAULT BRANCH NAME (`main`), not
  // a SHA, when a release is cut from an already-pushed tag. The old check
  // failed on that ("pinpoints main, but the tag resolves to ..."). The fix:
  // only a 40-hex target is a commit claim; a branch name is not drift.
  const r = spawnSync('node', ['-e', `
    const m = require(${JSON.stringify(SCRIPT)});
    const ok = [
      m.releaseTargetMatches('main', 'a'.repeat(40)),
      m.releaseTargetMatches('staging', 'a'.repeat(40)),
      m.releaseTargetMatches('', 'a'.repeat(40)),
      m.releaseTargetMatches('a'.repeat(40), 'a'.repeat(40)),
    ];
    const bad = [
      m.releaseTargetMatches('b'.repeat(40), 'a'.repeat(40)),
    ];
    if (!ok.every(Boolean)) { console.error('a branch-name/absent target was rejected'); process.exit(1); }
    if (bad.some(Boolean)) { console.error('a disagreeing 40-hex target was accepted'); process.exit(1); }
    process.stdout.write('ok');
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `releaseTargetMatches misjudged a target: ${r.stderr}`);
  assert.ok(r.stdout.includes('ok'), 'releaseTargetMatches never ran');
});

test('the registry visibility check waits out propagation lag (the 1.2.0 cut bug)', () => {
  // The read replica lagged the publish: the first read saw latest=1.1.0.
  // registryHasVersion must require BOTH dist-tags.latest == version AND the
  // version entry - a fresh publish is not "visible" until both hold.
  const r = spawnSync('node', ['-e', `
    const m = require(${JSON.stringify(SCRIPT)});
    const v = '1.2.0';
    const lagging = { 'dist-tags': { latest: '1.1.0' }, versions: { '1.1.0': {} } };
    const settled = { 'dist-tags': { latest: v }, versions: { [v]: {}, '1.1.0': {} } };
    const partial = { 'dist-tags': { latest: v }, versions: { '1.1.0': {} } };
    if (m.registryHasVersion(lagging, v)) { console.error('lagging registry judged visible'); process.exit(1); }
    if (m.registryHasVersion(partial, v)) { console.error('version entry absent but judged visible'); process.exit(1); }
    if (!m.registryHasVersion(settled, v)) { console.error('settled registry judged invisible'); process.exit(1); }
    process.stdout.write('ok');
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `registryHasVersion misjudged visibility: ${r.stderr}`);
  assert.ok(r.stdout.includes('ok'), 'registryHasVersion never ran');
});

test('--allowed de-asserts a default-forbidden prefix (vant ships web/ as product)', () => {
  const toy = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-allowed-'))
  fs.writeFileSync(path.join(toy, 'package.json'), JSON.stringify({ name: 'toy-verify', version: '4.2.0', main: 'index.js', files: ['index.js'] }, null, 2))
  fs.writeFileSync(path.join(toy, 'index.js'), 'module.exports = 1\n')
  const r = spawnSync('npm', ['pack', '--pack-destination', toy], { cwd: toy, encoding: 'utf8', timeout: 120000 })
  assert.equal(r.status, 0, `toy npm pack failed: ${r.stderr}`)
  const ex = path.join(toy, 'extracted')
  fs.mkdirSync(ex, { recursive: true })
  assert.equal(spawnSync('tar', ['-xzf', path.join(toy, 'toy-verify-4.2.0.tgz'), '-C', ex], { encoding: 'utf8' }).status, 0)
  fs.mkdirSync(path.join(ex, 'package', 'web'), { recursive: true })
  fs.writeFileSync(path.join(ex, 'package', 'web', 'app.js'), '// ships as product\n')
  const doctored = path.join(toy, 'doctored.tgz')
  assert.equal(spawnSync('tar', ['-czf', doctored, '-C', path.join(ex, 'package'), '.'], { encoding: 'utf8' }).status, 0)
  const without = spawnSync('node', [SCRIPT, '--pack', doctored, '--version', '4.2.0'], { cwd: toy, encoding: 'utf8', timeout: 300000 })
  assert.equal(without.status, 1, 'web/ must be refused without the flag')
  assert.ok(`${without.stdout}\n${without.stderr}`.includes('forbidden path prefix web/'), 'the default refusal names web/')
  const withFlag = spawnSync('node', [SCRIPT, '--pack', doctored, '--version', '4.2.0', '--allowed', 'web/'], { cwd: toy, encoding: 'utf8', timeout: 300000 })
  const out = `${withFlag.stdout}\n${withFlag.stderr}`
  assert.ok(out.includes('PASS forbidden scan'), `--allowed did not clear the forbidden scan:\n${out}`)
  assert.ok(!out.includes('forbidden path prefix web/'), '--allowed left web/ forbidden')
  fs.rmSync(toy, { recursive: true, force: true })
})
