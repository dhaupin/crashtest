// S1.4 - report + ledger + rules. PRD section 7: markdown for humans, JSON for CI,
// and exit non-zero ONLY on (a) a new EXPLOITED finding or (b) a REGRESSION
// of an attack that used to be REFUSED. Accepted risks live in the ledger
// with owner + bound and never re-alarm.

export function buildLedger(run, priorLedger = null) {
  const accepted = (priorLedger?.acceptedRisks ?? []).map(r => ({ ...r }));
  const findings = run.rows.map(r => ({
    id: r.id,
    verdict: r.verdict,
    detail: r.detail,
    owner: r.owner ?? undefined,
    bound: r.bound ?? undefined,
    // Honesty rides the flag: a skipped-REFUSED row is identifiable in the
    // ledger (undefined drops out of JSON, so only skipping rows carry it).
    skipped: r.skipped === true || undefined,
  }));
  // Accepted risks get owner/bound straight from the attack record (BOUNDED verdicts).
  for (const f of findings) {
    if (f.verdict === 'BOUNDED') {
      const known = accepted.find(a => a.id === f.id);
      if (!known) accepted.push({ id: f.id, owner: f.owner, bound: f.bound, detail: f.detail });
    }
  }
  return {
    schemaVersion: 1,
    // No wall-clock stamp here on purpose: the committed ledger must be
    // byte-stable per commit (determinism law). The cut stamp lives in
    // labs/run-meta.json, written by the CLI next to this file.
    findings,
    acceptedRisks: accepted,
    baseline: run.refused.map(r => r.id),
  };
}

/**
 * Diff a fresh run against the accepted ledger baseline.
 *  - newExploited: EXPLOITED now, and not an accepted risk (owner+bound on file)
 *  - regressed:    was REFUSED at baseline (accepted ledger or prior run's
 *                  baseline), EXPLOITED now
 *  - acceptedHits: EXPLOITED now but on-file as accepted with owner+bound -
 *                  reported, not failed.
 *
 * PASSED rows never appear here: they are positive-probe evidence, not
 * defense claims, so they neither join the REFUSED baseline nor block a
 * flip. The safety they do carry is one-directional - a PASSED row that
 * grades EXPLOITED later is a NEW finding (the safe path got struck).
 */
export function diffAgainstBaseline(run, priorLedger) {
  const accepted = new Map(
    (priorLedger?.acceptedRisks ?? []).filter(a => a.id && a.owner && a.bound).map(a => [a.id, a]),
  );
  const priorRefused = new Set(priorLedger?.baseline ?? []);

  const newExploited = run.exploited.filter(r => !accepted.has(r.id));
  const regressed = run.exploited.filter(r => priorRefused.has(r.id));
  const acceptedHits = run.exploited.filter(r => accepted.has(r.id) && !priorRefused.has(r.id));

  // Double-count safety: an id that regressed is also "new" unless accepted -
  // subtract so totals are honest.
  const regressedIds = new Set(regressed.map(r => r.id));
  return {
    newExploited: newExploited.filter(r => !regressedIds.has(r.id) && !accepted.has(r.id)),
    regressed,
    acceptedHits,
  };
}

/** PRD section 7 CI rule - the ONLY thing that fails CI. */
export function exitCode(diff) {
  return diff.newExploited.length === 0 && diff.regressed.length === 0 ? 0 : 1;
}

export function baselineDiffLine(diff) {
  const n = diff.newExploited.length;
  const g = diff.regressed.length;
  return `NEW: ${n || 'none'}${n ? ` (${diff.newExploited.map(r => r.id).join(', ')})` : ''} / REGRESSED: ${g || 'none'}${g ? ` (${diff.regressed.map(r => r.id).join(', ')})` : ''}`;
}

export function renderMarkdown(run, ledger, diff, opts = {}) {
  const lines = [];
  const P = (s = '') => lines.push(s);
  P(`# Hardening report`);
  P();
  P(`> crashtest v${opts.version ?? 'unknown'} / seed ${opts.seed ?? '0xC0FFEE'}`);
  P(`> cut stamp: labs/run-meta.json (wall clock, deliberately outside this file).`);
  P(`> CI rule: fail on a NEW EXPLOITED finding, or a REGRESSION of anything previously REFUSED.`);
  P();
  P(`## Findings`);
  P();
  P(`### 🛡 REFUSED (${run.refused.length})`);
  for (const r of run.refused) P(`- ${r.id}: ${r.detail}${r.skipped === true ? ' (skipped)' : ''}`);
  P();
  P(`### ⚡ EXPLOITED (${run.exploited.length + diff.acceptedHits.length})`);
  for (const r of run.exploited) {
    const acc = ledger.acceptedRisks.find(a => a.id === r.id && a.owner && a.bound);
    const bounded = acc ? ` (ACCEPTED${acc.bound ? `, bound: ${acc.bound}` : ''} - owner: ${acc.owner})` : '';
    P(`- ${r.id}: ${r.detail}${bounded}`);
  }
  P();
  P(`### 🔒 BOUNDED (${run.accepted.length})`);
  for (const r of run.accepted) {
    P(`- ${r.id}: ${r.detail} - owner: ${r.owner}, bound: ${r.bound}`);
  }
  // PASSED (the safe-path positive probe) renders only when present, so
  // committed reports stay byte-identical for runs that carry none.
  if (run.passed?.length) {
    P();
    P(`### ✅ PASSED (${run.passed.length})`);
    for (const r of run.passed) P(`- ${r.id}: ${r.detail}`);
  }
  P();
  P(`## Cost economics`);
  P(`- total: ${run.cost.totals.ops} backend ops across ${run.cost.totals.requests} in-process requests from ${run.cost.totals.distinctAttacks} attacks`);
  for (const p of run.cost.perAttack) {
    P(`  - ${p.id}: ${p.ops} ops / ${p.requests} requests`);
  }
  // Campaign state (issues #14/#15): rendered ONLY when a run actually
  // carries groups/vars/objects, so committed baselines stay byte-stable.
  if (run.groups?.length) {
    P();
    P(`## Groups`);
    for (const g of run.groups) {
      P(`- ${g.name} (${g.ids.length} row(s)): ${g.verdict}`);
      for (const id of g.ids) P(`  - ${id}`);
    }
  }
  if (run.vars?.length || run.objects?.length) {
    P();
    P(`## Campaign state`);
    for (const v of run.vars ?? []) P(`- var ${v.key} <- ${v.setBy}`);
    for (const o of run.objects ?? []) {
      P(`- objects('${o.name}') <- ${o.keys.map((k) => `${k.key} (${k.setBy})`).join(', ') || '(empty)'}`);
    }
  }
  P();
  P(`## Baseline diff`);
  P(`- ${baselineDiffLine(diff)}`);
  P();
  return lines.join('\n');
}
