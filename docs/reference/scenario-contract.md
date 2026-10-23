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
- `attacks` must be a non-empty array; each attack needs a `run` function
  OR (issue #14, see section 2b) a non-empty `steps: [...]` chain - never
  both.
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

## 2b. Chain attacks - the step-scoped row (issue #14)

A multi-step flow is a chain, not one blob: the attack declares `steps`
and the runner fires + grades each step, reporting ONE summary verdict
whose detail names the flipped steps.

```js
{
  name: 'otp-conversation-steal',
  description: 'the whole conversation, step by step',
  steps: [
    { name: 'request-code', route: 'auth',
      init: (c) => ({ url: '/auth?user=mary' }), expect: '2xx' },
    { name: 'wrong-code', route: 'auth',
      init: (c) => ({ url: '/auth?user=mary&code=000000' }), expect: '4xx' },
    { name: 'replay-window', route: 'auth',
      init: (c) => ({ url: `/auth?code=${c.state.minted}` }), expect: '2xx' },
  ],
}
```

- **Per-step + one summary.** Every step grades its own record
  (REFUSED when the wire matched, EXPLOITED when it flipped); the row
  summary is EXPLOITED if any step flipped, with `chain EXPLOITED at
  step(s): ...` naming them, and the full per-step list rides `evidence.steps`.
- **`expect` is evaluative**, because the row grades shapes, not
  fixtures: a status number (exact), a spec string (`'2xx'`, `'4xx'`,
  `'429-or-4xx'`), or a `(record) => { ok, detail }` grader for richer
  oracles. Omitted = the fuzz floor alone (never threw, never 5xx).
- **`c.state` is the deterministic shared bag** across steps: a step can
  stash a returned code/id for later steps to read. No wall clock in the
  bag (the determinism law inherits wholesale) - the sample bodies use
  constants like `'000000'`, never `Math.random`.
- **Honest-skip inherits, never a false positive:** a step whose route
  is not registered on the harness skips as a skipped-REFUSED step
  (named by step), and a `guard(c)` returning false skips the step,
  too. The chain never falsifies a verdict because a surface is missing.
- The chain lands as ONE row (id, verdict = summary), so ledger
  semantics, the exit rules, and `--json` are unchanged; the step table
  lives in `evidence.steps`.

## 3. What `ctx` carries

The campaign runner assembles ctx per attack as a shallow merge:

```js
const ctx = {
  ...moduleCtx['your-module-name'],         // from the config's `moduleCtx:`
  ...attackCtx['your-module-name/your-attack'],  // optional per-attack override
  seed,                                      // campaign seed (default 0xC0xFFEE with your seed)
  vars,                                      // campaign-scoped registry (see below)
  objects,                                   // namespaced bag accessor (see below)
};
```

That mapping is the whole contract: **the keys of `moduleCtx['<your pack
name>']` arrive directly on `ctx`** - `ctx.route`, `ctx.db`, `ctx.upload`,
whatever vocabulary your attacks expect. Missing keys degrade to a REFUSED
skip, never a false positive (`coverage follows the fixture`).

### Cross-row state (`ctx.vars` / `ctx.objects`, issue #15)

Packs can hand deterministic VALUES across rows instead of every row
re-deriving its own fixture:

```js
// row 1 mints:
ctx.vars.set('otp-canary', '000123');
// a later row (its own pack included) consumes:
const code = ctx.vars.get('otp-canary');          // undefined if never set -
if (code === undefined) return refused('skip honestly - var not set');

// wordier things (fixture handles, snapshot bags) get namespaces:
ctx.objects('fixtures').set('ledger', dbHandle);
```

Laws pinned in the runner: values are **JSON round-trippable and
prototype-safe** (plain data only - a `{ __proto__: {...} }` object is
rejected at cause, not silently emptied); a re-write of a set key is a
**loud late-key error naming both writers** (never last-write-wins);
reads of unset keys return `undefined` so the reader can skip honestly;
everything written is listed in the report (**vars/objects listing =
keys + writers**, never the values), and the registry dies with the
campaign - no cross-run leakage by construction.

### Groups (`group: 'feature-name'`)

An attack may declare `group: 'svc-healthy'`; the report bundles those
rows' ids under one named group whose verdict is the aggregate (worst) of
its member rows - each row keeps its individual record and verdict. This
is how a feature graded across five shards reads as ONE finding instead
of five unrelated rows, without smearing them into a mega attack.

## 4. The harness (the one dispatch surface)

```js
harness.run(routeName, reqInit)   // -> record, see below
harness.listRoutes()              // -> [name, ...] - arming checks use this
harness.aliasRoute(name, source, { path, method })  // map vocabulary without touching the app
harness.env                       // { DB, KV_BUCKETS, SECRETS... } per the config `env:`
harness.log() / harness.costTotals()                  // this run's rows / op economics
harness.freezeTo() / harness.restoreTo(snapshot)      // fake-backend snapshot + restore
harness.runFresh(name, reqInit, at?)                  // re-run against a frozen state
harness.snapshotStore()          // { [binding]: FakeD1.snapshot() | FakeKV.snapshot() } - attack bookkeeping
harness.diffSnapshots(before, after)   // the uniform diff oracle (see below)
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

### Store snapshots + the diff oracle (issues #14's alias rows, #13 blocker 2)

The uniform shape for grading what the STORAGE did:

```js
const before = harness.snapshotStore();   // { DB: ..., UPLOADS: ... } copies
// ... fire the attack's requests ...
const after = harness.snapshotStore();
const diff = harness.diffSnapshots(before, after);
if (diff.changed) { /* grade diff.bindings.DB.tables.notes.added/removed/changed */ }
```

Rows match by `id` when both sides carry it (the autoincrement
convention); structurally otherwise (equal rows cancel, the residue is
added/removed). Table maps too small to name and KV maps diff by key.
Output is DETERMINISTIC - same inputs twice, byte-identical, sorted
(every copied row, nothing reaches the snapshots) - so a diff rides the
ledger as `evidence` without breaking the byte-stability law. Snapshots
tick NO counters (bookkeeping, not campaign ops), and a binding changing
shape between captures (d1<->kv) is an oracle bug that fails loudly, not
a finding.

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
