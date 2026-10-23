---
permalink: reference/scenario-contract
layout: default
title: The Scenario Contract
description: The one shape every scenario module satisfies - run(harness, ctx) -> ONE record, verdicts, honest skips, ctx, and the harness API. Here instead of source.
---

# The scenario contract

This is the exact shape the seed libraries and every pack's scenario
modules satisfy - the four things a first-time author had to go read
`src/scenarios/contract.js` to find. Every claim here is verified against
the shipped CLI.

## 1. The module (the default export)

```js
export default {
  name: 'my-attacks',                     // kebab-case, unique across the campaign
  description: 'one line',                // required, shown in the report
  attacks: [{                             // required, non-empty
    name: 'my-attack',                    // kebab-case, unique within the module
    description: 'what it fires and what must hold',
    async run(harness, ctx) {             // verified + returns ONE record
      return { verdict: 'REFUSED', detail: 'defense held' };
    },
  }],
  // optional lifecycle hooks (one loud arming check instead of per-attack):
  beforeAll(ctx) { /* validate vocabulary ONCE, loudly */ },
  afterAll(ctx)  { /* optional: module teardown/notes */ },
};
```

Rules the loader enforces (a violation fails the run loudly, naming the
origin - never a silent gap):

- `name` and `attack.name` are kebab-case; duplicate attack names within a
  module are a load error, and the same module-name from two surfaces (pack
  vs `scenarioDirs` vs built-ins) is a collision error.
- `attacks` must be a non-empty array; each attack needs a `run` function.
- `beforeAll`/`afterAll` must be a function taking no second argument.
  They FIRE: `runCampaign` calls them once per module, around the
  module's attacks, with the module-level ctx (`moduleCtx[<name>]` +
  `seed`). A throw inside either hook fails the campaign at cause - that
  is the intended home for a pack's one-loud arming check (the pattern
  [sync-relay-shapes](https://github.com/dhaupin/gistory/tree/main/packs/public/sync-relay-shapes)
  uses to validate its vocabulary once instead of per attack).

## 2. The record - what `run()` returns

Exactly **one** record per attack. Shape:

```js
{ verdict: 'REFUSED' | 'EXPLOITED' | 'BOUNDED', detail, ...extra }
```

- **`REFUSED`** - the app's defense held (the good outcome).
- **`EXPLOITED`** - the attack achieved its goal, or broke the fuzz floor
  (a 5xx, or an uncaught throw the harness saw). A `run()` that itself
  throws becomes an "attack itself threw - harness-wide fault" EXPLOITED
  row, so you cannot hide a broken attack behind a crash.
- **`BOUNDED`** - an accepted risk. Requires **`owner` + `bound`** fields
  on the record; a BOUNDED without them is demoted to EXPLOITED by the
  campaign runner (PRD principle 6: a bound without an owner is a
  finding). The ledger file keeps accepted risks with their owner+bound
  and they never re-alarm.
- **`detail`** (string) - what the report shows for this row.
- **`extra`** - additional fields ride onto the row where they carry
  receipts: the runner copies `evidence` (or `violations` / `counts`) into
  the ledger finding. Use them; "trust me" is not a receipt.

### The honest skip

A target that doesn't declare the surface an attack needs (a route, a D1
binding, a KV store) is a config gap, not a failure - never a false
positive:

```js
if (!harness.listRoutes().includes(route)) {
  return { verdict: 'REFUSED', skipped: true,
           detail: `route "${route}" not declared on this target - skipped (declare it for coverage)` };
}
```

`skipped: true` marks skipped-REFUSED rows; `ctx.route`-style knobs in
your `moduleCtx` let run roots arm them later without code changes. The
[module plan](/crashtest/reference/module-plan) previews which of your
attacks WILL-FIRE vs NEEDS-ARMING before any run.

## 3. What `ctx` carries

The campaign runner assembles ctx per attack as a shallow merge:

```js
const ctx = {
  ...moduleCtx['your-module-name'],         // from the config's `moduleCtx:`
  ...attackCtx['your-module-name/your-attack'],  // optional per-attack override
  seed,                                      // campaign seed (default 0xC0FFEE)
};
```

That mapping is the whole contract: **the keys of `moduleCtx['<your pack
name>']` arrive directly on `ctx`** - `ctx.route`, `ctx.db`, `ctx.upload`,
whatever vocabulary your attacks expect. Missing keys degrade to a REFUSED
skip, never a false positive (`coverage follows the fixture`).

## 4. The harness (the one dispatch surface)

```js
harness.run(routeName, reqInit)   // -> record, see below
harness.listRoutes()              // -> [name, ...] - arming checks use this
harness.aliasRoute(name, source, { path, method })  // map vocabulary without touching the app
harness.env                       // { DB, KV_BUCKETS, SECRETS... } per the config `env:`
harness.log() / harness.costTotals()                  // this run's rows / op economics
harness.freezeTo() / harness.restoreTo(snapshot)      // fake-backend snapshot + restore
harness.runFresh(name, reqInit, at?)                  // re-run against a frozen state
```

`harness.run()` fires ONE in-process WHATWG `Request` at that route's
handler - there are no sockets in crashtest by design (the fake transport
IS the product). `reqInit` is either a `Request` instance or:

```js
{ method: 'POST', path: '/enroll',        // or a full url
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({...}) /* or hostileSerialize'd */, params, data }
```

and returns `{ status, ok?, response?, threw?, error?, ops, durationMs }`.
Uncaught handler errors are **not** converted into fake 500s - `threw` is
first-class, so the "never an uncaught throw" floor grades the real thing.
`harness.wpState(...)` exists only with the
[WordPress adapter](/crashtest/playbooks/wordpress); everything else is
the same across adapters.

Two helpers from `../src/scenarios/contract.js` save boilerplate:
`refused(detail, extra)` / `exploited(detail, extra)` build records, and
`fuzzFloorViolation(record)` maps a harness record to the floor-breaking
case (5xx / uncaught throw / no status) or `null`.

## A worked pack skeleton

See [Scenario Packs](/crashtest/reference/packs) for the manifest and the
one-pack-dir config shape; `crashtest packs add <name>` scaffolds a
contract-valid stub you can start from:

```js
export default {
  name: 'my-pack',
  description: 'one line',
  armedByKey: 'my-pack',                 // module-plan: NEEDS-ARMING until set
  beforeAll(ctx) {
    if (!ctx?.routes) throw new TypeError('moduleCtx["my-pack"] needs routes: [] to arm');
  },
  attacks: [{
    name: 'canary-insert',
    description: 'planted field must not survive into a read',
    async run(harness, ctx) {
      const record = await harness.run(ctx.route ?? 'enroll',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"key":"probe"}' });
      return { verdict: 'REFUSED', detail: `inserted with status ${record.status}` };
    },
  }],
};
```

External worked example: gistory's
[`sync-relay-shapes`](https://github.com/dhaupin/gistory/tree/main/packs/public/sync-relay-shapes)
(the first out-of-repo pack; ran 37 REFUSED / 6 BOUNDED / 0 EXPLOITED).
