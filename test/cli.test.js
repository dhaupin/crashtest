import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';import { main, LEDGER_PATH, REPORT_PATH, META_PATH, VERSION } from '../src/cli.js';

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
  assert.equal(out.join('\n').trim(), VERSION);
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

test('determinism double-run: consecutive runs are byte-identical in ledger + report; the wall clock lives in the sidecar only', async () => {
  await inRepo('double-run', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    await main(['run']);
    process.exitCode = 0;
    const ledger1 = await readFile(LEDGER_PATH, 'utf8');
    const report1 = await readFile(REPORT_PATH, 'utf8');
    const stamp1 = JSON.parse(await readFile(META_PATH, 'utf8'));
    assert.ok(stamp1.generatedAt && /^\d{4}-\d{2}-\d{2}T/.test(stamp1.generatedAt), 'sidecar carries the wall clock');
    assert.equal(stamp1.seed, 7, 'sidecar records the cut seed');
    assert.equal(JSON.parse(ledger1).generatedAt, undefined, 'the ledger itself carries NO wall clock');
    // Advance the clock past ISO-second resolution so a hidden wall-clock
    // write into the artifacts would show here.
    await new Promise((r) => setTimeout(r, 1100));
    await main(['run']);
    process.exitCode = 0;
    const ledger2 = await readFile(LEDGER_PATH, 'utf8');
    const report2 = await readFile(REPORT_PATH, 'utf8');
    assert.equal(ledger1, ledger2, 'ledger must be byte-identical across consecutive runs');
    assert.equal(report1, report2, 'report must be byte-identical across consecutive runs');
    // The sidecar is the ONE expected-churn surface: it may move forward.
    const stamp2 = JSON.parse(await readFile(META_PATH, 'utf8'));
    assert.ok(new Date(stamp2.generatedAt) >= new Date(stamp1.generatedAt), 'sidecar stamp moves; artifacts never do');
  });
});

test('run is an honest pending placeholder (exit 2), never silently succeeds', async () => {
  await inRepo('run', async () => {
    await main(['run']);
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
  });
});

test('run --json appends the machine run blob as the LAST stdout line (PRD section 14)', async () => {
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
    assert.ok(blob.rows.every((r) => ['REFUSED', 'EXPLOITED', 'BOUNDED', 'PASSED'].includes(r.verdict)));
    // And the ledger itself still lands as the v1 artifact.
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.equal(ledger.schemaVersion, 1);
    process.exitCode = 0;
  });
});

// --- thread A2: `run --out-dir <dir>` (PRD section 14/section 15 artifact fan-out) -------

test('run --per-row prints the accounting table + the run-level wall roll-up (issue #83)', async () => {
  await inRepo('per-row', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--per-row']);
    } finally {
      console.log = orig;
    }
    const text = out.join('\n');
    assert.match(text, /per-row accounting \(id \| durationMs \| requests \| ops \| arms\):/);
    assert.match(text, /total row wall: \d+ms across \d+ row\(s\); slowest: /);
    // The wall rides the printed table only - the committed ledger stays
    // duration-free (same commit -> same bytes).
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.ok(!JSON.stringify(ledger).includes('durationMs'));
    process.exitCode = 0;
  });
});

