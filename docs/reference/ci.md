---
permalink: reference/ci
layout: default
title: The CI Battery
description: How crashtest's own CI gate is wired - the leg order, the packstruct pack lane, the family-status emit, the baseline discipline, and a when-red triage map.
---

# The CI Battery

Crashtest gate-crashes its own repo too. This page documents what
`.github/workflows/ci.yml` actually does, leg by leg, so an operator reading
a red run knows which rule bit them. The receipts rule applies to this
documentation the same way it applies everywhere else in the family: if
code and prose ever disagree, the code wins - and this page says so.

## The legs, in order

1. **Install** - `npm install --no-audit --no-fund`. The repo carries zero
   runtime dependencies; the dev-side `packstruct` pin is the one registry
   fetch and it is EXACT (`"packstruct": "1.0.0"`, no float).
2. **Syntax check** - `npm run check`: a `node --check` chain over every
   source file, every pack bank, the harness, and the script surface
   (including the family status emitter and the copied
   `scripts/ship-from-download.cjs`).
3. **Docs gates** - `npm run lint:docs`: frontmatter, links, style,
   fiction signatures, and Jekyll-filter shards, five gates one command.
4. **The packstruct pack lane** - `npx --no-install packstruct lint packs`
   over THIS repo's pack corpus, plus
   `labs/packstruct-backfill/verify-spec.mjs` re-deriving the SPEC
   transcript from the exact-pinned linter's own `spec/SPEC.md` - the
   no-clone lane: same commit -> same findings applies to the linter too.
5. **Family status emit** - `node web/scripts/build-status.mjs`
   regenerates `web/public/status.json` from the committed ledgers
   ([the dialect page](/crashtest/reference/status)); gitignored,
   regenerated, never hand-edited.
6. **The web build** - the site ships from `web/`; the build also produces
   the prerendered artifacts the site pack's HTML/sitemap attacks need
   (that pack degrades to honest skips when the build is absent).
7. **Test suite** - `npm test` (`node --test`), which includes the dogfood
   baseline double-run pin and the packaging probe.
8. **The dogfood** - `crashtest run` attacks this repo's own demo fixture
   against the committed `labs/crashledger.json` baseline. This leg IS the
   CI contract: nonzero iff a previously-REFUSED check regressed or a NEW
   EXPLOITED finding appears.

## The `--lint-packs` preflight

Before any run can waste a campaign on pack-shaped noise, `crashtest run
--lint-packs` (and every shipped pack's own test battery) runs the
[packstruct](https://github.com/dhaupin/packstruct) shape lint plus the
loader's own checks (invalid manifests and pack-shaped footguns refuse by
name - see the `[lint-packs]` verb help). `[lint-packs]` is opt-in at the
CLI - attacks only grade through it explicitly - and an explicit dir passes
through untouched. The full rules ride
[the packs reference](/crashtest/reference/packs).

## The baseline discipline

`labs/crashledger.json` is committed, and the [ledger
page](/crashtest/reference/ledger) is its document. The only time a refusal
row legitimately refreshes is WITH the behavior change that moved it: you
changed the fixture or the campaign on purpose, you re-run
`crashtest run` in the SAME commit, and the ledger lands with the edit -
never on a later "clean up the ledger" pass. `labs/run-meta.json` is the
one churn-by-design sidecar; the artifacts never move and the double-run
test in the suite pins exactly that.

## When it is red: the triage map

| Failure shape | What it names | Where the rule lives |
|---|---|---|
| `NEW exploited finding` in the dogfood | a handler started serving what it used to refuse | [exit rules](/crashtest/reference/exit-rules) - the two exit causes |
| `REGRESSED` row | a REFUSED baseline row flipped to EXPLOITED | [exit rules](/crashtest/reference/exit-rules) |
| a pack lane VIOLATION | manifest shape, not behavior | [packs](/crashtest/reference/packs) + packstruct SPEC |
| `verify-spec` mismatch | the packed linter's SPEC and the pinned transcription disagree | the battery README in `labs/packstruct-backfill/` |
| a docs gate | links/frontmatter/style/fiction | the five gate scripts in `npm run lint:docs` |
| the family island RED | THIS repo's ledgers say so - not the island's opinion | [family status](/crashtest/reference/status) |

## What red never means

CI red is never "the harness guessed". Undeclared routes degrade to
skipped-REFUSED rows, never false positives; an unknown verdict is a loud
runner error, never a silent count; and accepted risks carry an owner and
a bound or they do not count as accepted. If a row's red is NOT explained
by one of the shapes above, it is a bug in the harness - file it.
