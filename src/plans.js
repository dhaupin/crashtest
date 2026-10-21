// src/plans.js - PRD section 14: the coverage dry-run (`crashtest run --module-plan`).
//
// A plan answers ONE question before any request fires: which attack ids
// WOULD this target's run carry, and which of those are not actually
// armed yet. Three statuses per module (and per attack id, inherited):
//
//   WILL-FIRE       - loads, and its config vocabulary is in place
//   NEEDS-ARMING    - the module declares an arming key (module-level
//                     `armedByKey`, or the pack manifest's `armedByKey`)
//                     and the target's moduleCtx lacks it. These attacks
//                     hold a REFUSED skip at run time (skip-parity), so
//                     the plan surfaces them BEFORE you trust a green gate.
//   SKIPPED-FILTER  - the module name is not in the config `modules` filter
//                     (exactly the Set(opts.modules) rule the runner applies).
//
// Pure module: no harness, no campaign, no requests, no imports - the CLI
// resolves scenarios/packs through the SAME loaders cmdRun uses, so a plan
// cannot drift from a real run. `--json` prints this object as the last
// stdout line (same discipline as `run --json`).

/** Derive the per-module status exactly like the runner would. */
function statusFor({ name, armedKey }, { filter, moduleCtx }) {
  if (filter && !filter.has(name)) {
    return { status: 'SKIPPED-FILTER', reason: `not in the modules filter` };
  }
  if (armedKey != null && moduleCtx[armedKey] == null) {
    return {
      status: 'NEEDS-ARMING',
      reason: `vocabulary rides moduleCtx['${armedKey}'] - set it in crashtest.config.js to arm (at run time these attacks REFUSE-skip, never false-positive)`,
    };
  }
  return { status: 'WILL-FIRE', reason: null };
}

/**
 * Build the coverage plan.
 * @param {object} target    the imported crashtest.config.js default export
 * @param {Array<{ origin, visibility, manifest: object, module: object }>} packs loadPacks() output
 * @param {Array<{ origin, module }>} scenarios the merged, sorted scenario list cmdRun attacks
 */
export function buildModulePlan(target, packs = [], scenarios = []) {
  const filter = Array.isArray(target?.modules) ? new Set(target.modules) : null;
  const moduleCtx = (typeof target?.moduleCtx === 'object' && target.moduleCtx !== null) ? target.moduleCtx : {};
  const packByName = new Map(packs.map((p) => [p.manifest.name, p]));

  const modules = scenarios.map(({ origin, module }) => {
    const pack = packByName.get(module.name) ?? null;
    const armedKey = (module.armedByKey !== undefined ? module.armedByKey : pack?.manifest.armedByKey ?? null);
    const decided = statusFor({ name: module.name, armedKey }, { filter, moduleCtx });
    return {
      name: module.name,
      origin,
      source: pack ? `pack:${pack.visibility}` : 'library',
      version: pack?.manifest.version ?? null,
      armedKey,
      status: decided.status,
      reason: decided.reason,
      attacks: module.attacks.map((a) => ({
        id: `${module.name}/${a.name}`,
        status: decided.status,
        reason: decided.reason,
      })),
    };
  });

  const attackRows = modules.flatMap((m) => m.attacks);
  const count = (status) => attackRows.filter((a) => a.status === status).length;
  return {
    schemaVersion: 1,
    tool: 'crashtest module-plan',
    filter: filter ? [...filter] : null,
    modules,
    packs: packs.map((p) => ({
      name: p.manifest.name,
      visibility: p.visibility,
      version: p.manifest.version ?? null,
      origin: p.origin,
      attacks: p.module.attacks.length,
      armedByKey: p.manifest.armedByKey ?? null,
      package: p.manifest.package ?? null,
    })),
    totals: {
      attacks: attackRows.length,
      willFire: count('WILL-FIRE'),
      needsArming: count('NEEDS-ARMING'),
      skippedFilter: count('SKIPPED-FILTER'),
    },
  };
}