test('run --shard i/N runs the shard slice and stays read-only against labs/ (issue #99)', async () => {
  await inRepo('shard', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    // A whole run first, to learn the row ids + write the baseline.
    const wholeOut = [];
    const orig = console.log;
    console.log = (...a) => wholeOut.push(a.join(' '));
    let wholeBlob;
    try {
      await main(['run', '--json']);
      wholeBlob = JSON.parse(wholeOut.at(-1));
      // Now a shard: capture its blob + assert labs/ was NOT rewritten.
      const before = await readFile(LEDGER_PATH, 'utf8');
      const shardOut = [];
      console.log = (...a) => shardOut.push(a.join(' '));
      await main(['run', '--shard', '0/2', '--json']);
      console.log = orig;
      const shardBlob = JSON.parse(shardOut.at(-1));
      const after = await readFile(LEDGER_PATH, 'utf8');
      assert.equal(before, after, 'a shard must not rewrite the committed ledger (partial rows would clobber it)');
      assert.ok(shardOut.some((l) => l.includes('read-only against labs/')));
      // Merge the shards: a normal row appears in exactly one shard; a fanout
      // row (fanout: true) appears in EVERY shard, so take the worst verdict
      // per position. The merged union == the whole run, ids + verdicts.
      const sev = { REFUSED: 0, PASSED: 1, BOUNDED: 2, EXPLOITED: 3 };
      const byPos = new Map();
      const s1Out = [];
      console.log = (...a) => s1Out.push(a.join(' '));
      await main(['run', '--shard', '1/2', '--json']);
      console.log = orig;
      const s1 = JSON.parse(s1Out.at(-1));
      for (const r of [...shardBlob.rows, ...s1.rows]) {
        const prev = byPos.get(r.position);
        if (!prev || sev[r.verdict] > sev[prev.verdict]) byPos.set(r.position, r);
      }
      const merged = [...byPos.values()].sort((a, b) => a.id.localeCompare(b.id));
      const whole = [...wholeBlob.rows].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(merged.map((r) => [r.id, r.verdict]), whole.map((r) => [r.id, r.verdict]), 'merged shards union to exactly the whole run');
      assert.ok(shardBlob.rows.some((r) => r.fanout === true), 'a sharded run carries fanout rows (which appear in every shard)');
    } finally {
      console.log = orig;
    }
    process.exitCode = 0;
  });
});

test('run --shard rejects a malformed or out-of-range spec (exit 2, never a silent empty shard)', async () => {
  await inRepo('shard-bad', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted') }, seed: 7 };\n");
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      for (const bad of ['abc', '1', '0/0', '4/4', '0/-1']) {
        out.length = 0;
        process.exitCode = 0;
        await main(['run', '--shard', bad]);
        assert.equal(process.exitCode, 2, `--shard ${bad} must exit 2`);
        assert.ok(out.some((l) => l.includes('--shard')), `--shard ${bad} must name the flag`);
      }
    } finally {
      console.error = orig;
    }
    process.exitCode = 0;
  });
});

test('run --out-dir writes run-blob/ledger/report copies into a distinct dir without touching labs/ rules', async () => {
  await inRepo('outdir', async (dir) => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const fanout = join(dir, 'artifact-copies');
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--out-dir', fanout]);
    } finally {
      console.log = orig;
    }
    // The fan-out copies exist with the deterministic names:
    for (const name of ['run-blob.json', 'crashledger.json', 'hardening.md']) {
      const text = await readFile(join(fanout, name), 'utf8');
      assert.ok(text.length > 0, `${name} must be non-empty`);
    }
    const copiedLedger = JSON.parse(await readFile(join(fanout, 'crashledger.json'), 'utf8'));
    assert.equal(copiedLedger.schemaVersion, 1);
    const copiedBlob = JSON.parse(await readFile(join(fanout, 'run-blob.json'), 'utf8'));
    assert.ok(Array.isArray(copiedBlob.rows) && copiedBlob.rows.length > 0);
    // The repo's own labs/ contract files still exist (or, when absent in a
    // fresh temp repo, remain the sole authoritative path) - out-dir is a
    // COPY surface, never a redirect.
    assert.ok(out.some((l) => l.includes(`artifacts:`)));
    assert.ok(out.some((l) => l.includes(fanout)));
    process.exitCode = 0;
  });
});

