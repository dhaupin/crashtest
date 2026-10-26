// Dashboard ledger bridge - parity + shape tests.
// The gate status the web dashboard shows MUST equal what the CLI exits with.
// These tests import the same bridge module the page uses (web/src/lib),
// including its import of src/report.js - one copy of the section 7 rule.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArtifact, parsePlan, VERDICTS, prettyDate } from '../web/src/lib/ledgerModel.js';
import { dogfood } from '../web/src/lib/dogfoodSnapshot.js';

test('dogfood snapshot parses as a ledger and reports a clean gate (exit 0)', () => {
  const vm = parseArtifact(dogfood.ledger, { sourceLabel: 'test' });
  assert.equal(vm.kind, 'ledger');
  assert.equal(vm.counts.total, 49);
  assert.equal(vm.counts.refused, 49);
  assert.equal(vm.counts.exploited, 0);
  assert.equal(vm.gate.status, 'pass');
  assert.equal(vm.gate.exitCode, 0);
  assert.equal(vm.groupings.length, 14); // the 14-module census: auth, authz, governance, guards, input, memory, proto-hygiene, race, recursion, session, state, taxonomy, upload, volume
});

test('snapshot cost economics survived generation (totals + per-attack rows)', () => {
  assert.equal(dogfood.cost.totals.ops, 842); // the 19 skipped rows add ids, not ops
  // Per-ATTACK truth (the runner fix): totals count actual requests, and the
  // old pin (1082) carried the cumulative-baseline inflation (647 truth + 435
  // triangular phantom rows across multi-attack modules).
  assert.equal(dogfood.cost.totals.requests, 647);
  assert.ok(dogfood.cost.perAttack.length >= 49);
  const amp = dogfood.cost.perAttack.find((p) => p.id === 'volume/cost-amplification');
  // 40: amplification's OWN replay count (the old 100 included the stuffing
  // attack's 60 requests because the baseline was module-level).
  assert.deepEqual({ ops: amp.ops, requests: amp.requests }, { ops: 81, requests: 40 });
});

test('new EXPLOITED finding flips the gate to fail with the offending ids', () => {
  const vm = parseArtifact({
    schemaVersion: 1,
    baseline: ['auth/secret-watermark'],
    findings: [
      { id: 'auth/secret-watermark', verdict: 'REFUSED', detail: 'held' },
      { id: 'input/oversized-field', verdict: 'EXPLOITED', detail: 'leaked stack trace' },
    ],
  });
  assert.equal(vm.gate.status, 'fail');
  assert.equal(vm.gate.exitCode, 1);
  assert.deepEqual(vm.gate.newExploited.map((r) => r.id), ['input/oversized-field']);
  assert.equal(vm.gate.regressed.length, 0);
});

test('REFUSED->EXPLOITED regression is detected via the ledger baseline', () => {
  const vm = parseArtifact({
    schemaVersion: 1,
    baseline: ['auth/secret-watermark'],
    findings: [
      { id: 'auth/secret-watermark', verdict: 'EXPLOITED', detail: '403 flipped to 200' },
    ],
  });
  assert.equal(vm.gate.status, 'fail');
  assert.equal(vm.gate.exitCode, 1);
  assert.deepEqual(vm.gate.regressed.map((r) => r.id), ['auth/secret-watermark']);
});

test('accepted risk (owner+bound on file) never re-alarms - reported, not failed', () => {
  const vm = parseArtifact({
    schemaVersion: 1,
    baseline: [],
    acceptedRisks: [{ id: 'volume/cost-amplification', owner: 'rook', bound: 12 }],
    findings: [
      { id: 'volume/cost-amplification', verdict: 'EXPLOITED', detail: 'hit', owner: 'rook', bound: 12 },
    ],
  });
  assert.equal(vm.gate.status, 'pass');
  assert.equal(vm.gate.exitCode, 0);
  assert.deepEqual(vm.gate.acceptedHits.map((r) => r.id), ['volume/cost-amplification']);
});

test('run blob (rows[]) parses with tally + cost and gates honestly without a prior ledger', () => {
  const vm = parseArtifact({
    rows: [
      { id: 'guards/burst-wall', module: 'guards', attack: 'burst-wall', verdict: 'REFUSED', detail: 'ok', costDelta: { ops: 50 }, requests: 51 },
      { id: 'volume/storage-fill', module: 'volume', attack: 'storage-fill', verdict: 'EXPLOITED', detail: 'filled', costDelta: { ops: 9 }, requests: 10 },
    ],
    tally: { TOTAL: 2, REFUSED: 1, EXPLOITED: 1, BOUNDED: 0 },
    cost: { totals: { ops: 59, requests: 61, distinctAttacks: 2 }, perAttack: [] },
    startedAt: '2026-10-20T10:00:00.000Z',
  });
  assert.equal(vm.kind, 'run');
  assert.equal(vm.counts.exploited, 1);
  assert.equal(vm.gate.status, 'fail');
  assert.match(vm.gate.note, /no committed ledger/);
  assert.equal(vm.cost.totals.ops, 59);
  assert.deepEqual(vm.groupings.map((g) => g.module), ['guards', 'volume']);
});

