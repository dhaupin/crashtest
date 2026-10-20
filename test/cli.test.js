import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, LEDGER_PATH, REPORT_PATH, VERSION } from '../src/cli.js';

// chdir wrapper: main() targets the CWD (the repo being attacked), so tests
// swap into a temp dir and restore afterwards. node:test asyncs the callback;
// do it synchronously in try/finally to guarantee the restore.
async function inRepo(name, fn) {
  const dir = await mkdtemp(join(tmpdir(), `crashtest-${name}-`));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prev);
  }
}

test('version prints VERSION', async () => {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await main(['--version']);
  } finally {
    console.log = orig;
  }
  assert.match(out.join('\n'), new RegExp(`crashtest v${VERSION.replace(/\./g, '\\.')}`));
});

test('init writes ledger + report with the v1 schema', async () => {
  await inRepo('init', async () => {
    await main(['init']);
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.equal(ledger.schemaVersion, 1);
    assert.equal(ledger.crashtestVersion, VERSION);
    assert.deepEqual(ledger.findings, []);
    assert.deepEqual(ledger.acceptedRisks, []);
    assert.deepEqual(ledger.baseline, []);
    const report = await readFile(REPORT_PATH, 'utf8');
    assert.match(report, /# Hardening report/);
    assert.match(report, /ledger is empty/);
  });
});

test('init refuses to overwrite without --force', async () => {
  await inRepo('init-force', async () => {
    await main(['init']);
    // First init succeeded; second without --force must fail and not rewrite.
    await main(['init']);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0; // restore for later tests
    // Confirm ledger untouched (still version-1 shape from the first write).
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.equal(ledger.schemaVersion, 1);
  });
});

test('init --force overwrites existing labs', async () => {
  await inRepo('force', async () => {
    await main(['init']);
    await writeFile(REPORT_PATH, 'tampered');
    await main(['init', '--force']);
    const report = await readFile(REPORT_PATH, 'utf8');
    assert.match(report, /# Hardening report/);
  });
});

test('run is an honest pending placeholder (exit 2), never silently succeeds', async () => {
  await inRepo('run', async () => {
    await main(['run']);
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
  });
});

test('unknown verb exits 1', async () => {
  await inRepo('badverb', async () => {
    await main(['explode']);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });
});

test('no exceptions escape main() for empty argv (prints help)', async () => {
  await inRepo('empty', async () => {
    await main([]);
    process.exitCode = undefined; // help path must not have failed
  });
});
