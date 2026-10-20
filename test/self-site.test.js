// Self-dogfood, CLI-level: crashtest attacks crashtest's own shipped site
// function (web/functions/api/version.js) via a run root in a temp cwd — the
// same shape the run-roots playbook documents. The committed repo ledger
// stays untouched: this target's baseline lives in the temp dir's labs/.
//
// The pack carries a REAL fixed bug as regression proof: the version function
// used to return 200 with no version key on a malformed-but-OK registry
// response ({"nope":true} @ 201 — res.ok true). Found by the self-dogfood's
// first run; fixed in web/functions/api/version.js; site/registry-hostile-
// statuses guards it forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, LEDGER_PATH, REPORT_PATH } from '../src/cli.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

test('crashtest attacks its own shipped site function (self-dogfood PoC, exit 0)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crashtest-selfsite-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    // Run-root config: absolute imports of the REAL target + pack (same
    // pattern as the run-roots playbook — config outside the target root).
    await writeFile('crashtest.config.js', [
      `const { siteRoutes } = await import(${JSON.stringify(join(REPO, 'fixtures', 'site', 'site-target.js'))});`,
      'export default {',
      '  routes: siteRoutes(),',
      `  scenarioDirs: [${JSON.stringify(join(REPO, 'fixtures', 'site', 'scenarios'))}],`,
      '  seed: 0xC0FFEE,',
      '};',
      '',
    ].join('\n'));

    await main(['run']);
    assert.equal(process.exitCode, 0, 'self-dogfood must hold at exit 0');

    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    const siteRows = ledger.findings.filter((f) => f.id.startsWith('site/'));
    assert.equal(siteRows.length, 5, 'the site pack contributes 5 findings');
    assert.ok(siteRows.every((f) => f.verdict === 'REFUSED'), 'every self-attack refused on the hardened site');
    assert.ok(
      siteRows.some((f) => f.id === 'site/registry-hostile-statuses'),
      'the probe that caught the real 200-without-version bug must exist',
    );

    const report = await readFile(REPORT_PATH, 'utf8');
    assert.match(report, /# Hardening report/);
    assert.match(report, /site\/version-endpoint-burst/);

    process.exitCode = undefined;
  } finally {
    process.chdir(prev);
  }
});

// The library-level probe of the exact bug class, pinned without the CLI:
// a malformed-but-OK registry must collapse to the honest 502.
test('site target: version() refuses a version-less 2xx registry payload (the fixed bug)', async () => {
  const { siteRoutes, registry, restoreFetch } = await import(
    new URL('../fixtures/site/site-target.js', import.meta.url)
  );
  const before = registry.reply;
  registry.reply = async () => new Response(JSON.stringify({ nope: true }), { status: 201 });
  try {
    const routes = siteRoutes();
    const res = await routes.version({ request: new Request('https://self/api/version') });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.ok(typeof body.error === 'string');
    assert.equal(body.version, undefined);
  } finally {
    registry.reply = before;
    restoreFetch();
  }
});
