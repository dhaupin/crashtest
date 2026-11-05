#!/usr/bin/env node
/**
 * check-catalog-sync.cjs - the catalog drift guard (crashtest#82).
 *
 * The shipped public catalog is generated FROM the code, not hand-maintained:
 *   - the library  (src/scenarios/library/*.js, via the real loader)
 *   - the packs    (packs/public/*, via the real pack loader)
 * and rendered onto two surfaces:
 *   - docs/reference/attacks.md + docs/reference/packs.md (the reference catalog)
 *   - web/src/pages/Attacks.jsx (the site's attack-library page)
 *
 * This guard makes the "generated from" claim mechanical: it reads the LIVE
 * sources and refuses when a shipped row or pack is missing from a catalog
 * surface, or when a stated count disagrees with reality. A new library row
 * or a tenth pack that nobody catalogued fails HERE, in CI, instead of
 * shipping a page that quietly lies about what the tool does.
 *
 * Exit 0 = every shipped row/pack is catalogued and every count agrees.
 * Exit 1 = drift (the missing/extra names and the disagreeing counts are named).
 *
 * argv[2] (optional) overrides the repo root, so the guard's own battery can
 * drive it over temp fixtures both ways (the house test rule).
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const problems = [];

async function main() {
  // ---- the LIVE truth: library + packs, from the real loaders -------------
  const { loadScenarios } = await import(pathToFileURL(path.join(ROOT, 'src/scenarios/loader.js')).href);
  const { loadPacks } = await import(pathToFileURL(path.join(ROOT, 'src/packs/loader.js')).href);

  const scenarios = await loadScenarios();
  const libraryRows = scenarios.flatMap((s) => s.module.attacks.map((a) => ({ module: s.module.name, attack: a.name })));
  const libraryModules = scenarios.map((s) => s.module.name);
  const libraryTotal = libraryRows.length;

  const packs = await loadPacks([path.join(ROOT, 'packs')]);
  const packRows = packs.map((p) => ({ name: p.manifest.name, attacks: p.module.attacks.length }));
  const packTotal = packRows.reduce((n, p) => n + p.attacks, 0);

  // ---- surface 1: docs/reference/attacks.md ------------------------------
  const attacksMd = read('docs/reference/attacks.md');
  for (const { module, attack } of libraryRows) {
    if (!attacksMd.includes(`\`${attack}\``)) {
      problems.push(`docs/reference/attacks.md: library row "${module}/${attack}" is not catalogued`);
    }
  }
  const catalogRows = (attacksMd.match(/^\| `/gm) || []).length;
  if (catalogRows !== libraryTotal) {
    problems.push(`docs/reference/attacks.md: ${catalogRows} catalog row(s) vs ${libraryTotal} shipped library attack(s) - the catalog drifted`);
  }

  // ---- surface 2: docs/reference/packs.md --------------------------------
  const packsMd = read('docs/reference/packs.md');
  for (const { name } of packRows) {
    if (!packsMd.includes(`\`${name}\``)) {
      problems.push(`docs/reference/packs.md: shipped pack "${name}" is not catalogued`);
    }
  }

  // ---- surface 3: web/src/pages/Attacks.jsx ------------------------------
  const attacksJsx = read('web/src/pages/Attacks.jsx');
  for (const { attack } of libraryRows) {
    if (!attacksJsx.includes(`'${attack}'`)) {
      problems.push(`web/src/pages/Attacks.jsx: library row "${attack}" is not on the page`);
    }
  }
  for (const { name } of packRows) {
    if (!attacksJsx.includes(`'${name}'`)) {
      problems.push(`web/src/pages/Attacks.jsx: shipped pack "${name}" is not on the page`);
    }
  }
  // The PACKS array is the page's pack census: its entries must equal the
  // shipped set exactly (a stale entry is drift in the other direction). The
  // entry's `dir` is the canonical pack identity (the display `name` may carry
  // a parenthetical module note).
  const pagePacks = [...attacksJsx.matchAll(/dir: '([a-z0-9-]+)', attacks: (\d+)/g)]
    .map((m) => ({ name: m[1], attacks: Number(m[2]) }));
  const shipped = new Map(packRows.map((p) => [p.name, p.attacks]));
  const paged = new Map(pagePacks.map((p) => [p.name, p.attacks]));
  for (const [name, attacks] of shipped) {
    if (!paged.has(name)) problems.push(`web/src/pages/Attacks.jsx PACKS: shipped pack "${name}" missing`);
    else if (paged.get(name) !== attacks) {
      problems.push(`web/src/pages/Attacks.jsx PACKS: "${name}" claims ${paged.get(name)} attacks, the pack ships ${attacks}`);
    }
  }
  for (const [name] of paged) {
    if (!shipped.has(name)) problems.push(`web/src/pages/Attacks.jsx PACKS: "${name}" is not a shipped pack (stale entry)`);
  }
  const pagePackTotal = pagePacks.reduce((n, p) => n + p.attacks, 0);
  if (pagePackTotal !== packTotal) {
    problems.push(`web/src/pages/Attacks.jsx PACKS: ${pagePackTotal} pack attacks vs ${packTotal} shipped`);
  }

  // ---- the module census on the web page ---------------------------------
  const pageModules = [...attacksJsx.matchAll(/mod: '([a-z0-9-]+)'/g)].map((m) => m[1]);
  for (const module of libraryModules) {
    if (!pageModules.includes(module)) problems.push(`web/src/pages/Attacks.jsx MODULES: library module "${module}" has no block`);
  }

  // ---- report ------------------------------------------------------------
  if (problems.length) {
    console.error(`CATALOG SYNC: FAIL (${problems.length} drift(s))`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('the catalog is generated FROM src/scenarios/library + packs/public; update the named surface(s).');
    process.exit(1);
  }
  console.log(`CATALOG SYNC: PASS (${libraryTotal} library attacks across ${libraryModules.length} modules; ${packRows.length} packs / ${packTotal} pack attacks - docs + web catalogued)`);
}

main().catch((err) => {
  console.error(`CATALOG SYNC: FAIL (${err.message})`);
  process.exit(1);
});
