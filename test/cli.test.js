import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';import { main, LEDGER_PATH, REPORT_PATH, VERSION } from '../src/cli.js';

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

test('run --json appends the machine run blob as the LAST stdout line (PRD §14)', async () => {
  await inRepo('run-json', async () => {
    // Minimal in-process target: one burst route the guards library can hit;
    // every other library's routes stay undeclared (skip-parity rows).
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--json']);
    } finally {
      console.log = orig;
    }
    // The machine contract: the last stdout line IS the run blob, parseable
    // by the dashboard bridge (web/src/lib/ledgerModel.js run shape).
    const blob = JSON.parse(out.at(-1));
    assert.ok(Array.isArray(blob.rows) && blob.rows.length > 0);
    assert.ok(blob.tally && blob.cost?.totals && blob.startedAt);
    assert.ok(blob.rows.every((r) => ['REFUSED', 'EXPLOITED', 'BOUNDED'].includes(r.verdict)));
    // And the ledger itself still lands as the v1 artifact.
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.equal(ledger.schemaVersion, 1);
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

// --- thread A: `run --expect-baseline <path>` (PRD §14 read-only mode) ------

test('run --expect-baseline diffs a given ledger without touching labs/ (missing → exit 2)', async () => {
  await inRepo('expect-missing', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--expect-baseline', 'external/ledger.json']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join('\n'), /--expect-baseline: no ledger at external\/ledger\.json/);
    process.exitCode = 0;
  });
});

test('run --expect-baseline: read-only diff, exit rules unchanged, labs/ untouched', async () => {
  await inRepo('expect-readonly', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    // External baseline: schema-1 shape with every library attack REFUSED so
    // the live run (which carries skip-parity rows for undeclared routes)
    // diffs clean against it.
    await mkdir('external', { recursive: true });
    await writeFile('external/ledger.json', JSON.stringify({
      schemaVersion: 1,
      findings: [],
      acceptedRisks: [],
      baseline: ['auth/identity-spoof-headers', 'auth/secret-watermark', 'auth/privilege-escalation', 'guards/hygiene-no-store', 'guards/burst-wall', 'input/proto-pollution-body', 'input/never-fail-mutations', 'input/oversized-field', 'state/enumeration-oracle', 'state/id-collision-alias', 'volume/credential-stuffing', 'volume/storage-fill', 'volume/cost-amplification'],
    }));
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--expect-baseline', 'external/ledger.json']);
    } finally {
      console.log = orig;
    }
    const consoleOut = out.join('\n');
    assert.match(consoleOut, /read-only diff against external\/ledger\.json · labs\/ untouched/);
    // Exit rule (§7) unchanged: clean diff → exit 0.
    assert.equal(process.exitCode, 0);
    // labs/ untouched: no ledger, no report, no labs dir at all.
    let labsExists = false;
    try { await access('labs'); labsExists = true; } catch { /* want false */ }
    assert.equal(labsExists, false);
    // The external baseline must NOT be rewritten by the run.
    const before = await readFile('external/ledger.json', 'utf8');
    await main(['run', '--json', '--expect-baseline', 'external/ledger.json']);
    const after = await readFile('external/ledger.json', 'utf8');
    assert.equal(after, before);
    process.exitCode = 0;
  });
});

test('run --expect-baseline enforces the §7 gate: a REFUSED→EXPLOITED regression fails', async () => {
  await inRepo('expect-regression', async () => {
    // The vulnerable-route draft of the demo target deliberately regresses
    // guards/hygiene-no-store (a surviving 2xx write rows EXPLOITED).
    await writeFile('crashtest.config.js',
      "import { app } from 'crashtest/fixtures/demo/app.js';" +
      "\n" +
      "export default { routes: { burst: async () => new Response('raw', { status: 200 }) }, seed: 7 };\n");
    // Simpler, deterministic regression: an unconstrained 200-er on a named
    // burst route flips guards/hygiene-no-store only when it is a *write* —
    // so instead drive the EXPLOITED branch directly via the lite target:
    // a leaky-secrets route! Define a route echoing a planted secret; the
    // auth/secret-watermark attack must then EXPLOIT it against any baseline
    // that carries the watermark id in `baseline` (was REFUSED before).
    await mkdir('ext', { recursive: true });
    await writeFile('ext/ledger.json', JSON.stringify({
      schemaVersion: 1,
      findings: [],
      acceptedRisks: [],
      baseline: ['auth/identity-spoof-headers', 'auth/secret-watermark', 'auth/privilege-escalation', 'guards/hygiene-no-store', 'guards/burst-wall', 'input/proto-pollution-body', 'input/never-fail-mutations', 'input/oversized-field', 'state/enumeration-oracle', 'state/id-collision-alias', 'volume/credential-stuffing', 'volume/storage-fill', 'volume/cost-amplification'],
    }));
    await writeFile('crashtest.config.js',
      "export default {" +
      "\n" +
      "  routes: {" +
      "\n" +
      "    // leaky + unhydrated on purpose: a surviving 2xx write with NO explicit" +
      "\n" + "    // Cache-Control — guards/hygiene-no-store EXPLOITS this deterministically," +
      "\n" + "    // and the baseline carries its id as previously-REFUSED → §7 gate trips." +
      "\n" + "    enroll: async (ctx) => new Response(JSON.stringify({ secret: ctx.env?.secrets?.CRASHTEST_SECRET ?? null }))," +
      "\n  }," +
      "\n" +
      "  env: { secrets: { CRASHTEST_SECRET: 'ct-fake-secret' } }," +
      "\n" + "  seed: 7,\n" +
      "};\n");
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--expect-baseline', 'ext/ledger.json']);
    } finally {
      console.log = orig;
    }
    // The gate MUST fail on a REFUSED→EXPLOITED regression even in read-only mode.
    assert.equal(process.exitCode, 1, out.join('\n'));
    process.exitCode = 0;
  });
});

test('run --expect-baseline rejects a non-ledger JSON loudly (exit 2, schema-1 contract)', async () => {
  await inRepo('expect-badjson', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    await mkdir('ext', { recursive: true });
    await writeFile('ext/bad.json', JSON.stringify({ hello: 'not a ledger' }));
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--expect-baseline', 'ext/bad.json']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join('\n'), /not a schema-1 ledger/);
    process.exitCode = 0;
  });
});