test('run --out-dir refuses to fan out into the repo root (dist/gate rule)', async () => {
  await inRepo('outdir-root', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted') }, seed: 7 };\n");
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--out-dir', '.']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.ok(out.some((l) => l.includes('must be a distinct directory')));
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

// --- thread A: `run --expect-baseline <path>` (PRD section 14 read-only mode) ------

test('run --expect-baseline diffs a given ledger without touching labs/ (missing -> exit 2)', async () => {
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
    assert.match(consoleOut, /read-only diff against external\/ledger\.json \/ labs\/ untouched/);
    // Exit rule (section 7) unchanged: clean diff -> exit 0.
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

test('run --expect-baseline enforces the section 7 gate: a REFUSED->EXPLOITED regression fails', async () => {
  await inRepo('expect-regression', async () => {
    // The vulnerable-route draft of the demo target deliberately regresses
    // guards/hygiene-no-store (a surviving 2xx write rows EXPLOITED).
    await writeFile('crashtest.config.js',
      "import { app } from 'crashtest/fixtures/demo/app.js';" +
      "\n" +
      "export default { routes: { burst: async () => new Response('raw', { status: 200 }) }, seed: 7 };\n");
    // Simpler, deterministic regression: an unconstrained 200-er on a named
    // burst route flips guards/hygiene-no-store only when it is a *write* -
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
      "\n" + "    // Cache-Control - guards/hygiene-no-store EXPLOITS this deterministically," +
      "\n" + "    // and the baseline carries its id as previously-REFUSED -> section 7 gate trips." +
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
    // The gate MUST fail on a REFUSED->EXPLOITED regression even in read-only mode.
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

// --- issue #37: the opt-in vacuous run for configless roots -----------------

test('run --allow-vacuous: configless root prints one honest vacuous line, exit 0, labs/ untouched (issue #37)', async () => {
  await inRepo('vacuous', async (dir) => {
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    process.exitCode = undefined; // prove the exit comes out 0 by default

    try {
      await main(['run', '--allow-vacuous']);
    } finally {
      console.log = orig;
    }

    assert.ok(process.exitCode === undefined || process.exitCode === 0, 'vacuous run exits 0 (got ' + process.exitCode + ')');
    assert.match(
      out.join('\n'),
      /no crashtest\.config\.js found - vacuous run, 0 handlers, 0 attacks, exit 0/,
      'the exact honest line the issue names',
    );
    // AND no artifacts: a vacuous run writes nothing (empty-but-real ledger stays the caller's cut).
    await assert.rejects(readFile(join(dir, 'labs/crashledger.json')));
    await assert.rejects(readFile(join(dir, 'labs/hardening.md')));
    process.exitCode = 0;
  });
});

test('run --allow-vacuous keeps the LAST-stdout-line machine blob contract under --json (issue #37)', async () => {
  await inRepo('vacuous-json', async () => {
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--allow-vacuous', '--json']);
    } finally {
      console.log = orig;
    }
    const blob = JSON.parse(out.at(-1));
    assert.equal(blob.vacuous, true);
    assert.equal(blob.handlers, 0);
    assert.equal(blob.tally.TOTAL, 0, 'an empty-shape blob, same field names as a real run');
    process.exitCode = 0;
  });
});

test('missing config WITHOUT --allow-vacuous stays the hard exit 2 (the default never silently greens, issue #37)', async () => {
  await inRepo('vacuous-strict', async () => {
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2, 'strict default preserved byte-for-byte');
    assert.match(out.join('\n'), /A target needs a config/);
    process.exitCode = 0;
  });
});

test('config present + --allow-vacuous: the flag is irrelevant, the run is byte-normal (issue #37)', async () => {
  await inRepo('vacuous-armed', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--allow-vacuous']);
    } finally {
      console.log = orig;
    }
    assert.ok(!/vacuous/.test(out.join('\n')), 'armed config ignores the flag entirely');
    assert.ok(out.join('\n').includes('\ntally:'), 'the real campaign ran');
    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    assert.equal(ledger.schemaVersion, 1);
    process.exitCode = 0;
  });
});

// --- issue #37: the symmetric vacuous shape for `crashtest packs` -------------

test('packs --allow-vacuous: configless root lists nothing with the honest line, exit 0 (issue #37)', async () => {
  await inRepo('vacuous-packs', async () => {
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['packs', '--allow-vacuous']);
    } finally {
      console.log = orig;
    }
    assert.ok(
      out.join('\n').includes('no crashtest.config.js found - vacuous packs listing, 0 packs, exit 0'),
      'the symmetric vacuous line',
    );
    process.exitCode = 0;
  });
});

// --- the config-footgun guards (packstruct#13's family shape, crashtest side) ---------------

test('a DECLARED scenarioDir that does not exist fails loudly (config is not a guess, the labs/ scan stays optional)', async () => {
  await inRepo('ghost-scenario-dir', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, scenarioDirs: ['./ghost-scenarios'], seed: 7 };\n");
    await assert.rejects(
      () => main(['run']),
      (e) => /scenario dir ".*ghost-scenarios" does not exist/.test(e.message)
        && e.message.includes('a declared dir is config, not optional'),
    );
    process.exitCode = 0;
  });
});

test('config packs: pointing packs: at packs/public refuses loudly naming the packs root (the silent zero-pack typo is closed)', async () => {
  await inRepo('footgun-packs-public', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, packs: ['packs/public'], seed: 7 };\n");
    // No packs/public actually exists under the tmp root - but the guard fires on the
    // NAME first (the misfire is config, not a filesystem accident).
    await mkdir(join('packs', 'public'), { recursive: true });
    await assert.rejects(
      () => main(['run']),
      (e) => /looks like the public directory itself/.test(e.message)
        && e.message.includes('pass the packs ROOT (the parent of public/)'),
    );
    process.exitCode = 0;
  });
});

