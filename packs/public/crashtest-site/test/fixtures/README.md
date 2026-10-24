# crashtest-site — pack self-audit fixture

Hand-invocable audit of the crashtest-site pack (every shipped pack must
carry one — SPEC §4, `docs/reference/packs.md`).

```bash
node test/fixtures/run.mjs        # in packs/public/crashtest-site/
```

Pins (transcribed from the pack's own tests + docs, never invented):

- the manifest contract: `schemaVersion: 1`, `name === 'crashtest-site'`, the
  `entry` file exists and imports clean
- the documented 18-attack inventory (exact set, census-locked in
  AGENTS.md → test/attacks.test.js — extra or dropped ids fail here too)
- attack id grammar: kebab-case, unique

The aggregator `test/pack-fixtures.test.js` runs every pack's fixture in
CI so a fixture can never drift without a failing suite.
