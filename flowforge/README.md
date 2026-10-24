# flowforge - the creation.shell the struct family ships from

One repo, two sites, zero styling drift. This is the **rig** half of a site:
the landing shell, the docs rig, and the CI/release plumbing that the struct
family (dhaupin/crashtest, dhaupin/packstruct, ...) keeps rebuilding and
re-porting. Every elapsed bug got paid for once, here; new adopters inherit it.

## What is in the box

| piece            | what it carries                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `web/`           | the landing shell: prestruct-prerendered React/Vite app, light/dark theme switch (no-flash bootstrap, icon-as-action), tokens-only palette (dark + light), nav/sidebar/footer from one vocabulary file, island engine, placeholder pages + a highlighted terminal block |
| `docs/`          | the Jekyll rig: fixed header (search > GitHub icon > theme switch > menu), slide-out sidebar, pagefind modal search (Cmd+K), Rouge token colors shared with the landing, freestruct SEO layer, sample page proving frontmatter + highlighting |
| `scripts/`       | the docs gates: frontmatter, links (doubled-baseurl trap), style/voice, fiction signatures, the single-arg Liquid filter trap |
| `.github/workflows/` | `docs-deploy.yml` (Jekyll + hardened pagefind scrape + PINNED freestruct layer + Pages), `release.yml` (npm Trusted Publishing OIDC template) |
| `MANIFEST.md`    | the receipts: every extracted file -> its source repo+SHA, engine pins, and the one review rule for bumping them   |

## The map (with the sibling docs)

- [AGENTS.md](./AGENTS.md) - agent cheat sheet: layout, house rules, the
  version protocol, and the commands to run before any push
- [DEPLOY.md](./DEPLOY.md) - deploy/release runbook: landing host, docs
  Pages + pagefind, the OIDC release ritual, retry rules
- [CHANGELOG.md](./CHANGELOG.md) - npm-format version history; every
  version bump lands here in the same commit
- [MANIFEST.md](./MANIFEST.md) - the receipt table (which file came from
  where, which pins guard which engine)
- [labs/TASKS.md](./labs/TASKS.md) - the rolling work log (newest last)
- [packs/README.md](./packs/README.md) - the `/packs` contract + the
  struct-family links (SPEC v1, the linter, the two profile hosts)

## The rules the family already runs on

1. **Tokens own the palette.** Every color rides semantic variables
   (`--paper/--surface/--raised/--ink/--ink-soft/--accent/--moss/--err/...`);
   the light theme is a second block of the SAME token set; no layout class
   ever hardcodes a hex. Brand = edit tokens + navItems + ssr.config.
2. **Theme = one `<html data-theme>` attribute.** No-flash bootstrap inline
   script, both switch icons always render (CSS picks), so the prerendered
   bytes and the hydrated DOM are identical. Icon is the ACTION (sun shows in
   dark mode - clicking goes light), the shared family convention.
3. **Gates fail at cause.** The docs lint chain (`check-docs-*` + the Jekyll
   filter trap) names file:line. A lint pass is added the day a bug is caught
   twice; it becomes a gate, not a memory.
4. **Pins, never floats.** freestruct + prestruct + the pagefind scrape are
   pinned in the workflow files. Bumping a pin is a deliberate, reviewed step
   - MANIFEST.md says which receipt to carry.
5. **Adopt explicitly.** Start from a checkout, not an npm install: diff this
   rig against your target repo (intent: a diff that shows ONLY your brand
   data), replace every YOUR... value, remove sample pages, wire your content.

## Verify before shipping (the same gates the family runs)

```bash
node --check scripts/*.cjs
node scripts/check-docs-frontmatter.cjs
node scripts/check-docs-links.cjs        # SITE_PREFIX mirrors your baseurl
node scripts/check-docs-style.cjs
node scripts/check-fiction-signatures.cjs
node scripts/check-jekyll-filters.cjs    # the liquid trap from crashtest#23
npm install --prefix web && npm run build --prefix web   # 6/6 prerender is healthy
```

Docs deploy lives in CI (Jekyll is too much runtime to demand locally); the
workflow self-verifies: gates -> jekyll -> freestruct --strict -> pagefind ->
Pages.

## Provenance

Extracted from **dhaupin/crashtest @ 905aa91** (2026-10-24), the deployed
state the theme-port round verified: suite green, web prerender 6/6 pages,
docs deploy live. See `MANIFEST.md` for the per-file receipt table.
