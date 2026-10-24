# DEPLOY.md - the deploy + release runbook

The setup: **two static sites** (a landing shell, a docs rig) plus an
optional npm package, all deployable with the workflows this rig ships.
The box contents live in [README.md](./README.md); agent conventions live
in [AGENTS.md](./AGENTS.md); version bumps are logged in
[CHANGELOG.md](./CHANGELOG.md). Nothing here needs a database, a key, or a
server - the rig's shell is static all the way out.

## 1. The landing (`web/`, prestruct)

The build command is `prestruct build` (via `npm run build --prefix web`);
it compiles/URLs the app graph, prerenders **every route** into
`web/dist/<route>/index.html`, and injects the brand meta from
`web/ssr.config.js`. Whatever static host serves `dist/` per-path with
404 -> the prerendered `404.html` will run it as-is (Cloudflare Pages is the
family default - `web/public/_headers` and `_redirects` ship the CSP and the
do-NOT-SPA-fallback wisdom).

Healthy = the build's last line reads `N/N pages rendered` with N equal to
your routes, and no `screen/style` bloat errors. That is the same gate the
family's CI runs.

## 2. The docs (`docs/`, Jekyll + pagefind)

GitHub Pages territory: `.github/workflows/docs-deploy.yml` runs
gates -> Jekyll -> freestruct (pinned) -> pagefind -> Pages deploy. Set
`docs/_config.yml`'s `url` + `baseurl` to YOUR deploy location FIRST - the
layout composes canonical/OG/pagefind/logo paths from it. Without the
pagefind index the search modal reports that honestly (it never pretends to
search). The `paths:` filter means the workflow only fires on `docs/**`
changes, so landing edits never cost a docs deploy.

## 3. Release (npm + GitHub release)

The Version protocol (also in [AGENTS.md](./AGENTS.md)):
bump `package.json` + `web/package.json` in the SAME commit as the
[CHANGELOG.md](./CHANGELOG.md) entry -> commit -> tag `vX.Y.Z` -> push the
tag. `.github/workflows/release.yml` publishes to npm via Trusted
Publishing (OIDC): no `NPM_TOKEN` secret involved, provenance signed.

- One-time setup per account: link your npm package to the repo under
  npmjs.com -> package Settings -> Publishing access (or npm trusted
  publishing config) - the OIDC flow needs that mapping to mint credentials.
- If a tag-driven run fails, re-push the tag for the retry:
  `git push origin :refs/tags/vX.Y.Z && git push origin vX.Y.Z`
  (the workflow cannot re-run a failed run directly).
- Then create the GitHub release FROM the tag (Release -> New from tag)
  and paste the changelog entry as its body.

## 4. Local checks before any push

```bash
# the five docs gates + liquid trap (fast, pure node)
node --check scripts/*.cjs && node scripts/check-docs-frontmatter.cjs \
  && node scripts/check-docs-links.cjs && node scripts/check-docs-style.cjs \
  && node scripts/check-fiction-signatures.cjs && node scripts/check-jekyll-filters.cjs

# the shell, for real
npm install --prefix web && npm run build --prefix web
```

Docs builds are CI's job locally-optional (Jekyll is too much runtime to
demand); the deploy workflow is the truth.

## 5. What is deliberately NOT in this runbook

- Pack publication, the pack lint lane, and SPEC receipts: packs are a
  family contract explained in [packs/README.md](./packs/README.md), not
  part of the shell's own deploy story.
- Server work: there is none. If your project needs a backend, that is a
  feature of YOUR project, not of this rig.
