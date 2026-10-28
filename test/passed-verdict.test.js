// The PASSED verdict lane (v1.2.0, family taxonomy alignment): a POSITIVE
// probe - the safe path exercised and held end to end. PASSED is evidence,
// never a defense claim: it never joins the REFUSED baseline, never blocks a
// diff, never fails CI on its own - and a PASSED row that flips to EXPLOITED
// fails CI as a NEW finding (the safe path got struck). Eyestruct ships the
// same bucket in its own taxonomy; these teeth keep the crashtest side honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../src/harness/harness.js';
import { runCampaign } from '../src/campaigns/runner.js';
import { VERDICTS, passed } from '../src/scenarios/contract.js';
import { buildLedger, renderMarkdown, exitCode } from '../src/report.js';
import { parseArtifact } from '../web/src/lib/ledgerModel.js';

test('contract: the verdict census carries PASSED and the passed() helper builds it', () => {
  assert.ok(VERDICTS.includes('PASSED'), 'VERDICTS must carry PASSED');
  assert.deepEqual(VERDICTS, ['REFUSED', 'EXPLOITED', 'BOUNDED', 'PASSED']);
  const rec = passed('buy -> receipt -> ledger held end to end', { evidence: { receipts: 1 } });
  assert.equal(rec.verdict, 'PASSED');
  assert.equal(rec.detail, 'buy -> receipt -> ledger held end to end');
  assert.deepEqual(rec.evidence, { receipts: 1 });
});

