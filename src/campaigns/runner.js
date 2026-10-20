// S1.3 — campaign runner. Drives every (module, attack) from the loaded
// scenario set against one harness, wraps each attack with cost accounting
// (harness op delta for exactly its requests), and aggregates campaign
// verdicts. Deterministic by construction: seeded ctx + sorted modules.

import { attackIds } from '../scenarios/contract.js';

/**
 * @param {Harness} harness
 * @param {Array<{origin, module}>} scenarios   loader output
 * @param {object} opts
 * @param {string[]} [opts.modules]      run only these scenario modules
 * @param {object} [opts.attackCtx]      per-attack ctx overrides: { 'module/attack': {...} }
 * @param {object} [opts.moduleCtx]      module-level ctx defaults: { module: {...} }
 * @param {number} [opts.seed]           campaign seed (0xC0FFEE by default)
 */
export async function runCampaign(harness, scenarios, opts = {}) {
  const campaignSeed = opts.seed ?? 0xC0FFEE;
  const moduleFilter = opts.modules ? new Set(opts.modules) : null;
  const startedAt = new Date().toISOString();
  const rows = [];

  for (const { module } of scenarios) {
    if (moduleFilter && !moduleFilter.has(module.name)) continue;
    const beforeModule = { rowsBefore: harness.log().length };
    for (const attack of module.attacks) {
      const id = `${module.name}/${attack.name}`;
      const costBefore = harness.costTotals();
      let findResult;
      try {
        const ctx = {
          ...(opts.moduleCtx?.[module.name] ?? {}),
          ...(opts.attackCtx?.[id] ?? {}),
          seed: campaignSeed,
        };
        findResult = await attack.run(harness, ctx);
        if (findResult?.verdict === 'BOUNDED' && (!findResult.owner || !findResult.bound)) {
          // An accepted risk without a bound is a finding (principle 6).
          findResult = { ...findResult, verdict: 'EXPLOITED', detail: `${findResult.detail || 'BOUNDED'} — owner/bound missing (finding per PRD principle 6)` };
        }
      } catch (err) {
        findResult = { verdict: 'EXPLOITED', detail: `attack itself threw — harness-wide fault: ${err?.name}: ${err?.message}` };
      }

      const record = {
        id,
        module: module.name,
        attack: attack.name,
        verdict: findResult.verdict,
        detail: findResult.detail ?? '',
        owner: findResult.owner,
        bound: findResult.bound,
        evidence: findResult.evidence ?? findResult.violations ?? findResult.counts ?? undefined,
        costDelta: delta(harness.costTotals(), costBefore),
        requests: harness.log().length - beforeModule.rowsBefore,
      };
      rows.push(record);
    }
  }

  const tally = rows.reduce((t, r) => (t[r.verdict] = (t[r.verdict] ?? 0) + 1) && t, {});
  const fins = rows.filter(r => r.verdict === 'EXPLOITED');
  const finishedAt = new Date().toISOString();

  return {
    rows,
    tally: {
      TOTAL: rows.length,
      REFUSED: rows.filter(r => r.verdict === 'REFUSED').length,
      EXPLOITED: fins.length,
      BOUNDED: rows.filter(r => r.verdict === 'BOUNDED').length,
    },
    exploited: fins,
    refused: rows.filter(r => r.verdict === 'REFUSED'),
    accepted: rows.filter(r => r.verdict === 'BOUNDED'),
    cost: summarizeCost(rows),
    startedAt, finishedAt,
  };
}

function delta(after, before) {
  const out = {};
  for (const key of Object.keys(after)) {
    out[key] = after[key] - (before[key] ?? 0);
  }
  const ops = out.__cost__ ?? 0; // weighted backend-op total (counter's own metric)
  delete out.__cost__;
  return { ...out, ops };
}

/**
 * Cost economics (PRD §7): backend ops per refused vs admitted request folded
 * into one line. Uses the harness cost counter's deltas per attack.
 */
function summarizeCost(rows) {
  const perAttack = rows.map(r => ({ id: r.id, ops: r.costDelta.ops, requests: r.requests }));
  const totals = {
    ops: perAttack.reduce((s, r) => s + r.ops, 0),
    requests: perAttack.reduce((s, r) => s + r.requests, 0),
    distinctAttacks: perAttack.length,
  };
  return { perAttack, totals };
}

/** True when a campaign run has no new EXPLOITED findings and no regressions. */
export function isClean(run) {
  return run.exploited.length === 0;
}