test('a clean run blob without prior ledger passes with the single-run note', () => {
  const vm = parseArtifact({ rows: [{ id: 'x/y', verdict: 'REFUSED', detail: '' }] });
  assert.equal(vm.gate.status, 'pass');
  assert.match(vm.gate.note, /single-run view/);
});

test('unsupported shapes fail loudly with a pointer (rule 3)', () => {
  assert.throws(() => parseArtifact({'nope': true}), /Unrecognized artifact shape/);
  assert.throws(() => parseArtifact(null), /Not a JSON object/);
  assert.throws(() => parseArtifact([1, 2]), /Not a JSON object/);
});

test('unknown verdicts are treated as hit-grade and flagged for the row UI', () => {
  const vm = parseArtifact({ findings: [{ id: 'weird/attack', verdict: 'CATACLYSM', detail: '' }] });
  assert.equal(vm.findings[0].verdict, 'EXPLOITED');
  assert.equal(vm.findings[0].unknownVerdict, true);
});

test('ledger sidecar cost attaches so the default view can draw economics bars', () => {
  const vm = parseArtifact(
    { findings: [{ id: 'x/y', verdict: 'REFUSED', detail: '' }] },
    { cost: { totals: { ops: 7, requests: 9, distinctAttacks: 1 }, perAttack: [{ id: 'x/y', ops: 7, requests: 9 }] } },
  );
  assert.equal(vm.cost.totals.ops, 7);
  const bare = parseArtifact({ findings: [{ id: 'x/y', verdict: 'REFUSED', detail: '' }] });
  assert.equal(bare.cost, null); // user-pasted ledger: honest empty state, no fabricated cost
});

test('groupings nest by module prefix; finding rows carry verdict styling data', () => {
  const vm = parseArtifact({
    findings: [
      { id: 'auth/a', verdict: 'REFUSED', detail: '' },
      { id: 'auth/b', verdict: 'BOUNDED', detail: '', owner: 'rook', bound: 3 },
      { id: 'input/c', verdict: 'REFUSED', detail: '' },
    ],
  });
  const auth = vm.groupings.find((g) => g.module === 'auth');
  assert.deepEqual(auth.items.map((i) => i.verdict), ['REFUSED', 'BOUNDED']);
  assert.equal(VERDICTS.BOUNDED.cls, 'v-bounded');
  assert.equal(VERDICTS.EXPLOITED.glyph, '⚡');
});

test('parsePlan: accepts the module-plan blob, normalizes all three statuses, carries packs', () => {
  const vm = parsePlan({
    schemaVersion: 1,
    filter: null,
    modules: [
      { name: 'auth', origin: 'library/auth.js', source: 'library', status: 'WILL-FIRE', reason: null,
        attacks: [{ id: 'auth/a', status: 'WILL-FIRE', reason: null }] },
      { name: 'wp-money-shapes', origin: 'public/wp-money-shapes/index.js', source: 'pack:public', version: '0.3.0',
        status: 'NEEDS-ARMING', reason: "vocabulary rides moduleCtx['wp-money-shapes']...",
        attacks: [{ id: 'wp-money-shapes/a', status: 'NEEDS-ARMING', reason: 'x' }] },
      { name: 'guards', origin: 'library/guards.js', source: 'library', status: 'SKIPPED-FILTER',
        attacks: [{ id: 'guards/hygiene-no-store', status: 'SKIPPED-FILTER' }] },
    ],
    packs: [{ name: 'wp-money-shapes', visibility: 'public', version: '0.3.0', origin: 'public/wp-money-shapes',
      attacks: 3, armedByKey: 'wp-money-shapes', package: null }],
    totals: { attacks: 3, willFire: 1, needsArming: 1, skippedFilter: 1 },
  }, { sourceLabel: 'coverage plan / CI artifact' });
  assert.equal(vm.kind, 'plan');
  assert.equal(vm.totals.needsArming, 1);
  assert.deepEqual(vm.modules.map((m) => m.status), ['WILL-FIRE', 'NEEDS-ARMING', 'SKIPPED-FILTER']);
  assert.equal(vm.packs[0].armedByKey, 'wp-money-shapes');
  assert.match(vm.sourceLabel, /coverage plan/);
});

