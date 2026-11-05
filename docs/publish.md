---
permalink: publish
title: Publish
layout: default
description: Maintainer runbook - npm Trusted Publishing (OIDC), the one-time bootstrap, and the tag-driven release flow.
noindex: true
---

# Publishing crashtest

## The one-time bootstrap (a few minutes)

npm Trusted Publishing (OIDC) cannot *create* a new package (npm/cli #8544 is still open) - the package name must exist on npmjs.com before OIDC takes over. Since 2026-10-02 there are two ways to create it ([staged publishing](https://docs.npmjs.com/staged-publishing/) supports new-package creation):

**Route A - direct publish (simplest):**
   ```bash
   npm login            # if not already
   npm test             # should be green
   npm publish          # publishes 0.0.1 as `crashtest`
   ```

**Route B - staged publish (release goes through a maintainer approval):**
   ```bash
   npm login            # logged-in session, or a stage-only granular token
   npm stage publish    # creates the package + a 0.0.0-stage placeholder
   ```
   The name + title are visible immediately; contents release after approval (staged publishing requires npm >= 11.15.0).

3. Then configure Trusted Publisher: npmjs.com -> package `crashtest` -> **Settings -> Trusted Publisher**: - Provider: **GitHub Actions** - Organization/user: `dhaupin` - Repository: `crashtest` - Workflow filename: `publish.yml` (filename only, not the path) - Leave **direct `npm publish` allowed** enabled (configs created after 2026-09-03 default to `npm stage publish`; publish.yml runs direct publish).

## Every release after that (automatic)

```bash
npm version patch -m "release: v%s"   # or minor/alpha manually
git push origin main --follow-tags    # pushes the v* tag
```

CI (`.github/workflows/publish.yml`) runs tests and publishes with OIDC - **no NPM_TOKEN secret is stored anywhere**. Provenance is generated automatically because the repo is public and `repository.url` matches.

The same tag drives the full **release ladder** (`.github/workflows/publish.yml`), three jobs:

1. **publish** - npm trusted publishing (OIDC). The gate refuses a 0.x version (the family release ladder: 0.x is the manual ship lane) and, on a tag push, refuses a tag that does not equal the packaged version. The battery rides automatically (`npm publish` runs `prepublishOnly` -> `npm test && npm run check`), so a red battery cannot mint a tarball.
2. **release** - the GitHub Release (title `Crashtest vX.Y.Z`) is cut from the tag with notes **extracted from the changelog's own `[version]` section** (`scripts/release-notes.cjs`; an empty extraction refuses the cut). It is idempotent, and it attaches the **served** tarball (`npm pack crashtest@<version>`) - the exact bytes the registry serves, so the release asset and the npm artifact are the same bytes.
3. **verify** - the post-publish truth (`scripts/verify-release.cjs`): the registry's latest equals this tree's version, the served tarball's sha512 equals the registry integrity metadata, provenance is present, then the full pack ladder on the served tarball; `--gh` asserts the release targets the tag's commit and that its attached asset's sha512 equals the registry integrity. A green publish step asserts nothing about the published truth - the verify job does.

Nothing to do by hand. A `workflow_dispatch` **verify-only** mode re-runs the trust ladder against what is already published and released (no minting), the on-demand re-proof of a cut.

## Rules

- Only publish from version tags, never from `main` directly.
- The `files` field limits the tarball to `bin/` + `src/` + the eight reusable packs (`wp-money-shapes`, `wp-stock-smoke`, `wp-roles`, `cve-feed`, `qs-shapes`, `vite-dev-shapes`, `next-middleware-shapes`, `egress-guard-shapes`) - tests, labs, `web/` and the repo-bound `crashtest-site` self-dogfood pack stay out (pinned by `test/packaging.test.js`, same surfaces the verify ladder enforces on the served tarball via `--allowed packs/`).
- Verify a release with `npm view crashtest@<version>` (or `npm pack --dry-run`).
