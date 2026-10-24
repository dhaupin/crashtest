# wp-stock-smoke — pack self-audit fixture

Hand-invocable audit of the wp-stock-smoke pack (every shipped pack must
carry one — SPEC §4, `docs/reference/packs.md`).

```bash
node test/fixtures/run.mjs        # in packs/public/wp-stock-smoke/
```

Pins (transcribed from the pack's own tests + docs, never invented):

- the manifest contract: `schemaVersion: 1`,
  `name === 'wp-stock-smoke'`, the `entry` file exists and imports clean
- the documented 4-attack inventory (`nopriv-hostile-volley`,
  `real-sql-cost-meters`, `call-whitelist-holds`, `option-gates`), id
  grammar

The aggregator `test/pack-fixtures.test.js` runs every pack's fixture in
CI so a fixture can never drift without a failing suite.
