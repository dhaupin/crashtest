// Site self-pack, pack-surface level: crashtest attacks its own SHIPPED
// WEBSITE through the one extension surface - packs/public/crashtest-site
// (pack.json entry = the attack module; the run root wires the routes by
// importing buildSiteRoutes() from the pack). Two proofs live here:
//
//   1. CLI-level run-root honesty - 18 site attacks all REFUSED at HEAD, and
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
    assert.equal(siteRows.length, 18, 'the site pack contributes all 18 attacks (9 original + 2 taxonomy + 2 session + 1 authz + 1 proto-hygiene + 1 recursion + 1 upload + 1 race probe)');
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

test('teeth: authz advertising / manifest icon presence / HEAD-parity oracles all fire on their pre-fix shapes', async () => {
  const attacks = (await import(new URL('../packs/public/crashtest-site/attacks.js', import.meta.url))).default.attacks;

  // authz-no-privileged-surface: the first cut of the privilege-surface
  // battery used ``\b\/admin\b`` patterns which can NEVER match the
  // canonical quoted case 'href="/admin"' (no word boundary exists between
  // a quote and a slash). The advertising half was vacuously green - found
  // walking this pack; the fixed battery must EXPLOIT every canonical form
  // and stay clear of prose look-alikes (a false EXPLOITED on shipped
  // artifacts would be just as wrong as a false green).
  const authz = attacks.find((a) => a.name === 'authz-no-privileged-surface');
  const artifactHarness = (html, contentType = 'text/html') => {
    const h = new Harness();
    h.registerRoute('site-html', () => new Response(html, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store' } }));
    return h;
  };
  for (const form of ['href="/admin"', 'path=/admin', "href='/wp-admin'", "href='/dev-check'", "href='/debug'"]) {
    const verdict = await authz.run(artifactHarness(`<html><body><a ${form}>x</a></body></html>`), {});
    assert.equal(verdict.verdict, 'EXPLOITED', `an artifact advertising ${form} is the exact class the battery exists for`);
    assert.match(verdict.detail, /advertise a privileged surface/);
  }
  for (const clean of ['href="/admin-theme"', 'href="/debugger-tips"', 'url=admin@example.com', 'path=/dashboard']) {
    const verdict = await authz.run(artifactHarness(`<p>${clean} is plain prose about tooling</p>`), {});
    assert.equal(verdict.verdict, 'REFUSED', `prose look-alike ${clean} must never false-EXPLOIT`);
  }

  // manifest-declared-icons-resolve: the description promises icon-file
  // presence in the shipped artifacts - the first cut checked only
  // well-formedness and never opened the icon paths (an oracle that
  // promises more than it checks). The fixed attack verifies every icon
  // src against the committed web/public/ set.
  const manifestAtk = attacks.find((a) => a.name === 'manifest-declared-icons-resolve');
  const manifestHarness = (body) => {
    const h = new Harness();
    h.registerRoute('site-manifest', () => new Response(body, { status: 200, headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } }));
    return h;
  };
  const realManifest = await readFile(join(REPO, 'web', 'public', 'site.webmanifest'), 'utf8');
  const honest = await manifestAtk.run(manifestHarness(realManifest), {});
  assert.equal(honest.verdict, 'REFUSED', 'the real manifest declares only icons that exist on disk');
  assert.match(honest.detail, /all present in web\/public\//);
  const lying = await manifestAtk.run(manifestHarness(JSON.stringify({
    name: 'Crashtest', short_name: 'crashtest',
    icons: [{ src: '/icon-1024-missing.png', sizes: '1024x1024', type: 'image/png' }],
  })), {});
  assert.equal(lying.verdict, 'EXPLOITED', 'a manifest advertising an absent icon file is the broken-install-prompt class');
  assert.match(lying.detail, /icon-1024-missing\.png/);

  // proto-hygiene-shape-battery: the oracle text grants an "honest 405"
  // answer for HEAD, but the first cut flagged ANY status disagreement -
  // a method-honest route would have been read as a parity break. Pin the
  // grant as written.
  const proto = attacks.find((a) => a.name === 'proto-hygiene-shape-battery');
  const headHarness = new Harness();
  headHarness.registerRoute('site-manifest', (ctx) => {
    if (ctx.request.method === 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' } });
  });
  const headVerdict = await proto.run(headHarness, {});
  assert.equal(headVerdict.verdict, 'REFUSED', 'a 405 HEAD answer is the honest no-HEAD serve - not a parity fault');
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

test('badge 502s name their ACTUAL cause: a rejected document is not an unreachable registry', async () => {
  // Walk round 23: the first cut rode the catch-all for BOTH outage classes,
  // so a hostile registry SHAPES 502 said 'unreachable' - a lie about where
  // the failure lived. The two classes must name their causes, and an
  // outage must never echo the registry's own bytes.
  const fn = (await import(new URL('../web/functions/api/version.js', import.meta.url))).onRequestGet;
  const { installRegistryShim: install, restoreFetch: restore } = await import(
    new URL('../packs/public/crashtest-site/lib/registry-shim.js', import.meta.url)
  );
  install();
  try {
    // (a) reachable-but-hostile: a pollution key in the document.
    const target = (await import(new URL('../packs/public/crashtest-site/lib/registry-shim.js', import.meta.url))).registry;
    const prevReply = target.reply;
    target.reply = async () => new Response('{"__proto__":{"canary":true},"version":"1.2.3"}', {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    try {
      const res = await fn({});
      assert.equal(res.status, 502, 'a rejected doc is an outage-class 502');
      const body = await res.text();
      assert.match(body, /registry document rejected: pollution key/, 'the failure class names the reject path');
      assert.doesNotMatch(body, /canary/, 'the reject never echoes the hostile bytes');
      assert.match(res.headers.get('cache-control'), /no-store/, 'the failure path is never cacheable');
    } finally {
      target.reply = prevReply;
    }

    // (b) genuinely unreachable: the transport fails.
    target.reply = async () => { throw new Error('simulated network outage'); };
    try {
      const res = await fn({});
      assert.equal(res.status, 502);
      const body = await res.text();
      assert.match(body, /unreachable|outage/, 'a real outage names the transport');
      assert.doesNotMatch(body, /rejected/, 'an outage is not a shape rejection');
    } finally {
      target.reply = prevReply;
    }
  } finally {
    restore();
  }
});
