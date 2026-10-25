---
permalink: discussions
layout: default
title: Release Posts
description: The release-post system - one announcing-vX.Y.Z.md per release, discussions-ready, lint-gated like every other docs surface.
---

# Release posts

One post per release, shaped like prestruct's [announcing-v1.0.0](https://github.com/dhaupin/prestruct/blob/main/docs/discussions/announcing-v1.0.0.md). The post lives in `docs/discussions/` as versioned source so the release trail is in the same tree as the changelog it summarizes, and the file's raw markdown IS the GitHub Discussions announcement - view source, copy, strip the frontmatter, post.

## The conventions

- **One file per release, named after it.** `announcing-vX.Y.Z.md`, matching the npm version on the day the post is drafted. Never reuse a filename; if a release gets a retry, fold the delta into the same post instead.
- **Frontmatter contract.** Same four required fields every docs page gates on (`permalink`, `layout`, `title`, `description`) plus `version`. The permalink is `discussions/announcing-vX.Y.Z`.
- **The file IS the post.** No wrapper prose, no nested copy block: below the frontmatter the file carries the announcement body itself, so the source of the doc is the source of the post. To publish, copy the raw markdown from GitHub (view source on the file) into the Discussions announcement, stripping ONLY the four frontmatter lines at the top (routing metadata the docs build needs, not forum content). The posting mechanics live in this index, not in the posts themselves - the post body should stand alone in a forum.
- **Voice and facts.** Same rules as everywhere else in the docs: the dry hyphen voice ([about/style](../about/style)), no marketing language, no cliches, and every number and claim verified against the CLI, the committed pins, or the npm registry before it lands. Rule 7: if you cannot run it, do not write it.
- **Timing.** Draft the post against the released version, not the dev tree: cite what shipped in the npm tarball, and keep in-tree-only work (unreleased changelog rows) out of it. A post describing a version that is not on npm yet is fiction by promotion.
- **Gates.** `npm run lint:docs` runs on these files like everything else - fence language tags, heading levels, table shape, the dash and cliche scans. The fiction-signature scanner and the docs link checker apply too.

## The index

| post | version | live |
| --- | --- | --- |
| [Announcing crashtest v1.0.0](./announcing-v1.0.0) | 1.0.0 | 2026-10-21 on npm |
| [Announcing crashtest v1.1.0](./announcing-v1.1.0) | 1.1.0 | 2026-10-25 on npm |

History: prestruct pioneered the format ([v1.0.0](https://github.com/dhaupin/prestruct/blob/main/docs/discussions/announcing-v1.0.0.md), [v1.1.0](https://github.com/dhaupin/prestruct/blob/main/docs/discussions/announcing-v1.1.0.md)); crashtest adopts the same shape so approaches to the community discussion stay uniform across the creadev family.
