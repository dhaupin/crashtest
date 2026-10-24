# flowforge MANIFEST - the receipts

Every file in this rig is either an extraction from a deployed, verified
surface or a tiny generic glue file. This table names which, at which SHA,
so adopters can diff against the source and so bumping a pinned engine is a
deliberate review rather than a drift.

Extraction source: **dhaupin/crashtest @ 905aa91** (2026-10-24) unless noted.
Byte-exact copies were verified with `cmp` at extraction time.

## docs/ (Jekyll rig)

| file                        | receipt                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `_config.yml`               | genericized from crashtest docs/_config.yml (same kramdown/rouge/permalink/excludes engine settings) |
| `_layouts/default.html`     | extracted; brand paths now ride `site.baseurl`, theme key `flowforge-theme`, tokens neutralized |
| `icon.svg`                  | placeholder, byte-identical with `web/public/icon.svg` (the two-surface brand contract)        |
| `index.md`                  | sample page; proves the frontmatter gate + Rouge highlighting                                  |
| `_freestruct/inject-brand.html` | extracted shape, placeholders genericized (adds twitter/og:image/JSON-LD the layout lacks)  |

## web/ (prestruct landing shell)

| file                        | receipt                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `package.json`              | extracted deps (react/react-dom/react-router-dom pinned as in source)                        |
| `vite.config.js`            | byte-exact copy                                                                              |
| `ssr.config.js`             | extracted shape; identity + routes are the adopter's data (one route per AppLayout Route)      |
| `index.html`                | extracted; theme key `flowforge-theme`, no-flash bootstrap retained                           |
| `src/App.jsx`, `src/main.jsx`, `src/islands.js`, `src/hooks/usePageMeta.js` | byte-exact copies (engine files - copy once, never edit) |
| `src/AppLayout.jsx`         | extracted shape; routes reduced to the shell's                                               |
| `src/AppIslands.jsx`        | extracted template; registry empty + commented usage                                          |
| `src/components/Nav.jsx`    | extracted; brand text + GitHub href are placeholders; header order kept: GitHub icon > theme switch > menu > burger |
| `src/components/ThemeSwitch.jsx` | byte-exact copy, theme key `flowforge-theme`                                            |
| `src/components/Footer.jsx`, `src/components/navItems.js` | extracted shape; one shared nav vocabulary                  |
| `src/styles.css`            | extracted design system; palette values neutralized (token NAMES and structure are the contract, values are your brand) |
| `public/_headers`, `public/_redirects` | byte-exact copies (CSP + no-SPA-fallback redirect wisdom)                          |
| `public/icon.svg`           | placeholder (matches docs/icon.svg byte-equal)                                               |
| `public/site.webmanifest`, `public/robots.txt` | extracted shape; identity genericized; PNG icons left to the adopter (drop icon-192/512/favicon-32/apple-touch-icon + og-image.png into web/public/) |

## scripts/ (the docs gates)

| file                        | receipt                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `check-docs-frontmatter.cjs` | byte-exact copy (gate: 4 required fields, baseurl-relative permalinks)                       |
| `check-docs-links.cjs`      | extracted; `SITE_PREFIX` now a one-line constant to mirror your baseurl                        |
| `check-docs-style.cjs`      | byte-exact copy (voice/hyphen rules)                                                          |
| `check-fiction-signatures.cjs` | same scanner logic; seed signatures are GENERIC - seed your own the moment a fiction is caught twice |
| `check-jekyll-filters.cjs`  | byte-exact copy (the two-arg single-arg Liquid filter trap - found live in packstruct CI, crashtest#23) |

## .github/workflows/

| file                        | receipt                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `docs-deploy.yml`           | extracted from crashtest docs.yml; includes the TOKEN-AUTH pagefind scrape (rate-limit lesson) and the PINNED freestruct install |
| `release.yml`               | template: npm Trusted Publishing (OIDC), no publish tokens, tag-driven                         |

## Engine pins (bump = deliberate review)

| engine     | pin                                                  | why                                                                         |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| prestruct  | `^1.0.0` (npm; matches the source repo's shipped pin) | the prerender engine - floating = random deploys                            |
| freestruct | `dhaupin/freestruct#dfb30aa498` (docs-deploy.yml)     | a floating github:-install once reorganized docs/lib mid-day (PINNED lesson) |
| pagefind   | latest-resolve IN CI, token-authenticated, hard-refused on an unparseable tag | unauthenticated scrapes get rate-limited from shared runner IPs          |
| actions    | `actions/checkout@v4`, `actions/setup-node@v4`, `upload-pages-artifact@v3`, `configure-pages`/`deploy-pages` as pinned in the copied workflow | |

## Repo-level docs and the agency layer

| file                        | receipt                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `AGENTS.md`                 | new (this cut): agent cheat sheet - map, house rules, version protocol; crosslinks README/DEPLOY/CHANGELOG/labs/packs |
| `DEPLOY.md`                 | new (this cut): the deploy + release runbook (web/CF-Pages shape, docs/Pages, npm OIDC); crosslinks |
| `CHANGELOG.md`              | new (this cut): npm-format log; entries ride the same commit as version bumps                  |
| `labs/TASKS.md`             | new (this cut): seeded rolling log; every session appends receipts                             |
| `packs/README.md` + `packs/.gitignore` | new (this cut): the /packs contract + struct-family links; `packs/local/` gitignored |
| `package.json` (root)       | new (this cut): npm-publishable metapackage @0.9.0, `files` = the rig, no runtime deps         |
| `web/package.json`          | version moved to 0.9.0 (kept equal with the root version - the version protocol)               |

## Bump procedure

1. Change the pinned SHA/version in the workflow or `MANIFEST.md`.
2. Run the verify suite in the README.
3. Land all of it (works + receipt bump) in the SAME commit - the rig's docs
   must never claim a state the workflows do not run.
