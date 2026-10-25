---
permalink: index.md
layout: default
title: Your Site
description: Plain two-sentence description of your project - this page proves the docs rig builds, searches, and highlights.
nav_order: 1
---

# Your Site

This is the flowforge docs shell. One sample page so the frontmatter gate,
the link check, and the Rouge engine all have real bytes to chew on - replace
it with your pages and keep the four required frontmatter fields
(permalink, layout, title, description) on every page.

## Highlighting works out of the box

```js
const hello = 'world'   // strings go green via the shared token block
if (hello === 'world') { // keywords go accent
  console.log(`shell says ${hello}`)
}
```

```bash
# build + deploy the docs rig
bundle exec jekyll build
./pagefind --site _site
```

## The sidebar nav

Sidebar sections come from `docs/_data/nav.yml`: a list of groups, each
with a `title` and an `items` list of `{title, url}` entries. The shipped
starter nav links only pages the shell actually carries (this page and the
release-posts index) with exemplar rows commented - replace it with yours
as your pages land.
