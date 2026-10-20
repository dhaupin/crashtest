---
permalink: about/style
layout: default
title: Voice & Style
description: Writing rules for crashtest content - the hyphen-voice, no-emoji-except-verdicts, no-cliches, and the frontmatter contract docs gate on.
---

# Voice & style

Writing rules for crashtest content. These are not taste suggestions - four
of them are enforced by `scripts/check-docs-style.cjs` (run in CI via
`npm run lint:docs`), and the fiction ones by
`scripts/check-fiction-signatures.cjs`. The enforced ones are marked.

## Tone

Engineers writing for engineers, many of them agents. Clear, direct,
slightly informal when appropriate, serious when the exit rules matter.
We are transparent that AI agents build and attack this project.

## Enforced rules

### 1. Hyphen-only dashes (ENFORCED)

Use the plain hyphen `-` in prose. No em dashes, no en dashes. The corpus
was converted in one pass (150 dashes, 2026-10-20); a violation is a
regression, not a style preference.

| Right | Wrong |
|---|---|
| "CI is the wall - it never forgets" | "CI is the wall - it never forgets" |

### 2. Glyphs: verdicts and arrows only (ENFORCED)

Emoji are banned except two carve-outs that are content, not decoration:

- the verdict marks: shield REFUSED, bolt EXPLOITED, lock BOUNDED (product
  vocabulary - they name actual verdict states)
- the technical arrow for flow notation ("same commit, same findings" style
  chains), same class as `>=` or infinity

Everything else - dingbats, emoji blocks, reaction glyphs - fails the gate.
Glyphs inside `inline code` are literal data and exempt.

### 3. Code fences carry a language tag (ENFORCED)

Every opening fence names its language. Closing fences stay bare.

```console
$ npx crashtest run --module-plan
```

Directory trees and diagrams use `text`. Why: pagefind indexes fence
content better with a language hint, and a bare fence is usually a
forgotten stash.

### 4. Table shape (ENFORCED)

Pipe-table rows start and end with `|`. Headings never swallow cells.
A bullet that ends in `|` is broken-table residue and fails.

### 5. Structure

No heading level skips (h2 to h4). No trailing whitespace, no tabs.

## Fiction rules (ENFORCED by the signature gate)

Wrong claims this project has actually caught become regex signatures the
moment they surface twice. Current set:

1. `npm install -g` crashtest - install is per-repo; a global install lies
   about where `labs/` lands. Docs say `npm install crashtest` in the repo,
   or `npx crashtest`.
2. "No dependencies" claimed of the web app - the zero-deps law is the
   CLI runtime; `web/` legitimately ships vite + react.
3. Anything describing sockets, live-fire, or a network mode as supported
   or enabled - there is no such mode anywhere on any surface, by design.
4. Forward-dated release claims - "shipped in 1.1" when package.json says
   1.0.0. PRD-labeled future work says "planned", never "shipped".

A line that debunks a signature ("no sockets, ever") is the gate doing its
job in prose, not a violation.

## Not (yet) enforced, but wanted

- Active voice, present tense. "The CLI loads the brain" not "the brain is
  loaded by the CLI".
- Specific over abstract. "Crashtest attacks your real handlers in-process"
  not "crashtest elevates your QA workflow".
- No AI cliches: `delve`, `leverage`, `unlock`, `seamless`, `empower`, `journey`,
  `realm`, `game-changer`, `cutting-edge`, `revolutionary` - the enforced
  ban list lives in the style gate; add a phrase when it surfaces twice.
- Every code block gets a one-sentence brief before it.
- Descriptive link text - the link's target in words, never `click here`.

These are enforced as of this iteration - the cliche list is hard-fail in
the style gate (the enforceable list above quotes the banned words as code
spans, the same carve-out inline code gets everywhere).

## The docs frontmatter contract

Every page in `docs/` carries all four fields (gated by
`check-docs-frontmatter.cjs`):

| Field | Required | What |
|---|---|---|
| `permalink` | yes | Plain baseurl-relative path (`reference/packs`). The site composes `/crashtest/<permalink>`. A leading slash or a baked-in `/crashtest` is the doubled-URL fiction class - the gate rejects it. `/` is reserved for the docs home. |
| `layout` | yes | `default` |
| `title` | yes | Display title |
| `description` | yes | One line for meta/og/search |

Sidebar ordering lives in `docs/_data/nav.yml`, not in frontmatter. A page
not listed in `nav.yml` is unreachable by the menu - add it there.

## Source of truth

`docs/` is the source of truth for product documentation. `README.md`
references docs; docs do not lean on README. Corrections that change what
the CLI does change the CLI first, then docs, then (if the claim repeated)
the fiction-signature gate.
