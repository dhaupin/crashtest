# AGENTS.md - working conventions for agents on this repo

flowforge is the **shell** the struct family ships new sites from: the
landing + docs rig and the CI/release plumbing, with the brand as data.
Humans are the primary audience; this file doubles as the agent cheat sheet
so nobody re-learns the same lessons from scratch. See the sibling docs:
[README.md](./README.md) (product + box contents),
[DEPLOY.md](./DEPLOY.md) (deploy + release runbook),
[CHANGELOG.md](./CHANGELOG.md) (the release log),
[MANIFEST.md](./MANIFEST.md) (per-file receipts), and
[labs/TASKS.md](./labs/TASKS.md) (the rolling work log).

## Layout

```text
web/                    the prestruct landing shell (React/Vite, prerendered)
  src/styles.css        the ENTIRE design system - semantic tokens only
  src/components/       Nav / Footer / ThemeSwitch / navItems (one nav vocabulary)
  src/pages/            placeholder pages - replace, keep route shape
  ssr.config.js         site identity + route map (prestruct fills it)
docs/                   the Jekyll docs rig
  _layouts/default.html header, sidebar, pagefind search, theme tokens
  _data/nav.yml         (yours to add) - sidebar sections come from here
scripts/                the docs gates (frontmatter/links/style/fiction/liquid)
.github/workflows/      docs-deploy.yml (Pages) + release.yml (npm OIDC)
labs/TASKS.md           the rolling work log - append entries as you ship
labs/TASKS.md           assistant notes land here too (house log)
MANIFEST.md             every extracted file -> source SHA + engine pins
packs/README.md         the /packs contract (see below) - packs live in packs/public/<name>/
```

## House rules (each one paid for in real bugs)

1. **Tokens own the palette.** Every color rides semantic variables
   (`--paper/--surface/--raised/--ink/--ink-soft/--accent/--moss/--err/...`);
   the light theme is a second block of the SAME token set; a layout class
   never hardcodes a hex. Re-brand = edit tokens + `navItems.js` +
   `ssr.config.js`. Nothing else moves.
2. **Theme is one attribute.** `<html data-theme>` + a no-flash inline
   bootstrap; both switch icons always render (CSS picks), so prerender and
   hydration agree byte-for-byte. Icon is the action (sun shows in dark
   mode - clicking goes light), the shared family convention.
3. **Gates fail at cause.** Every `scripts/check-*.cjs` names file:line.
   When a bug is caught twice, it becomes a gate - add a signature/check the
   same day, never bend a check to silence it.
4. **Pins never float.** prestruct (npm), freestruct (workflow install), and
   the pagefind scrape are pinned in the workflow files. Bumping a pin moves
   the [MANIFEST.md](./MANIFEST.md) row in the SAME commit.
5. **Adopt explicitly, extract honestly.** New sites diff this rig and
   replace only brand data (tokens, nav vocabulary, pages, copy). When this
   rig takes a fix FROM a family repo, transcribe with receipts - never
   invent shapes from memory.
6. **Determinism.** Same inputs -> same bytes for anything generated; no
   wall clock in shipped surfaces.
7. **The log is the memory.** Every agent session appends its receipts to
   [labs/TASKS.md](./labs/TASKS.md) and versioned changes to
   [CHANGELOG.md](./CHANGELOG.md) - the next agent should never have to
   guess what happened.

## The /packs ecosystem (the family contract)

`packs/` is where optional extension packs live: `packs/public/<name>/`
(tracked, shipped) and `packs/local/<name>/` (gitignored, private). A pack
is a `pack.json` manifest plus its entry module. The manifest grammar is
SPEC 1 - [packs/README.md](./packs/README.md) links the spec, the two
profile reference implementations (crashtest: `scenario`, poststruct:
`check`), and the lint tool (packstruct). Empty in the shell on purpose.

## Common commands

```bash
node --check scripts/*.cjs && node scripts/check-docs-frontmatter.cjs \
  && node scripts/check-docs-links.cjs && node scripts/check-docs-style.cjs \
  && node scripts/check-fiction-signatures.cjs && node scripts/check-jekyll-filters.cjs
npm install --prefix web && npm run build --prefix web   # "N/N pages rendered" is healthy
cd docs && bundle exec jekyll build                      # optional locally; CI proves it
```

## Version protocol (0.9.0 today)

Version surfaces: `package.json` and `web/package.json` - kept EQUAL by a
same-commit bump (see [CHANGELOG.md](./CHANGELOG.md) for the current state).
A release = bump both + a CHANGELOG entry + tag `vX.Y.Z` + push the tag; the
release workflow publishes to npm via Trusted Publishing (OIDC - no publish
tokens anywhere). The retry ritual lives in
[DEPLOY.md](./DEPLOY.md). Pack manifests are OUTSIDE this protocol - their
semver is theirs.
