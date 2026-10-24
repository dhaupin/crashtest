# labs/TASKS.md - the rolling work log

One file, appended per landing/session, newest last, with receipts (files,
gates, SHAs). The house law this file serves: **the log is the memory** -
the next agent should never guess what happened. Conventions live in
[../AGENTS.md](../AGENTS.md); versioned product changes also get a
[CHANGELOG.md](../CHANGELOG.md) entry in the same commit.

## Open asks (carry forward until landed)

- _none yet - the 0.9.0 scaffold cut is the first entry below._

---

### 2026-10-24 - 0.9.0 scaffold cut (the shell extracted from crashtest @ 905aa91)

- The rig was extracted, not written from memory: every file is either a
  byte-exact copy or a small genericization of a deployed, verified surface
  - the per-file receipts live in [../MANIFEST.md](../MANIFEST.md)
  (extraction SHA: dhaupin/crashtest@905aa91, which itself carried the
  theme-port + highlight work verified same-day: suite green, web prerender
  6/6 pages, docs deploy live).
- What landed: `web/` landing shell (light/dark switch, tokens-only palette,
  one nav vocabulary, islands engine), `docs/` Jekyll rig (pagefind search,
  shared Rouge token colors, freestruct SEO layer), five `scripts/` gates,
  two workflows (docs deploy with the hardened pagefind scrape + PINNED
  freestruct; npm OIDC release template), plus this log,
  [../CHANGELOG.md](../CHANGELOG.md) 0.9.0, the
  [../packs/README.md](../packs/README.md) contract, and the three
  crosslinked core docs ([../README.md](../README.md) /
  [../AGENTS.md](../AGENTS.md) / [../DEPLOY.md](../DEPLOY.md)).
- Verification receipts (run on the extracted rig, not the source): all five
  docs gates PASS against the generic `docs/` (1 sample page), fresh
  `npm install` + `prestruct build` prerendered the shell clean (1/1
  pages, zero JSX warnings), `web/public/icon.svg` and `docs/icon.svg`
  verified byte-equal (the two-surface brand contract).
- Deliberately left for adopters (documented, not shipped): PNG icon slots +
  `og-image.png` (referenced in `site.webmanifest`), the docs sidebar data
  (`docs/_data/nav.yml` - one group/`items` shape, see the sample page),
  and any pack content (`packs/public/` stays empty in the shell).
- First release path (manual, per [../DEPLOY.md](../DEPLOY.md)): bump check
  -> `v0.9.0` tag -> OIDC publish -> GitHub release from the tag with the
  changelog entry as its body.
