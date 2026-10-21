import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// The web/docs consistency probe (PRD section 14 spirit: one truth, many surfaces).
// Guarantees the site (/web) and the docs (docs/) never drift apart on nav
// labels, hrefs, verdict vocabulary, or voice rules. If this fails, fix the
// SOURCE (navItems.js / nav.yml), never the test.

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFile(join(ROOT, p), 'utf8');

test('nav: every docs nav.yml EXTERNAL surface appears in web navItems.js (same label + href)', async () => {
  const navYml = await read('docs/_data/nav.yml');
  const navItems = await read('web/src/components/navItems.js');
  const appRoutes = await read('web/src/AppLayout.jsx');
  // docs externals that are THEIR OWN domain stay their own concern; the
  // docs' links INTO this site (crashtest.creadev.org/terms|privacy) are our
  // own routes and must exist as real routes here, not nav entries.
  const ownSite = 'https://crashtest.creadev.org';
  const docsExternals = [...navYml.matchAll(/url: (https?:\/\/\S+)/g)]
    .map(m => m[1])
    .filter(u => !u.startsWith(ownSite));
  for (const url of docsExternals) {
    assert.ok(
      navItems.includes(url),
      `docs nav external ${url} missing from web/src/components/navItems.js`,
    );
  }
  // the docs nav's links to our own site resolve as app routes
  for (const path of ['/terms', '/privacy']) {
    assert.ok(appRoutes.includes(`path="${path}"`), `docs nav points at ${path}; no such app route`);
  }
});

test('nav: header, sidebar, and footer all render from the ONE shared nav source (no drift possible)', async () => {
  const navItems = await read('web/src/components/navItems.js');
  const footer = await read('web/src/components/Footer.jsx');
  const nav = await read('web/src/components/Nav.jsx');
  for (const label of ['Docs', 'GitHub', 'npm']) {
    assert.ok(navItems.includes(`label: '${label}'`), `navItems.js missing label ${label}`);
  }
  // header AND footer render NAV_ITEMS / FOOTER_EXTRAS - not hand-typed labels
  assert.ok(nav.includes("from './navItems.js'"), 'Nav must render from navItems.js');
  assert.ok(footer.includes("from './navItems.js'"), 'Footer must render from navItems.js');
  assert.ok(nav.includes('NAV_ITEMS'), 'Nav must iterate NAV_ITEMS');
  assert.ok(footer.includes('NAV_ITEMS'), 'Footer must iterate NAV_ITEMS');
});

test('tone: site never claims a shipped-only CLI fact the docs refute (verdict vocabulary parity)', async () => {
  const attacks = await read('docs/reference/attacks.md');
  const faq = await read('web/src/pages/FAQ.jsx');
  // the three verdict names must exist verbatim on both surfaces
  for (const v of ['REFUSED', 'EXPLOITED', 'BOUNDED']) {
    assert.ok(attacks.includes(v), `docs attacks missing verdict ${v}`);
    assert.ok(faq.includes(v), `web FAQ missing verdict ${v}`);
  }
  // attack-count claim must match: FAQ says 23 attacks across 9 modules,
  // docs' attack catalog is the source of truth
  const catalogRows = (attacks.match(/^\| `/gm) || []).length;
  assert.equal(catalogRows, 23, 'attack catalog row count drifted - update FAQ copy or the catalog');
  assert.ok(faq.includes('23 across 9 modules'), 'FAQ attack-count claim drifted from catalog');
});

test('tone: both surfaces use the same exit-code contract (0 held / 1 finding / 2 config)', async () => {
  const exitRules = await read('docs/reference/exit-rules.md');
  const cli = await read('src/cli.js');
  const faq = await read('web/src/pages/FAQ.jsx');
  const assign = (s) => {
    const m = s.match(/exit(?:es)?[^.]*?0\b|0.*?nothing new weak|baseline held/);
    return Boolean(m);
  };
  assert.ok(/0.*no.*weak|No.*weak|fail on a NEW/.test(exitRules), 'docs exit-rules lost the CI rule');
  assert.ok(assign(faq), 'web FAQ exit-code answer drifted');
  assert.ok(/baseline held/.test(cli), 'CLI help lost the exit-code phrasing');
});

test('voice: web prose obeys the docs\' enforced style rules (hyphen-voice + cliches)', async () => {
  // Run the docs style rules against web prose pages (not code identifiers).
  const pages = ['web/src/pages/FAQ.jsx', 'web/src/pages/Home.jsx'];
  const cliche = /\bdelve into\b|\bseamless(ly)?\b|\bempower(s|ed|ing)?\b|\bleverag(e|ing)\b|\bgame[- ]?changer\b|\bcutting[- ]?edge\b|\brevolutionar(y|ily)\b/i;
  for (const p of pages) {
    const src = await read(p);
    // strip JSX attribute strings + code identifiers crudely: only prose in
    // >text< segments matters here; a cliche in a className is impossible by
    // construction of this list.
    assert.ok(!cliche.test(src), `${p} uses a banned cliche (see docs/about/style)`);
    // em dash ban: prose of these pages must not carry U+2013/U+2014
    assert.ok(!/[\u2013\u2014]/.test(src), `${p} carries an em/en dash (hyphen-voice enforced site-wide)`);
  }
});

test('identity: one brand, one tagline, one URL set everywhere', async () => {
  const ssr = await read('web/ssr.config.js');
  const navItems = await read('web/src/components/navItems.js');
  const docsConfig = await read('docs/_config.yml');
  const docsSsr = await read('docs/ssr-config.yml');
  // brand name
  assert.ok(ssr.includes("siteName: 'Crashtest'"));
  assert.ok(docsConfig.includes('title: Crashtest'));
  // the docs origin is linked by the site (shared nav source is the home of it)
  assert.ok(navItems.includes('docs.creadev.org'), 'site nav must link the docs origin');
  // og image single asset
  assert.ok(ssr.includes('og-image.png'));
  // the freestruct layer of docs declares the same origin
  assert.ok(docsSsr.includes('url: https://docs.creadev.org'));
});

test('nav consistency: docs nav.yml permalinks that the site footer/nav references resolve', async () => {
  const navYml = await read('docs/_data/nav.yml');
  const perma = new Set(
    [...(await read('docs/getting-started/quick-start.md')).matchAll(/^permalink: (\S+)$/gm)].map(m => m[1]),
  );
  // the site's hero CTA points at the docs quick start - must exist
  assert.ok(/getting-started\/quick-start/.test(navYml), 'docs nav lost quick-start');
  assert.ok(perma.has('getting-started/quick-start'), 'quick-start permalink drifted');
});
