# horcrux

## What this folder is

This directory holds a *horcrux*: a whole-agent-memory backup sealed by
[Vant](https://github.com/dhaupin/vant). It is not source code - tests,
tooling, and CI never read it. It exists so a fresh contributor or agent
session can restore the accumulated working memory of *building and
maintaining this repository*, on demand, from the tool.

| File | What it is |
|---|---|
| `crashtest-p_quillstone-9fold.svg` | The sealed `crashtest` brain (v0.8.6 `steganography` format, ~866KB): the brain content encrypted into an SVG image. |

**The password is in the filename, by convention** - the vant horcrux
filename grammar is `<agent>-p_<password>.svg`, and the text after
`p_` is the decryption key. For this stone that password is
`quillstone-9fold`. That is deliberate: these stones travel in
repositories, where anyone should be able to restore them; the brain
carries no secrets, so the filename publication is an ease-of-recovery
choice, not a leak. (Vant also supports env-var and prompt resolution
when you would rather keep a password out of a filename.)

## What vant is

[Vant](https://github.com/dhaupin/vant) (docs:
`https://docs.creadev.org/vant`) is **agent memory that lives in your
own repo**: markdown brain files under `models/public/<brain>/` and
`models/private/<brain>/`, with an MCP door, a memory store, semantic
search, and horcruxes for whole-brain backup/restore. Horcruxes are
vant's own feature for that purpose - a whole-brain snapshot, encrypted
and restorable anywhere.

The `crashtest` brain is one of those brains: the dev-brain for this
project's agent line.

## What the `crashtest` brain carries

Sealed 2026-10-21 as `v1.0.0` packaging-prep. The stone was created
with vant's default "all brains" gather; on a virgin vant clone the
restore brings back **13 files to crashtest (both scopes)** - verified
end-to-end against a clean clone before commit. The brain is
OSS-readable on purpose (nothing secret is ever stored in it), and it
holds:

- `identity.md` - what crashtest is, the stance (attack code, not
  people; no sockets ever; fail loudly; same commit -> same findings).
- `goals.md` - the roadmap plus the tracked post-v1 gap backlog.
- `structure.md` - the full repo map (src/harness, scenario library,
  packs, fixtures, web, docs, labs, test pins).
- `state.md` - the sealed-at point in time: branch/commit, gate
  receipts (suite 176/176, web build 6/6, dogfood ledger 30/30
  REFUSED), plus the exact reruns to re-verify them on wake.
- `lessons.md` and `errors.md` - the earned rules and the mistakes
  they bought (seed-derived everything, exact pins not ceilings,
  9x6=54 spoof variants, no fiction in docs).
- `workflow.md` and `pins.md` - how work happens, and the full
  inventory of where every hard guarantee is pinned in the test suite.
- `terms.md` - the project dialect.
- `boot.md` and `onboarding.md` - the wake sequence and a 10-minute
  contributor onboarding.
- `models/private/crashtest/notes.md` - the private-scope working
  notes (still written with nothing secret, deliberately).

To read the brain files directly (no restore needed), the tool's own
storage is Markdown-based: every file named above is plain, readable
text - the stone is privacy-encapsulated, but the content itself is
meant to be easily reviewed.

## How to restore

1. Install vant: clone
   [dhaupin/vant](https://github.com/dhaupin/vant) and follow its
   quick start README (`npm ci` inside the clone).
2. Restore the stone into that install:

   ```bash
   cd /path/to/your-vant-clone
   VANT_BRAIN_PASSWORD='quillstone-9fold' \
     node ./bin/vant.js horcrux restore /path/to/crashtest-p_quillstone-9fold.svg
   ```

   (Or drop the `<agent>-p_<pw>.svg` file into
   `models/public/crashtest/boot/` of the vant install: the filename
   convention resolves the password, and vant auto-finds boot stones.)

3. In the restored install, the brain lands at
   `models/public/crashtest/` (and private notes at
   `models/private/crashtest/`), and the install's brain state
   (`models/state.json`) wakes pointing at `crashtest`
   (`currentBrain: "crashtest"`) - plain `vant` commands resolve to
   this brain with no env needed. (Sealed 2026-10-21 re-seal; the
   vant default brain is still reachable via `VANT_BRAIN=vant`.)
   Start with `boot.md`, which names the wake-up sequence.

## Maintenance

- To change the brain: edit the markdown in a vant install's
  `models/public/crashtest/` (and `models/private/crashtest/notes.md`
  for the private scope), then re-seal with `vant horcrux create` (or
  `vant horcrux refresh` for the in-place regeneration path) and drop
  the fresh stone into this folder with the new `p_<password>`
  composition in the filename.
- Update this README in the same change when the file name or the
  password changes - it is the map, and it must not lie.
