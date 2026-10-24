# Changelog

All notable changes to the flowforge shell. The released version lives in
`package.json` + `web/package.json` (kept equal by a same-commit bump - the
Version protocol lives in [AGENTS.md](./AGENTS.md)). Releases go out on
`vX.Y.Z` git tags via npm Trusted Publishing - the runbook is
[DEPLOY.md](./DEPLOY.md).

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
[SemVer](https://semver.org/). `packs/<name>/pack.json` manifests carry
THEIR OWN semver, independent of the CLI/shell - see
[packs/README.md](./packs/README.md).

## 0.9.0 - 2026-10-24

The first scaffold: the rig extracted from **dhaupin/crashtest @ 905aa91**,
generic-branded, with a receipt table per file ([MANIFEST.md](./MANIFEST.md)).
Ready for the first manual npm push + GitHub release (`v0.9.0` tag; the OIDC
workflow ships it).

### Added

- `web/` - the prestruct landing shell: light/dark theme switch (no-flash
  bootstrap, icon-is-the-action), tokens-only palette (dark + light, neutral
  graphite), nav/sidebar/footer from one vocabulary file, the island engine,
  placeholder pages, and a highlighted terminal block.
- `docs/` - the Jekyll rig: search > GitHub icon > theme switch > menu
  header, pagefind modal search, Rouge token colors shared with the landing,
  freestruct SEO layer, sample page proving frontmatter + highlighting.
- `scripts/` - the docs gates: frontmatter, links (doubled-baseurl trap),
  style/voice, fiction signatures (generic seeds), and the single-argument
  Liquid filter trap.
- `.github/workflows/docs-deploy.yml` - token-authenticated pagefind scrape +
  PINNED freestruct layer + GitHub Pages.
- `.github/workflows/release.yml` - npm Trusted Publishing (OIDC) template.
- `AGENTS.md` - the agent-facing map + house rules + version protocol.
- `DEPLOY.md` - the deploy runbook, crosslinked.
- `labs/TASKS.md` - the rolling work log (seeded with the extraction entry).
- `packs/README.md` - the `/packs` contract + the struct-family links.

### Notes

- The rig's version surfaces: `package.json` and `web/package.json` (both
  0.9.0). PNG icon slots (`icon-192/512`, `favicon-32`, `apple-touch-icon`,
  `og-image.png`) are referenced but not shipped - drop yours into
  `web/public/`.
