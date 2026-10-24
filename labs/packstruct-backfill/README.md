# packstruct-backfill - the offline self-audit fixture corpus

The prepared half of ask #2 from the packstruct adoption notice
([dhaupin/packstruct#1](https://github.com/dhaupin/packstruct/issues/1)),
with the sequencing agreement recorded in
[dhaupin/crashtest#20](https://github.com/dhaupin/crashtest/issues/20) on
file: **fixtures transcribe, never invent.** Consequently all three files
here are committed artifacts (like the ledger), and none of them contains a
made-up pack shape:

| file                   | what it is                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `corpus.json`          | byte-exact transcription (raw string + sha256) of every shipped `packs/public/<name>/pack.json` - the real-world corpus packstruct can lint against and crashtest can diff against forever. |
| `conformance-rows.json`| the per-pack frozen-v1 conformance facts (required keys, optional host-owned keys, name == dir, declared entry exists), re-derived from the same bytes. |
| `refusal-matrix.json`  | 19 refuse + 4 accept rows, each derived from an actual engine rule and **cited** (`hostRule`), applied by `test/packstruct-backfill.test.js` to a real corpus manifest (`next-middleware-shapes`); every row's `specKey` names the SPEC v1 section/terms it transcribes (filled 2026-10-24 against the byte-exact `SPEC-v1.md` transcript). |
| `SPEC-v1.md`           | byte-exact copy of dhaupin/packstruct's `spec/SPEC.md` at the spec commit `b0e305034c974ad133b83e3b1c3cb27094d1de46` (2026-10-24; the SHA is the transcription's provenance) - the vocabulary every `specKey` resolves against; verify with `node labs/packstruct-backfill/verify-spec.mjs node_modules/packstruct` (or a checkout path). |

## Rules of the folder

1. **Regenerate, don't hand-edit** the two generated files:
   `node labs/packstruct-backfill/build.mjs` (deterministic - same worktree
   gives byte-identical output; no wall clock anywhere). A regenerate that
   changes bytes means a pack changed: review the diff, move the count pins
   in `test/packstruct-backfill.test.js` in the SAME commit.
2. **specKeys cite the committed SPEC v1 transcript, never memory.** SPEC v1
   became addressable on 2026-10-24 (packstruct landed its SPEC at
   `spec/SPEC.md`), so the placeholder era is over: the fill transcribed it
   instead - the byte-exact copy lives at `SPEC-v1.md`, pinned to
   dhaupin/packstruct@`b0e305034c974ad133b83e3b1c3cb27094d1de46`, and every
   matrix row's `specKey` (`"<section>/<term>[/<term>...]"`) must resolve
   verbatim against that transcript in the pin test. Bumping the pin means a
   re-transcribe + specKey re-review in the same commit
   (`verify-spec.mjs` is the check, CI runs it right beside the lint lane).
   Install shape (2026-10-24, once packstruct published): the exact
   devDependency `"packstruct": "1.0.0"` in package.json - no float; the
   npm wrapper ships the same `spec/SPEC.md` path, so the verify reads it
   straight out of node_modules. The SHA above stays as the transcript's
   provenance.
3. **Every matrix row carries a `hostRule` receipt** naming the engine
   function and message fragment it was derived from. A row whose rule moved
   fails its pin test with instructions to re-derive from the NEW validator
   text - never to bend the row to silence the failure.
4. **Zero sockets, zero network.** The whole corpus reads the repo's own
   files. The census test re-derives the #19 audit receipt live (8 pack
   modules / 36 pack attacks / 44 ids total, zero collisions against the
   49-attack 14-module library, zero collisions pack-vs-pack).

## The load-level rows

Three refusals cannot be expressed as manifest mutations (they need a
filesystem): unreadable JSON, cross-surface pack name collision, and an
un-importable entry. They live in the pin test as temp-dir happy-work when
they fail, loudly, with the engine's message fragments pinned.
