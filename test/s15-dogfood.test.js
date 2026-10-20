// S1.5 — dogfood at the CLI level. Spawns the real `crashtest run` against
// the repo fixture (via a generated temp config that imports the fixture by
// absolute file URL) — the same interface a user/agent runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'crashtest.js');

const tempDirs = [];
function tempTarget(variant, config) {
  const dir = mkdtempSync(join(tmpdir(), 'crashtest-dogfood-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'labs'), { recursive: true });
  writeFileSync(
    join(dir, 'crashtest.config.js'), config,
  );
  return dir;
}

const fixtureHref = pathToFileURL(join(REPO_ROOT, 'fixtures', 'demo', 'app.js')).href;
function configFor(variant) {
  return [
    `import { ENV_SPEC, buildRoutes } from ${JSON.stringify(fixtureHref)};`,
    `export default { baseUrl: 'https://dogfood.crashtest.local', env: ENV_SPEC, routes: buildRoutes({ vulnerable: ${variant} }), seed: 0xC0FFEE };`,
  ].join('\n');
}

function runCli(dir) {
  try {
    execFileSync(process.execPath, [BIN, 'run'], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (err) {
    console.error(`crashtest CLI stderr (exit ${err.status}):`, String(err.stderr ?? '').slice(0, 2000));
    return err.status;
  }
}

test('dogfood: hardened fixture — all attacks REFUSED, exit 0, artifacts written', () => {
  const dir = tempTarget(false, configFor(false));
  assert.equal(runCli(dir), 0);
  const ledger = JSON.parse(readFileSync(join(dir, 'labs/crashledger.json'), 'utf8'));
  assert.equal(ledger.schemaVersion, 1);
  // 8 seed attacks + 5 state/volume attacks = 13 total as of v0.2.
  assert.equal(ledger.findings.length, 13, 'every seed attack ran');
  const bad = ledger.findings.filter(f => f.verdict !== 'REFUSED');
  assert.deepEqual(bad, [], bad.map(f => `${f.id}: ${f.detail}`).join(' | '));
  assert.equal(ledger.baseline.length, 13);
  const report = readFileSync(join(dir, 'labs/hardening.md'), 'utf8');
  assert.match(report, /# Hardening report/);
  assert.match(report, /REFUSED \(13\)/);
  assert.match(report, /EXPLOITED \(0\)/);
});

test('dogfood: vulnerable fixture — fresh run trips EXPLOITED, exit 1', () => {
  const dir = tempTarget(true, configFor(true));
  assert.equal(runCli(dir), 1, 'vulnerable app must fail the CI rule');
  const ledger = JSON.parse(readFileSync(join(dir, 'labs/crashledger.json'), 'utf8'));
  const tripped = ledger.findings.filter(f => f.verdict === 'EXPLOITED').map(f => f.id);
  for (const id of ['input/proto-pollution-body', 'auth/identity-spoof-headers', 'guards/hygiene-no-store']) {
    assert.ok(tripped.includes(id), `expected ${id} to be EXPLOITED; got ${tripped.join(', ')}`);
  }
});

test('dogfood: regression gate — hardened baseline catches the vulnerable flip', () => {
  const dir = tempTarget(false, configFor(false));
  assert.equal(runCli(dir), 0);                 // cut baseline against hardened app
  writeFileSync(join(dir, 'crashtest.config.js'), configFor(true));
  assert.equal(runCli(dir), 1, 'REFUSED→EXPLOITED regressions must fail CI');
  const report = readFileSync(join(dir, 'labs/hardening.md'), 'utf8');
  assert.match(report, /REGRESSED: /);
});
