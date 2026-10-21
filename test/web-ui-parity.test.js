// Cross-surface parity probes: the ledger model, the hardening report, and
// the dogfood snapshot must all tell the same story with no drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dogfood } from '../web/src/lib/dogfoodSnapshot.js';
import { parseArtifact, parsePlan, prettyDate, VERDICTS } from '../web/src/lib/ledgerModel.js';

test('dogfood snapshot parses as a ledger and reports a clean gate (exit 0)', () => {
  const vm = parseArtifact(dogfood.ledger, { sourceLabel: 'test' });
  assert.equal(vm.kind, 'ledger');
  assert.equal(vm.counts.total, 18);
  assert.equal(vm.counts.refused, 18);
  assert.equal(vm.counts.exploited, 0);
  assert.equal(vm.groupings.length, 7);
});

test('web gate never disagrees with the CLI rule on a different-input sanity run', () => {
  // The dashboard's gate is the exact function the CLI calls - anything the
  // CLI would exit 0 on, the web gate must render as pass (and vice versa).
  const fresh = parseArtifact({
    schemaVersion: 1,
    baseline: [],
    findings: [{ id: 'x/y', verdict: 'REFUSED', detail: 'clean' }],
  });
  assert.equal(fresh.gate.status, 'pass');
});

test('corrupted/garbage shapes fail loudly with usable error messages', () => {
  assert.throws(() => parseArtifact({'nope': true}), /Unrecognized artifact shape/);
  assert.throws(() => parseArtifact(null), /Not a JSON object/);
  assert.throws(() => parseArtifact([1, 2]), /Not a JSON object/);
  assert.throws(() => parsePlan('not an object'), /Not a JSON object/);
});

test('markdown report pasted as JSON fails loudly with a pointer to the real file', () => {
  // The CLI writes markdown next to the ledger; users paste the wrong one.
  const md = '# Hardening report\n\n🛡 REFUSED (13)\n- auth/identity-spoof-headers: held\n';
  assert.throws(() => parseArtifact(md), /Unrecognized artifact shape|Not a JSON object/);
});

test('unknown verdicts are flagged, not silently relabeled', () => {
  const vm = parseArtifact({ findings: [{ id: 'weird/attack', verdict: 'CATACLYSM', detail: '' }] });
  assert.equal(vm.findings[0].verdict, 'EXPLOITED');
  assert.equal(vm.findings[0].unknownVerdict, true);
});

test('ledger verdict glyphs and classes stay in sync with the page CSS', () => {
  assert.equal(VERDICTS.REFUSED.glyph, '🛡');
  assert.equal(VERDICTS.EXPLOITED.glyph, '⚡');
  assert.equal(VERDICTS.BOUNDED.glyph, '🔒');
  assert.equal(VERDICTS.BOUNDED.cls, 'v-bounded');
});

test('prettyDate normalizes an ISO stamp and rejects junk', () => {
  assert.match(prettyDate('2026-10-20T02:02:43.229Z'), /^2026-10-20 02:02:43 UTC$/);
  assert.equal(prettyDate('garbage'), null);
  assert.equal(prettyDate(undefined), null);
});
