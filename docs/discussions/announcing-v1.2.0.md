---
permalink: discussions/announcing-v1.2.0
layout: default
title: Announcing crashtest v1.2.0
description: The crashtest v1.2.0 release post - the file IS the announcement; copy the raw markdown from GitHub into Discussions. Technical, changelog-style.
version: 1.2.0
---

# crashtest v1.2.0

> **DRAFT - pre-publication.** v1.2.0 is on `main` and not on npm yet. The
> release-post timing rule (no fiction by promotion) applies until the
> `v1.2.0` tag lands. Remove this banner the moment it does, and flip the
> index table's `live` column to the npm date.

crashtest is seeded, in-process adversarial QA for agent-built app code.
v1.2.0 is the second minor release, and it is also additive: new opt-in CLI
surfaces, a packstruct lane that arrives at publishable shape, a grown
WordPress adapter, and the honest-skip discipline carried end to end
through the attack library, the runner, and the dashboard. This post ships
with the v1.2.0 tag: npm has the tarball by the time you read it.

```bash
npm i -g crashtest
# or run without installing:
npx crashtest init
npx crashtest run
```

## Opt-in by flag, never green by default

Configless roots get one honest path: `run --allow-vacuous` prints a single
vacuous-run line and exits 0 - the pre-handler-shell adoption pattern, for
an agent repo that adopts the pinned install before it has handlers to
attack. `packs` takes the same flag (an honest empty listing, exit 0), so a
CI row can pass it to both. WITHOUT the flag, a missing config stays a hard
exit 2 - the default never silently greens (issue #37).

## The packstruct lane, publishable

`crashtest lint-packs [--deep] [--json] [--against <lib>] [dir]` is the
opt-in passthrough to the packstruct binary this repo has installed, and
`crashtest run --lint-packs` runs the same lane as a campaign preflight (no
requests, no artifacts). The default dir is the packs ROOT, never
`packs/public` - packstruct's contract root is `<dir>/` with its
public/local children, and guessing the other shape is the footgun this
flag pairing exists to prevent. Packstruct not installed where explicitly
invoked is an exit 2 naming the exact fix: `npm i -D packstruct@<exact>` -
the lane never downloads or bundles one. Two pack-facing contract additions
ride along, both additive: the loader's entry-shape enforcement grows a
defer option, and `ctx.config` arming is a TRUE config-class contract
(existing packs unchanged). And crashtest carries no version coupling to
packstruct's own release train - the lane is opt-in passthrough by design
(see packstruct#28 for the cross-repo adoption notes).

## The WordPress adapter grew up

The npm tarball ships the WP worker (issue #34), and the adapter's
vocabulary grew real teeth: internal-hook + WooCommerce-order ops over the
stub WP core, dual read-path meta, a hook-allow gate, and a status-hook
relay. Both armed WP e2e rows run end to end wherever PHP is available.
This round chain paid immediately: `wp-money-shapes` reached the actual
wire for the first time in its life, and five wire-shape mismatches died
in the same sweep - writes, seeds, and option envelopes forced through the
REAL dispatch instead of fixtures built around the pack.

## Honest skips everywhere

A skipped row keeps its name across the whole stack: the attack library's
undeclared-route rows carry `skipped: true` (issue #37's honest-skip flag,
now universal), the dashboard renders the flag instead of showing a skip
as a plain hold, and a supplied tally can no longer lie over its own rows -
the view model derives its verdict from the normalized rows and a
tally-vs-rows mismatch surfaces loudly instead of winning. BOUNDED still
demotes to a finding loudly without owner + bound; nothing smaller changed.

## The docs belt

The CLI finally has its reference page: `docs/reference/cli.md` lists every
verb and flag, verified against the shipped binary, nav-linked - and a
consistency pin makes a new CLI verb ILLEGAL to add without landing there
in the same commit. The attack catalog page enumerates all 8 shipped packs
with their real attack names and arming vocabularies; the /attacks site
page got the same pack table plus collapsible explainers; and the whole
docs tree went through a crosslinks audit (frontmatter contract, permalink
uniqueness, every relative, site-prefixed and GitHub-target link resolved,
anchors matched) until it was clean.

## The family lanes

The eyestruct receipt row is LIVE with its tree: eyestruct is on npm
(dhaupin/eyestruct, 0.9.0 published - whose own package already devDepends
on crashtest, the family consuming back), and the family-lanes receipt in
docs/reference/packs.md re-cut against the LIVE repo head the day the
pin moved - four packs linted CLEAN shallow and deep through the
exact-pinned packstruct 1.0.0 passthrough, their ledger verdict set
observed on disk ({REFUSED, PASSED, BOUNDED} - the same PASSED-means-
evidence bucket this release opens). The same "receipts, not asks" shape
the packstruct registry proposal carries (packstruct#25), with bump
receipts living there the day a pin moves. The init-wave coordination
(eyestruct live, poststruct still in its gistory staging lane, travels
chronicled at packstruct#22) is the ecosystem story this release rides.

## Walk-hardened, by number

- zero runtime dependencies, plain Node ESM + `node:test`, no build step to
  run or publish - unchanged, as always
- Node >= 18.17 - unchanged
- the library census is unchanged at 49 attacks / 14 modules, and the pack
  census at 8 packs / 36 pack attacks
- the test floor moves 317 (v1.1.0) -> 414, all from walk teeth and
  consistency pins, not from skipped rounds
- the determinism law holds: same commit -> byte-identical ledgers (the
  double-run check is in CI), and the seal now covers BOTH languages -
  the WP worker's PHP surface is inside the same artifact path the JS
  belt is sealed with

Full row-by-row trail: [CHANGELOG](https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md) - one bullet per walk round where the round earned it.

## Provenance

Releases publish from GitHub Actions via npm Trusted Publishing (OIDC) -
no publish tokens anywhere. Provenance attestations are signed
automatically; verify an install:

```bash
npm audit signatures
```

## Links

- npm: <https://www.npmjs.com/package/crashtest>
- Docs: <https://docs.creadev.org/crashtest>
- Site (built with the repo's own `/web`): <https://crashtest.creadev.org>
- Dashboard (render any ledger in-browser, zero backend): <https://crashtest.creadev.org/dashboard>
- GitHub: <https://github.com/dhaupin/crashtest>
- Full changelog: <https://github.com/dhaupin/crashtest/blob/main/CHANGELOG.md>
