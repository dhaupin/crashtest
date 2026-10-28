/**
 * src/lib/ledgerModel.js - the dashboard's headless ledger bridge.
 *
 * Zero-dependency: shape-detects a crashtest artifact (a committed
 * `labs/crashledger.json` file or a full run blob from a CI artifact), normalizes
 * it into a small view model, and computes the section 7 CI gate verdict.
 *
 * The gate verdict is NOT re-derived here: it imports `diffAgainstBaseline` +
 * `exitCode` straight from the CLI's own `src/report.js`, the exact functions
 * `src/cli.js` calls when a run completes. The dashboard therefore renders
 * exactly what CI would decide - one copy of the rule, no drift.
 *
 * Nothing in this file touches the network. Fetching a user-supplied URL is
 * done by the page; this module stays a pure, testable transformer.
 */

// These two functions are pure ESM with no imports of their own, so bundling
// them into the web build is trivial - and the parity is pinned by test.
import { diffAgainstBaseline, exitCode } from '../../../src/report.js';

export const VERDICTS = {
  REFUSED:   { glyph: '🛡',  cls: 'v-ok',      label: 'REFUSED' },
  EXPLOITED: { glyph: '⚡',  cls: 'v-bad',     label: 'EXPLOITED' },
  BOUNDED:   { glyph: '🔒',  cls: 'v-bounded', label: 'BOUNDED' },
  // The safe-path positive probe (family taxonomy: PASSED). Evidence, not
  // a defense claim - a PASSED row is never a finding and never a failure;
  // it renders green-positive so a struck safe path can't hide in the gray.
  PASSED:    { glyph: '✅',  cls: 'v-pass',    label: 'PASSED' },
};

function normVerdict(v) {
  // An unknown verdict is treated as hit-grade and loudly labeled by the page.
  return VERDICTS[v] ? v : 'EXPLOITED';
}

function normalizeFinding(id, verdict, detail, extra = {}) {
  const slash = String(id).indexOf('/');
  return {
    id: String(id),
    module: extra.module ?? (slash > 0 ? String(id).slice(0, slash) : 'other'),
    attack: extra.attack ?? (slash > 0 ? String(id).slice(slash + 1) : String(id)),
    verdict: normVerdict(verdict),
    unknownVerdict: !VERDICTS[verdict],
    detail: String(detail ?? ''),
    owner: extra.owner ?? undefined,
    bound: extra.bound ?? undefined,
    // The honest-skip flag survives into the VIEW model: a skipped-REFUSED
    // row must stay distinguishable from a hold that graded (the vacuous-
    // green veil, PRD section 7 / issue #37). The first cut dropped the
    // flag here, so the dashboard rendered every skipped row as a plain
    // hold (found walking the lane, round 21; teeth in
    // test/dashboard-ledger.test.js).
    skipped: extra.skipped === true || undefined,
    // A BOUNDED claim without owner + bound is hit-grade in the CLI (the
    // runner demotes it per PRD principle 6). The dashboard never re-grades,
    // but it must not render the demotion as a clean accepted lock - flag
    // the incomplete bound for the row UI.
    incompleteBound: verdict === 'BOUNDED' && !(extra.owner && extra.bound) || undefined,
  };
}

/** Gate verdict for a run + prior ledger - mirrors src/cli.js's cmdRun exactly. */
function computeGate(runLike, priorLedger) {
  const diff = diffAgainstBaseline(runLike, priorLedger);
  return {
    status: exitCode(diff) === 0 ? 'pass' : 'fail',
    newExploited: diff.newExploited,
    regressed: diff.regressed,
    acceptedHits: diff.acceptedHits,
    exitCode: exitCode(diff),
  };
}

function counts(findings) {
  return {
    total: findings.length,
    refused: findings.filter((f) => f.verdict === 'REFUSED').length,
    exploited: findings.filter((f) => f.verdict === 'EXPLOITED').length,
    bounded: findings.filter((f) => f.verdict === 'BOUNDED').length,
    passed: findings.filter((f) => f.verdict === 'PASSED').length,
  };
}

function groupByModule(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.module)) groups.set(f.module, []);
    groups.get(f.module).push(f);
  }
  return [...groups.entries()].map(([module, items]) => ({ module, items }));
}

/**
 * parseArtifact(obj, opts) - pure transformer, throws an honest Error on any
 * shape it does not recognize (the page surfaces that message verbatim):
 *
 *   ledger shape: { schemaVersion, findings[], acceptedRisks?, baseline?, generatedAt? }
 *                 - the committed `labs/crashledger.json`
 *   run shape:    { rows[], tally?, cost?, startedAt? }   - a full campaign run
 *                 of the kind a CI artifact could carry.
 */
