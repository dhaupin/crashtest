# wp-roles — pack self-audit fixture

Hand-invocable audit of the wp-roles pack (every shipped pack must carry
one — SPEC §4, `docs/reference/packs.md`).

```bash
node test/fixtures/run.mjs        # in packs/public/wp-roles/
```

Pins (transcribed from the pack's own tests + docs, never invented):

- the manifest contract: `schemaVersion: 1`, `name === 'wp-roles'`, the
  `entry` file exists and imports clean
- the 3-attack inventory (`nopriv-callback-denied`,
  `low-privilege-callback-blocked`, `capability-constants-hold`) and the
  id grammar

This is one of the experimental packs (3-pack surface the existing suite
saves on the two uploads). The aggregator `test/pack-fixtures.test.js`
runs every pack's fixture in CI so a fixture can never drift without a
failing suite.
