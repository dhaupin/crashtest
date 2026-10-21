// S1.4 - the CI contract matrix. Exit non-zero ONLY on new EXPLOITED or
// regressions of previously-REFUSED attacks; accepted risks never re-alarm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign } from '../src/campaigns/runner.js';
import { buildLedger, diffAgainstBaseline, exitCode, renderMarkdown, baselineDiffLine } from '../src/report.js';
import { buildHarness } from '../src/harness/harness.js';
import { loadScenarios } from '../src/scenarios/loader.js';
import { bounded } from '../src/scenarios/contract.js';

function mkRun(rows) {
  return {
    rows,
    tally: { TOTAL: rows.length, REFUSED: rows.filter(r => r.verdict === 'REFUSED').length, EXPLOITED: rows.filter(r => r.verdict === 'EXPLOITED').length, BOUNDED: rows.filter(r => r.verdict === 'BOUNDED').length },
    exploited: rows.filter(r => r.verdict === 'EXPLOITED'),
    refused: rows.filter(r => r.verdict === 'REFUSED'),
    accepted: rows.filter(r => r.verdict === 'BOUNDED'),
    cost: { totals: { ops: 1, requests: 1, distinctAttacks: 1 }, perAttack: [] },
    startedAt: new Date().toISOString(),
  };
}

const cleanRun = mkRun([
  { id: 'a/x', verdict: 'REFUSED', detail: 'held' },
  { id: 'b/y', verdict: 'REFUSED', detail: 'held' },
]);
const newExploitRun = mkRun([
  { id: 'a/x', verdict: 'REFUSED', detail: 'held' },
  { id: 'c/z', verdict: 'EXPLOITED', detail: 'fresh hole' },
]);
const regressionRun = mkRun([
  { id: 'a/x', verdict: 'EXPLOITED', detail: 'held yesterday, broken today' },
]);
const boundedRun = mkRun([
  { id: 'd/w', verdict: 'BOUNDED', owner: 'dhaupin', bound: 'retried requests never skipped', detail: 'accepted' },
  { id: 'a/x', verdict: 'REFUSED', detail: 'held' },
]);

test('exit rules: fresh -> fail on new EXPLOITED', () => {
  const ledger = buildLedger(cleanRun);
  const diff = diffAgainstBaseline(newExploitRun, ledger);
  assert.equal(diff.newExploited.map(r => r.id).join(','), 'c/z');
  assert.equal(exitCode(diff), 1);
});

test('exit rules: clean reruns pass even after baseline is set', () => {
  const ledger = buildLedger(cleanRun);
  assert.equal(exitCode(diffAgainstBaseline(cleanRun, ledger)), 0);
  assert.equal(exitCode(diffAgainstBaseline(newExploitRun, null)), 1); // no baseline still fails on new
});

test('exit rules: regressions of previously-REFUSED attacks fail CI', () => {
  const ledger = buildLedger(cleanRun);
  const diff = diffAgainstBaseline(regressionRun, ledger);
  assert.equal(diff.regressed.map(r => r.id).join(','), 'a/x');
  assert.equal(exitCode(diff), 1);
});

test('exit rules: accepted risks with owner+bound never re-alarm', () => {
  const acceptedLedger = {
    schemaVersion: 1,
    generatedAt: 'x',
    findings: [],
    acceptedRisks: [{ id: 'c/z', owner: 'dhaupin', bound: 'bounded by wall' }],
    baseline: ['a/x', 'b/y'],
  };
  const diff = diffAgainstBaseline(newExploitRun, acceptedLedger);
  assert.deepEqual(diff.newExploited, []);
  assert.equal(diff.acceptedHits.map(r => r.id).join(','), 'c/z');
  assert.equal(exitCode(diff), 0);
});

test('exit rules: an accepted risk WITHOUT a bound is a finding', () => {
  assert.throws(() => bounded('dhaupin', '', 'no bound'), /owner \+ bound/);
  const acceptedLedger = {
    schemaVersion: 1, generatedAt: 'x', findings: [],
    acceptedRisks: [{ id: 'c/z', owner: 'dhaupin' }], // no bound -> not counted as accepted
    baseline: ['a/x'],
  };
  const diff = diffAgainstBaseline(newExploitRun, acceptedLedger);
  assert.equal(diff.newExploited.map(r => r.id).join(','), 'c/z');
  assert.equal(exitCode(diff), 1);
});

test('markdown report carries findings, cost economics, baseline diff', () => {
  const ledger = buildLedger(newExploitRun);
  const diff = diffAgainstBaseline(newExploitRun, ledger);
  const md = renderMarkdown(newExploitRun, ledger, diff);
  assert.match(md, /# Hardening report/);
  assert.match(md, /### 🛡 REFUSED \(1\)/);
  assert.match(md, /- a\/x: held/);
  assert.match(md, /### ⚡ EXPLOITED \(1\)/);
  assert.match(md, /- c\/z: fresh hole/);
  assert.match(md, /## Cost economics/);
  assert.match(md, /## Baseline diff/);
  assert.ok(md.includes(baselineDiffLine(diff)), `expected baseline line in report: ${baselineDiffLine(diff)}`);
  assert.match(md, /NEW: 1/);
});

test('end-to-end dogfood: fresh run of the HARDENED fixture -> exitCode 0', async () => {
  const scenarios = await loadScenarios();
  const harness = buildHarness({
    enroll: async ({ request, env }) => {
      let body;
      try { body = await request.json(); } catch { return new Response('bad', { status: 400 }); }
      if (typeof body?.key !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(body.key)) {
        return new Response('invalid', { status: 400 });
      }
      try {
        const res = await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)').bind(body.key, String(body.owner ?? '')).run();
        return Response.json({ ok: true }, { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (e) { if (String(e?.message).includes('UNIQUE')) return new Response('conflict', { status: 409 }); throw e; }
    },
    admin: async () => new Response('403', { status: 403 }),
    burst: async () => new Response('ok', { headers: { 'cache-control': 'no-store' } }),
    device: async ({ request, env }) => {
      let body;
      try { body = await request.json(); } catch { return new Response('bad', { status: 400 }); }
      for (const k of Object.keys(body ?? {})) {
        if (!['key', 'owner'].includes(k)) return new Response('bad field', { status: 400 });
      }
      if (typeof body?.owner !== 'string' || !/^[a-zA-Z0-9-]{1,32}$/.test(body.owner)) {
        return new Response('bad owner', { status: 400 });
      }
      try {
        await env.DB.prepare('INSERT INTO devices (key, owner) VALUES (?, ?)').bind(body.key ?? 'p1', body.owner).run();
        return new Response('ok', { status: 201, headers: { 'cache-control': 'no-store' } });
      } catch (e) { if (String(e?.message).includes('UNIQUE')) return new Response('conflict', { status: 409 }); throw e; }
    },
  }, { env: { d1: { DB: { tables: { devices: { rows: [], uniques: {} } } } } } });
  const run = await runCampaign(harness, scenarios, { seed: 42 });
  const ledger = buildLedger(run, null);
  const diff = diffAgainstBaseline(run, null);
  assert.equal(exitCode(diff), 0, run.exploited.map(r => `${r.id}: ${r.detail}`).join('\n'));
  assert.match(renderMarkdown(run, ledger, diff), /REFUSED \(\d+\)/);
});