export function parseArtifact(obj, opts = {}) {
  const sourceLabel = opts.sourceLabel ?? 'inline data';
  // A ledger file carries no cost numbers - they live in hardening.md. The
  // bundled dogfood snapshot therefore ships its cost summary as a sidecar;
  // any user-pasted ledger simply gets cost: null (an honest empty state).
  const sidecarCost = opts.cost ?? null;

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Not a JSON object - expected a run or ledger blob.');
  }

  if (Array.isArray(obj.findings)) {
    const findings = obj.findings.map((f) =>
      normalizeFinding(f.id, f.verdict, f.detail, { owner: f.owner, bound: f.bound, skipped: f.skipped }),
    );
    const acceptedRisks = (obj.acceptedRisks ?? []).filter((a) => a && a.id);
    const baseline = (obj.baseline ?? []).map(String);
    // Mirror the CLI: diff the current verdicts against this ledger's own
    // baseline + acceptedRisks - exactly what cmdRun does before writing.
    const runLike = {
      rows: findings,
      exploited: findings.filter((f) => f.verdict === 'EXPLOITED').map((f) => ({ id: f.id })),
      refused: findings.filter((f) => f.verdict === 'REFUSED').map((f) => ({ id: f.id })),
      accepted: findings.filter((f) => f.verdict === 'BOUNDED').map((f) => ({ id: f.id })),
    };
    const gate = computeGate(runLike, { baseline, acceptedRisks });
    return {
      kind: 'ledger',
      sourceLabel,
      schemaVersion: obj.schemaVersion ?? null,
      generatedAt: obj.generatedAt ?? null,
      findings,
      counts: counts(findings),
      acceptedRisks,
      baseline,
      groupings: groupByModule(findings),
      gate,
      cost: sidecarCost,
    };
  }

  if (Array.isArray(obj.rows)) {
    const findings = obj.rows
      .filter((r) => r && r.id)
      .map((r) => normalizeFinding(r.id, r.verdict, r.detail, {
        module: r.module, attack: r.attack, owner: r.owner, bound: r.bound, skipped: r.skipped,
      }));
    // The gate derives from the NORMALIZED rows, never from the blob's own
    // tally claim: the CLI computes its tally itself (trusted), but this
    // page's inputs are user-supplied artifacts, and a tally that hides an
    // EXPLOITED row would rank a lie over the findings. A provided tally
    // is still checked - and a mismatch surfaces loudly instead of winning.
    const rowCounts = counts(findings);
    const t = obj.tally ?? null;
    const tallyMismatch = t && ['TOTAL', 'REFUSED', 'EXPLOITED', 'BOUNDED', 'PASSED']
      .some((k) => t[k] !== undefined && t[k] !== rowCounts[k.toLowerCase()]) || undefined;
    const theCounts = rowCounts;
    return {
      kind: 'run',
      sourceLabel,
      schemaVersion: null,
      generatedAt: obj.startedAt ?? obj.finishedAt ?? null,
      findings,
      counts: theCounts,
      tallyMismatch,
      acceptedRisks: (obj.acceptedRisks ?? []).filter((a) => a && a.id),
      baseline: [],
      groupings: groupByModule(findings),
      // A run blob has no committed prior ledger with it - say so honestly.
      gate: {
        status: theCounts.exploited > 0 ? 'fail' : 'pass',
        note: 'single-run view - no committed ledger supplied, so no section 7 baseline diff',
        newExploited: [],
        regressed: [],
        acceptedHits: [],
        exitCode: theCounts.exploited > 0 ? 1 : 0,
      },
      cost: obj.cost?.totals
        ? { totals: obj.cost.totals, perAttack: obj.cost.perAttack ?? [] }
        : null,
    };
  }

  throw new Error(
    'Unrecognized artifact shape - expected { findings[] } (crashledger.json) ' +
    'or { rows[] } (full run). Did you paste the markdown report by mistake?',
  );
}

const PLAN_STATUSES = ['WILL-FIRE', 'NEEDS-ARMING', 'SKIPPED-FILTER'];

/**
 * parsePlan(obj, opts) - the coverage-plan surface (v2).
 * Accepts the LAST stdout line of `npx crashtest run --module-plan --json`
 * (src/plans.js output: { schemaVersion, modules[], packs[], totals } and
 * normalizes it for the page. Unknown statuses are flagged loudly, never
 * silently relabeled (same honesty rule as unknown verdicts).
 */
export function parsePlan(obj, opts = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Not a JSON object - expected a module-plan blob.');
  }
  if (!Array.isArray(obj.modules) || !obj.totals) {
    throw new Error(
      'Unrecognized artifact shape - expected a coverage plan ({ modules[], totals }) ' +
      'from `crashtest run --module-plan --json`. This is neither a ledger, a run blob, nor a plan.',
    );
  }
  const modules = obj.modules.map((m) => {
    const status = PLAN_STATUSES.includes(m.status) ? m.status : 'SKIPPED-FILTER';
    return {
      name: String(m.name ?? '?'),
      origin: String(m.origin ?? ''),
      source: String(m.source ?? ''),
      version: m.version ?? null,
      status,
      unknownStatus: !PLAN_STATUSES.includes(m.status),
      reason: m.reason ?? null,
      attacks: (m.attacks ?? []).map((a) => ({
        id: String(a.id ?? '?'),
        status: PLAN_STATUSES.includes(a.status) ? a.status : status,
        reason: a.reason ?? null,
      })),
    };
  });
  return {
    kind: 'plan',
    sourceLabel: opts.sourceLabel ?? 'inline plan',
    schemaVersion: obj.schemaVersion ?? null,
    generatedAt: null,
    filter: Array.isArray(obj.filter) ? obj.filter : null,
    modules,
    packs: (obj.packs ?? []).map((p) => ({
      name: String(p.name ?? '?'),
      visibility: String(p.visibility ?? '?'),
      version: p.version ?? null,
      origin: String(p.origin ?? ''),
      attacks: Number.isFinite(p.attacks) ? p.attacks : null,
      armedByKey: p.armedByKey ?? null,
      package: p.package ?? null,
    })),
    totals: {
      attacks: obj.totals.attacks ?? obj.totals.willFire ?? null,
      willFire: obj.totals.willFire ?? null,
      needsArming: obj.totals.needsArming ?? null,
      skippedFilter: obj.totals.skippedFilter ?? null,
    },
  };
}

export function prettyDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}
