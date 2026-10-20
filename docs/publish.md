# Publishing crashtest

## The one-time bootstrap (manual, ~5 minutes)

npm Trusted Publishing (OIDC) cannot create a new package — the first version
must exist on npmjs.com first. So:

1. On your machine, from a checkout of `dhaupin/crashtest`:
   ```bash
   npm login            # if not already
   npm test             # should be green
   npm publish          # publishes 0.0.1 as `crashtest`
   ```
   (npm 2FA applies per your account settings.)

2. On npmjs.com → package `crashtest` → **Settings → Trusted Publisher**:
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
