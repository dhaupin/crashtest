---
permalink: discussions/index.md
layout: default
title: Release Posts
description: The release-post system - one announcing-vX.Y.Z.md per release, discussions-ready, lint-gated like every other docs surface.
---

# Release posts

One post per release, shaped like the family exemplar
([prestruct's announcing-v1.0.0](https://github.com/dhaupin/prestruct/blob/main/docs/discussions/announcing-v1.0.0.md)).
The post lives in `docs/discussions/` as versioned source so the release
trail is in the same tree as the changelog it summarizes, and the file's raw
markdown IS the announcement - view source, copy, strip the frontmatter, post.

## The conventions

- **One file per release, named after it.** `announcing-vX.Y.Z.md`, matching
  the npm version on the day the post is drafted. Never reuse a filename;
  if a release gets a retry, fold the delta into the same post instead.
- **Frontmatter contract.** Same four required fields every docs page gates
  on (`permalink`, `layout`, `title`, `description`) plus `version`. The
  permalink is `discussions/announcing-vX.Y.Z`.
- **The file IS the post.** No wrapper prose, no nested copy block: below the
  frontmatter the file carries the announcement body itself, so the source of
  the doc is the source of the post. To publish, copy the raw markdown from
  GitHub (view source on the file) into the discussion announcement,
  stripping ONLY the frontmatter at the top (routing metadata the docs build
  needs, not forum content). The posting mechanics live in this index, not
  in the posts themselves - the post body should stand alone in a forum.
- **Voice and facts.** The same rules every page here gates on (the
  style/voice checker plus the fiction-signature scanner): no marketing
  language, and every number and claim verified against the shipped artifact
  before it lands. If you cannot run it, do not write it.
- **Timing.** Draft the post against the released version, not the dev tree:
  cite what shipped in the npm tarball, and keep unreleased changelog rows
  out of it. A post describing a version that is not on npm yet is fiction
  by promotion.
- **Gates.** `npm run lint:docs` runs on these files like everything else -
  frontmatter, heading levels, the dash and cliche scans, fiction
  signatures, and the Jekyll filter trap.

## The index

| post | version | live |
| --- | --- | --- |
