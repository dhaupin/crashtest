---
permalink: reference/cli
layout: default
title: CLI Reference
description: Every crashtest command, flag and exit code - verified against the shipped binary.
---

# CLI Reference

Every verb, every flag, nothing else. This page is hand-kept to
`crashtest --help` - when they disagree, run `--help` (version-suffixed
output) and report the page. The docs fiction scan and the web docs
consistency probe hold this page to that rule.

## `crashtest init [--force]`

Scaffold the run root: `labs/crashledger.json` + `labs/hardening.md`
stubs, plus `packs/public` / `packs/local` directories. First run also
appends `packs/local/` to `.gitignore` (private packs stay on your
machine; `packs/public/` is tracked and sharable). Re-running without
`--force` refuses to stomp an existing baseline.

## `crashtest run`

Attack the target declared in `crashtest.config.js`. Writes
`labs/crashledger.json` + `labs/hardening.md` on success - that is how a
baseline is cut. Flags:

| Flag | What it does |
|---|---|
| `--config <path>` | Target a config other than `./crashtest.config.js`. |
| `--allow-vacuous` | Configless root: one honest vacuous-run line + exit 0, for pre-handler shells that adopt the pinned install before they have handlers. WITHOUT the flag, a missing config stays a hard exit 2 - the default never silently greens. |
| `--json` | Append the machine run blob to stdout (last line). |
| `--module-plan` | Dry-run: which attack ids WOULD fire (exit 0 always). NEEDS-ARMING rows mean a pack wants `moduleCtx['<key>']` in your config; at run time they refuse-skip, never false-positive. |
| `--expect-baseline <path>` | Diff against a given ledger WITHOUT touching `labs/` (read-only CI/hosted mode; exit rules unchanged). |
| `--out-dir <dir>` | ALSO write run-blob.json + crashledger.json + hardening.md copies into dir (artifact fan-out; the repo's `labs/` rules are untouched). |
| `--lint-determinism` | The determinism grep INSTEAD of the campaign (same lane as the `lint-determinism` verb). |
| `--lint-packs` | The packstruct lint INSTEAD of the campaign (same lane as the `lint-packs` verb). |

## `crashtest packs`

List discovered packs (public + local), env claims shown, unmet lines
rendered. Flags:

| Flag | What it does |
|---|---|
| `--config <path>` | Honor the config's `packs:` knob. |
| `--json` | Machine inventory (versions, armedByKey, npm pkg) - last stdout line. |
| `--allow-vacuous` | Configless root: honest vacuous line + empty listing, exit 0 (a CI row can pass the flag to both verbs). |

### `crashtest packs add <name> [--public]`

Scaffold a fresh pack. Local + gitignored by default; `--public` makes it
tracked and sharable. A fresh pack's manifest carries the placeholder
description `TODO: one line on what <name> attacks` - write a real one
before shipping the pack.

## `crashtest lint-determinism [--config <path>] [dirs...]`

Grep the DECLARED sources (config `scenarioDirs` + packs roots, or
explicit dirs) for wall-clock / unseeded-randomness tokens (`Date.now`,
`new Date(`, `Math.random`). Findings exit 2 naming file:line. The
determinism law, enforced at the door: same commit -> same findings.

## `crashtest lint-packs [--deep] [--json] [--against <lib>] [dir]`

Lint the packs root against the packstruct packs spec (`schemaVersion: 1`,
name/dir match, entry ships, dotted version). Opt-in passthrough to the
packstruct binary THIS REPO has installed (`node_modules/.bin`, then
`PATH`) - never downloads one. Default dir is the packs root, NEVER
`packs/public` (packstruct's contract root is `<dir>/` with its
public/local children). `packstruct` not installed where the flag/verb is
explicitly asked = exit 2 naming the fix: `npm i -D packstruct@<exact>`.

## `crashtest preset <name> [--root <dir>]`

Generate a starter config for an agent-builder export (lovable, bolt,
replit) from what is ACTUALLY in the repo - never a guess. Usage without
a name prints the usage line.

## `crashtest --version`

Print the single-string version. `-v` and `version` are synonyms.

## Exit codes (the CI contract)

| Code | Meaning |
|---|---|
| 0 | Baseline held (nothing new weak, nothing old broke). |
| 1 | NEW EXPLOITED finding, or a REFUSED -> EXPLOITED regression. |
| 2 | Config problem (missing/bad config or baseline) - the run is wrong, not your code. |

Full semantics in [Exit Rules](/crashtest/reference/exit-rules).