// ---- edge-walk teeth: silent flag fills become loud refusals (the #18 class) ----

test('run: an unknown flag is a usage error (exit 2) - a typo that silently drops a gate is the exact misfire class this CLI exists to kill', async () => {
  await inRepo('run-uflag', async () => {
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--allow-vacuous', '--jsox']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join('\n'), /run: unknown flag\(s\) "--jsox"/);
    process.exitCode = 0;
  });
});

test('run: --expec-baseline typo is refused loudly, never a strict-vs-read-only coin flip', async () => {
  await inRepo('run-baseline-typo', async () => {
    await main(['init']);
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['run', '--expec-baseline', 'labs/crashledger.json']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join('\n'), /unknown flag\(s\) "--expec-baseline"/);
    process.exitCode = 0;
  });
});

test('packs: an unknown flag is a usage error (exit 2), same contract', async () => {
  await inRepo('packs-uflag', async () => {
    await main(['init']);
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await main(['packs', '--jso']);
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join('\n'), /packs: unknown flag\(s\) "--jso"/);
    process.exitCode = 0;
  });
});

test('run --lint-packs on a CONFIGLESS root serves the explicitly requested lane - not a missing-config exit, not a vacuous skip', async () => {
  await inRepo('run-lintpacks-configless', async () => {
    const out = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => out.push(a.join(' '));
    try {
      // No config, no labs/, no packs/ dir - the lane is explicitly asked for,
      // so it must RUN (here: refuse at the install check), never answer with
      // "no crashtest.config.js" or the vacuous one-liner.
      await main(['run', '--lint-packs', '--allow-vacuous']);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const text = out.join('\n');
    // The explicit lane is SERVICED (the packstruct call happens; its own
    // output rides stdio: 'inherit', so it lands on the real stdout - the
    // assertions below watch what the CLI itself answers).
    assert.match(text, /running packstruct over packs/);
    // ...and the configless-root shape stays out of the lane's way: no
    // missing-config exit text, no vacuous run line.
    assert.doesNotMatch(text, /no crashtest\.config\.js found|vacuous run/);
    assert.doesNotMatch(text, /no crashtest\.config\.js in /);
    process.exitCode = 0;
  });
});