test('parsePlan: unknown statuses are flagged (never silently relabeled) and junk shapes fail loudly', () => {
  const vm = parsePlan({ modules: [{ name: 'x', status: 'QUANTUM', attacks: [] }], totals: {} });
  assert.equal(vm.modules[0].unknownStatus, true);
  assert.equal(vm.modules[0].status, 'SKIPPED-FILTER');
  assert.throws(() => parsePlan({'nope': true}), /coverage plan/);
  assert.throws(() => parsePlan(null), /Not a JSON object/);
});

test('prettyDate normalizes an ISO stamp and rejects junk', () => {
  assert.match(prettyDate('2026-10-20T02:02:43.229Z'), /^2026-10-20 02:02:43 UTC$/);
  assert.equal(prettyDate('garbage'), null);
  assert.equal(prettyDate(undefined), null);
});

// walk round 21 teeth - the ledger bridge never drops honest flags or takes
// a blob's own tally claim over the rows it carries.

test('skipped-REFUSED rows keep their skip flag into the view model (the vacuous-green veil)', () => {
  // The dogfood snapshot carries skipped: true on its un-armed governance
  // rows. The first cut of normalizeFinding DROPPED that flag, so the
  // dashboard rendered every skipped row as a plain hold - a skipped row
  // indistinguishable from a graded one, in the same vein the ledger flag
  // was added to prevent (round 13). Truth: carry the flag; renderers decide.
  const vm = parseArtifact(dogfood.ledger, { sourceLabel: 'test' });
  const skipped = vm.findings.find((f) => f.id === 'governance/succession-trust-floor');
  assert.equal(skipped.skipped, true, 'a skipped row must carry the flag into the view model');
  const graded = vm.findings.find((f) => f.id === 'auth/identity-spoof-headers');
  assert.equal(graded.skipped, undefined, 'a graded hold must carry NO skip flag');

  const runLike = parseArtifact({
    rows: [
      { id: 'guards/burst-wall', verdict: 'REFUSED', detail: 'ok' },
      { id: 'governance/succession-trust-floor', verdict: 'REFUSED', detail: 'knob not declared - skip', skipped: true },
    ],
  });
  assert.equal(runLike.findings.find((f) => f.id === 'governance/succession-trust-floor').skipped, true,
    'run blobs carry the flag through the same bridge');
});

test('a lying tally never wins: the single-run gate derives from the rows, mismatch flags', () => {
  // The CLI computes its tally itself - trusted. The dashboard's inputs are
  // user-supplied blobs, and the first cut let a provided tally OVERRIDE the
  // row truth everywhere INCLUDING the gate: { rows: [EXPLOITED row],
  // tally: { EXPLOITED: 0 } } rendered PASS. Rows are truth; a mismatched
  // tally surfaces loudly instead.
  const vm = parseArtifact({
    rows: [
      { id: 'guards/burst-wall', verdict: 'REFUSED', detail: 'ok' },
      { id: 'volume/storage-fill', verdict: 'EXPLOITED', detail: 'filled' },
    ],
    tally: { TOTAL: 2, REFUSED: 2, EXPLOITED: 0, BOUNDED: 0 },
  });
  assert.equal(vm.counts.exploited, 1, 'counts come from the rows');
  assert.equal(vm.gate.status, 'fail', 'a lying tally cannot gate a PASS over an EXPLOITED row');
  assert.equal(vm.gate.exitCode, 1);
  assert.equal(vm.tallyMismatch, true, 'the mismatch surfaces for the row UI');

  const honest = parseArtifact({
    rows: [{ id: 'guards/burst-wall', verdict: 'REFUSED', detail: 'ok' }],
    tally: { TOTAL: 1, REFUSED: 1, EXPLOITED: 0, BOUNDED: 0 },
  });
  assert.equal(honest.gate.status, 'pass');
  assert.equal(honest.tallyMismatch, undefined, 'a matching tally stays quiet');
});

test('BOUNDED without owner/bound is flagged, never rendered as a clean accepted lock', () => {
  // The runner demotes that shape to EXPLOITED at run time (PRD principle
  // 6: an accepted risk without a bound is a finding). The dashboard never
  // re-grades, but a pasted ledger carrying the malformed shape must not
  // render the lock unchip-marked.
  const vm = parseArtifact({
    findings: [
      { id: 'volume/storage-fill', verdict: 'BOUNDED', detail: 'filled' },
      { id: 'volume/cost-amplification', verdict: 'BOUNDED', detail: 'amp', owner: 'rook', bound: 12 },
    ],
  });
  assert.equal(vm.findings[0].incompleteBound, true, 'the demotion-able shape is flagged');
  assert.equal(vm.findings[1].incompleteBound, undefined, 'a real accepted risk stays clean');
});
