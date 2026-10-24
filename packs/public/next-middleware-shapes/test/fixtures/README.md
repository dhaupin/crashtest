# next-middleware-shapes — pack self-audit fixture

Hand-invocable audit of the next-middleware-shapes pack (every shipped
pack must carry one — SPEC §4, `docs/reference/packs.md`).

```bash
node test/fixtures/run.mjs        # in packs/public/next-middleware-shapes/
```

Pins (transcribed from the pack's own tests + docs, never invented):

- the manifest contract: `schemaVersion: 1`,
  `name === 'next-middleware-shapes'`, the `entry` file exists and imports
  clean
- the 2-attack inventory (`mw-bypass-grammar`, `mw-value-blindness`), id
  grammar, and contract shape (every attack carries a `run()` function)

The aggregator `test/pack-fixtures.test.js` runs every pack's fixture in
CI so a fixture can never drift without a failing suite.