test('runner: a PASSED row lands in its own bucket (tally, run.passed) and rides the ledger verbatim but never the baseline', async () => {
  const scenarios = [{
    origin: 'passed-verdict.test.js',
    module: {
      name: 'safe-path-pack',
      description: 'positive probe fixture',
      attacks: [
        { name: 'safe-probe', description: 'the safe path, exercised', run: async () => passed('buy -> receipt -> ledger held end to end') },
        { name: 'fuzz', description: 'f', run: async () => ({ verdict: 'REFUSED', detail: 'held' }) },
      ],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, { seed: 9 });
  const row = run.rows.find(r => r.attack === 'safe-probe');
  assert.equal(row.verdict, 'PASSED');
  assert.deepEqual(run.passed.map(r => r.id), ['safe-path-pack/safe-probe']);
  assert.deepEqual(run.tally, { TOTAL: 2, REFUSED: 1, EXPLOITED: 0, BOUNDED: 0, PASSED: 1 });

  const ledger = buildLedger(run);
  const finding = ledger.findings.find(f => f.id === 'safe-path-pack/safe-probe');
  assert.equal(finding.verdict, 'PASSED', 'PASSED rides findings verbatim (evidence, not a finding)');
  assert.ok(!ledger.baseline.includes('safe-path-pack/safe-probe'), 'PASSED never joins the REFUSED baseline');
  assert.ok(ledger.baseline.includes('safe-path-pack/fuzz'), 'REFUSED rows still baseline normally');

  const diff = { newExploited: [], regressed: [], acceptedHits: [] };
  assert.equal(exitCode(diff), 0);
  const md = renderMarkdown(run, ledger, diff);
  assert.match(md, /### ✅ PASSED \(1\)/, 'the report renders the PASSED section when rows carry it');
  assert.match(md, /safe-path-pack\/safe-probe: buy -> receipt/);
});

test('report: a run with no PASSED rows renders byte-identical to the old shape (no PASSED section)', async () => {
  const scenarios = [{
    origin: 'passed-verdict.test.js',
    module: {
      name: 'plain-pack',
      description: 'refusal-only fixture',
      attacks: [{ name: 'hold-probe', description: 'h', run: async () => ({ verdict: 'REFUSED', detail: 'held' }) }],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, { seed: 9 });
  const ledger = buildLedger(run);
  const md = renderMarkdown(run, ledger, { newExploited: [], regressed: [], acceptedHits: [] });
  assert.ok(!md.includes('PASSED'), 'PASSED-free runs must render no PASSED section - committed reports stay byte-stable');
});

test('runner: groups aggregate PASSED mildly - a PASSED-only group stays PASSED, a REFUSED member outranks it', async () => {
  const scenarios = [{
    origin: 'passed-verdict.test.js',
    module: {
      name: 'grouped-pack',
      description: 'group fixture',
      attacks: [
        { name: 'health-a', description: 'a', group: 'health', run: async () => passed('health path held') },
        { name: 'health-b', description: 'b', group: 'health', run: async () => passed('health path held again') },
        { name: 'mixed-pass', description: 'c', group: 'mixed', run: async () => passed('safe path fine') },
        { name: 'mixed-hold', description: 'd', group: 'mixed', run: async () => ({ verdict: 'REFUSED', detail: 'defense held' }) },
      ],
    },
  }];
  const run = await runCampaign(buildHarness({}, {}), scenarios, { seed: 9 });
  const byName = Object.fromEntries(run.groups.map(g => [g.name, g.verdict]));
  assert.equal(byName.health, 'PASSED', 'a PASSED-only group must not be flattened to REFUSED');
  assert.equal(byName.mixed, 'REFUSED', 'REFUSED outranks PASSED in the group aggregate');
});

test('runner: an unknown verdict refuses loudly - the vacuous-green class, fail at cause', async () => {
  const scenarios = [{
    origin: 'passed-verdict.test.js',
    module: {
      name: 'typo-pack',
      description: 'typo verdict fixture',
      attacks: [{ name: 'typo-probe', description: 't', run: async () => ({ verdict: 'REJECTED', detail: 'not a verdict' }) }],
    },
  }];
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { seed: 9 }),
    (err) => {
      assert.match(err.message, /typo-pack\/typo-probe/);
      assert.match(err.message, /unknown verdict "REJECTED"/);
      assert.match(err.message, /allowed: REFUSED \/ EXPLOITED \/ BOUNDED \/ PASSED/);
      return true;
    },
  );
});

test('runner: skipped on PASSED stays forbidden (the honest-skip contract covers the new bucket too)', async () => {
  const scenarios = [{
    origin: 'passed-verdict.test.js',
    module: {
      name: 'skipper-pack',
      description: 'skip-on-passed fixture',
      attacks: [{ name: 'skip-probe', description: 's', run: async () => ({ verdict: 'PASSED', detail: 'x', skipped: true }) }],
    },
  }];
  await assert.rejects(
    () => runCampaign(buildHarness({}, {}), scenarios, { seed: 9 }),
    /skipped on REFUSED rows only/,
  );
});

test('dashboard: PASSED maps green-positive (never unknown-verdict EXPLOITED), and an alien verdict stays loud', () => {
  const vm = parseArtifact({
    rows: [
      { id: 'safe/safe-probe', verdict: 'PASSED', detail: 'held end to end' },
      { id: 'safe/fuzz', verdict: 'REFUSED', detail: 'held' },
    ],
    tally: { TOTAL: 2, REFUSED: 1, EXPLOITED: 0, BOUNDED: 0, PASSED: 1 },
  });
  const passedRow = vm.findings.find((f) => f.id === 'safe/safe-probe');
  assert.equal(passedRow.verdict, 'PASSED');
  assert.ok(!passedRow.unknownVerdict, 'PASSED is a known verdict on the dashboard');
  assert.equal(vm.counts.passed, 1);
  assert.equal(vm.tallyMismatch, undefined, 'a PASSED-bearing tally matches its findings');

  const alien = parseArtifact({ rows: [{ id: 'a/b', verdict: 'REJECTED', detail: 'x' }] });
  const alienRow = alien.findings.find((f) => f.id === 'a/b');
  assert.equal(alienRow.verdict, 'EXPLOITED', 'an unknown verdict stays hit-grade on the dashboard');
  assert.equal(alienRow.unknownVerdict, true, 'and it is loudly labeled');
});
