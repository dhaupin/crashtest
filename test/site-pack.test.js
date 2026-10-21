// Site self-pack, pack-surface level: crashtest attacks its own SHIPPED
// WEBSITE through the one extension surface - packs/public/crashtest-site
// (pack.json entry = the attack module; the run root wires the routes by
// importing buildSiteRoutes() from the pack). Two proofs live here:
//
//   1. CLI-level run-root honesty - 9 site attacks all REFUSED at HEAD, and
//      the WP packs on board degrade to skipped-REFUSED on a non-WP run root
//      (never fake EXPLOITEDs - the section 12 zero-false-positive rule).
//   2. Teeth, two ways - version-grammar-hostile-shapes EXPLOITEDs a
//      deliberately porous version route (the pre-fix shape: "200 means any
//      truthy string is a version") and rests at REFUSED against the real
//      hardened web/functions/api/version.js. The real repo carried exactly
//      this bug: found live by this pack's first run, fixed by the validation
//      floor in web/functions/api/version.js (semver floor + pollution key
//      guard + bounded length). This test pins the fix forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, LEDGER_PATH } from '../src/cli.js';
import { Harness } from '../src/harness/harness.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

test('crashtest-site pack runs on itself from a foreign run root (exit 0, all refused)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crashtest-sitepack-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    // Run root OUTSIDE the repo; pack stays in the repo - the cross-repo
    // packs: shape the docs promise, with the run root importing the site
    // routes from the pack's own target module.
    await writeFile('crashtest.config.js', [
      `const { buildSiteRoutes } = await import(${JSON.stringify(join(REPO, 'packs', 'public', 'crashtest-site', 'index.js'))});`,
      'export default {',
      '  routes: buildSiteRoutes(),',
      `  packs: [${JSON.stringify(join(REPO, 'packs'))}],`,
      '  seed: 0xC0FFEE,',
      '};',
      '',
    ].join('\n'));

    await main(['run']);
    assert.equal(process.exitCode, 0, 'self-site pack run must hold at exit 0');

    const ledger = JSON.parse(await readFile(LEDGER_PATH, 'utf8'));
    const siteRows = ledger.findings.filter((f) => f.id.startsWith('crashtest-site/'));
    assert.equal(siteRows.length, 11, 'the site pack contributes all 11 attacks (9 original + 2 taxonomy probes)');
    assert.ok(siteRows.every((f) => f.verdict === 'REFUSED'), 'every shipped-site attack refused on the hardened repo');
    assert.ok(
      siteRows.some((f) => f.id === 'crashtest-site/version-grammar-hostile-shapes'),
      'the probe that caught the real through-the-floor version bug must exist',
    );

    // The OTHER shipped packs degrade honestly on this non-WP run root -
    // skipped-REFUSED, never fake EXPLOITEDs (PRD section 12 regression pin).
    const stockwp = ledger.findings.filter((f) => f.id.startsWith('stockwp/'));
    assert.ok(stockwp.length >= 4, 'stockwp rows exist');
    assert.ok(stockwp.every((f) => f.verdict === 'REFUSED' && /attack skipped|check skipped/.test(f.detail)), 'stockwp degrades to honest skipped-REFUSED off-target');

    process.exitCode = undefined;
  } finally {
    process.chdir(prev);
  }
});

test('teeth: version-grammar-hostile-shapes EXPLOITEDs a porous version route, REFUSED on the real one', async () => {
  const attacks = (await import(new URL('../packs/public/crashtest-site/attacks.js', import.meta.url))).default.attacks;
  const grammar = attacks.find((a) => a.name === 'version-grammar-hostile-shapes');
  const { installRegistryShim, restoreFetch } = await import(
    new URL('../packs/public/crashtest-site/lib/registry-shim.js', import.meta.url)
  );
  installRegistryShim();
  try {
    // POROUS (the pre-fix shape of web/functions/api/version.js): echoes any
    // truthy registry string straight through as "a version".
    const porous = async () => {
      const res = await fetch('https://registry.npmjs.org/crashtest/latest', { headers: { accept: 'application/json' } });
      if (!res.ok) return new Response(JSON.stringify({ error: 'registry unreachable' }), { status: 502, headers: { 'cache-control': 'no-store' } });
      const pkg = await res.json();
      if (typeof pkg?.version !== 'string' || !pkg.version) {
        return new Response(JSON.stringify({ error: 'no version' }), { status: 502, headers: { 'cache-control': 'no-store' } });
      }
      return new Response(
        JSON.stringify({ package: pkg.name ?? 'crashtest', version: pkg.version, provenance: Boolean(pkg.dist?.attestations), source: 'npm-registry' }),
        { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } },
      );
    };

    const vulnHarness = new Harness();
    vulnHarness.registerRoute('version', porous);
    const vulnVerdict = await grammar.run(vulnHarness, {});
    assert.equal(vulnVerdict.verdict, 'EXPLOITED', 'porous route must EXPLOIT with evidence');
    assert.match(vulnVerdict.detail, /hostile shapes broke the badge contract/);

    // HARDENED: the real shipped function. Every hostile shape floors to 502.
    const real = (await import(new URL('../web/functions/api/version.js', import.meta.url))).onRequestGet;
    const hardHarness = new Harness();
    hardHarness.registerRoute('version', real);
    const hardVerdict = await grammar.run(hardHarness, {});
    assert.equal(hardVerdict.verdict, 'REFUSED', 'the hardened shipped function holds every hostile shape');
  } finally {
    restoreFetch();
  }
});

test('dist-absent is a config gap, never a finding: HTML/sitemap attacks skip honestly', async () => {
  // The CI-fresh-checkout shape: web/dist is gitignored, so the artifact
  // routes answer the honest 404 marker. The routes must not throws and the
  // attacks must degrade to skipped-REFUSED (PRD section 12) until the build runs.
  const attacks = (await import(new URL('../packs/public/crashtest-site/attacks.js', import.meta.url))).default.attacks;
  const harness = new Harness();
  for (const route of ['site-html', 'site-sitemap']) {
    harness.registerRoute(route, () => new Response(
      `crashtest-site: ${route} missing (run the web build)`,
      { status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } },
    ));
  }
  for (const name of ['html-secret-leakage', 'sitemap-truth-audit']) {
    const verdict = await attacks.find((a) => a.name === name).run(harness, {});
    assert.equal(verdict.verdict, 'REFUSED', `${name} must SKIP, never EXPLOIT, on dist-absent`);
    assert.equal(verdict.skipped, true, `${name} must mark the skip`);
    assert.match(verdict.detail, /web\/dist not built/, `${name} must name the build as the coverage fix`);
  }
});
