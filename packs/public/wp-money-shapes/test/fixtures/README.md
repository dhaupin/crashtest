# wp-money-shapes — pack self-audit fixture

Hand-invocable audit of the wp-money-shapes pack (every shipped pack must
carry one — SPEC §4, `docs/reference/packs.md`).

```bash
node test/fixtures/run.mjs        # in packs/public/wp-money-shapes/
```

Pins (transcribed from the pack's own tests + docs, never invented):

- the manifest contract: `schemaVersion: 1`, `name === 'wp-money-shapes'`,
  the `entry` file exists and imports clean
- the 3-attack inventory (`wp-write-volley`, `wp-txn-replay`,
  `wp-gate-burst`)
- the armedByKey mis-arm trap: the entry module still carries an `armed`
  decision surface — the arming key comes from the harness context, not a
  constant that could be deduped out of existence (the trap that earned
  this pack its own fixture discipline)

The aggregator `test/pack-fixtures.test.js` runs every pack's fixture in
CI so a fixture can never drift without a failing suite.
