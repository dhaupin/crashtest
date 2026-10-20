# Publishing crashtest

## The one-time bootstrap (a few minutes)

npm Trusted Publishing (OIDC) cannot *create* a new package (npm/cli #8544 is
still open) — the package name must exist on npmjs.com before OIDC takes over.
Since 2026-10-02 there are two ways to create it
([staged publishing](https://docs.npmjs.com/staged-publishing/) supports
new-package creation):

**Route A — direct publish (simplest):**
   ```bash
   npm login            # if not already
   npm test             # should be green
   npm publish          # publishes 0.0.1 as `crashtest`
   ```

**Route B — staged publish (release goes through a maintainer approval):**
   ```bash
   npm login            # logged-in session, or a stage-only granular token
   npm stage publish    # creates the package + a 0.0.0-stage placeholder
   ```
   The name + title are visible immediately; contents release after approval
   (staged publishing requires npm >= 11.15.0).

3. Then configure Trusted Publisher: npmjs.com → package `crashtest` → **Settings → Trusted Publisher**:
   - Provider: **GitHub Actions**
   - Organization/user: `dhaupin`
   - Repository: `crashtest`
   - Workflow filename: `publish.yml` (filename only, not the path)
   - Leave **direct `npm publish` allowed** enabled (configs created after
     2026-09-03 default to `npm stage publish`; publish.yml runs direct publish).

## Every release after that (automatic)

```bash
npm version patch -m "release: v%s"   # or minor/alpha manually
git push origin main --follow-tags    # pushes the v* tag
```

CI (`.github/workflows/publish.yml`) runs tests and publishes with OIDC —
**no NPM_TOKEN secret is stored anywhere**. Provenance is generated
automatically because the repo is public and `repository.url` matches.

## Rules

- Only publish from version tags, never from `main` directly.
- The `files` field limits the tarball to `bin/` + `src/` (tests and labs stay out).
- Verify a release with `npm view crashtest@<version>` (or `npm pack --dry-run`).
