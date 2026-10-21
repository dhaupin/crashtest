// S1.2 - the scenario module contract (PRD section 6):
//
//   export default {
//     name: 'input',                        // unique within a campaign
//     description: 'one line',              // shown in the report
//     attacks: [{
//       name: 'never-fail-mutations',       // unique within the module
//       async run(harness, ctx) -> record    // verifies + returns a RunRecord
//     }],
//   }
//
// `run()` returns a RunRecord describing EXACTLY one decision:
//   { verdict: 'REFUSED' | 'EXPLOITED' | 'BOUNDED',
//     detail, attack, tookRequests, evidence?: {...} }
//
// Verdict semantics (binding): REFUSED = the app's defense held; EXPLOITED =
// the attack achieved its goal or crashed/misbehaved the handler; BOUNDED =
// accepted risk, requires `owner` + `bound` fields or it is a finding.

export const VERDICTS = ['REFUSED', 'EXPLOITED', 'BOUNDED'];

/** Validate a scenario module. Throws with the gap named - never sloppy. */
export function validateScenario(mod, origin = 'unknown') {
  const fail = (why) => {
    throw new TypeError(`invalid scenario module (${origin}): ${why}`);
  };
  if (!mod || typeof mod !== 'object') fail('must default-export an object');
  if (typeof mod.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(mod.name)) {
    fail(`bad module name: ${JSON.stringify(mod?.name)} (wants kebab-case)`);
  }
  if (typeof mod.description !== 'string') fail('needs a one-line description');
  if (!Array.isArray(mod.attacks) || mod.attacks.length === 0) fail('needs a non-empty attacks array');

  const seen = new Set();
  for (const a of mod.attacks) {
    if (!a || typeof a !== 'object') fail('attack must be an object');
    if (typeof a.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.name)) {
      fail(`attack name must be kebab-case, got ${JSON.stringify(a.name)}`);
    }
    if (seen.has(a.name)) fail(`duplicate attack name: ${a.name}`);
    seen.add(a.name);
    if (typeof a.run !== 'function') fail(`attack "${a.name}" needs run(harness, ctx)`);
  }
  for (const key of ['beforeAll', 'afterAll']) {
    if (mod[key] !== undefined && typeof mod[key] !== 'function') {
      fail(`${key} must be a function`);
    }
    if (mod[key] !== undefined && mod[key].length > 1) {
      fail(`${key}(ctx) takes no second arg`);
    }
  }
  return mod;
}

/** Enumerate every attack id as `module/attack` (used by campaigns + ledger). */
export function attackIds(mod) {
  return mod.attacks.map(a => `${mod.name}/${a.name}`);
}

/** REFUSED record helper. */
export const refused = (detail, extra = {}) => ({ verdict: 'REFUSED', detail, ...extra });

/** EXPLOITED record helper. */
export const exploited = (detail, extra = {}) => ({ verdict: 'EXPLOITED', detail, ...extra });

/** BOUNDED record helper - a bound without owner is a finding (principle 6). */
export function bounded(owner, bound, detail, extra = {}) {
  if (!owner || !bound) {
    throw new TypeError(`BOUNDED risk needs owner + bound (an accepted risk without a bound is a finding)`);
  }
  return { verdict: 'BOUNDED', owner, bound, detail, ...extra };
}

/**
 * The fuzz floor (PRD section 1.2): never 500, never uncaught throws.
 * Maps a harness run record to one of those two outcomes, else null.
 * null means "the record was fine" (2xx-4xx, no throw) - callers decide
 * what verdict that represents for their attack.
 */
export function fuzzFloorViolation(record) {
  if (!record) return 'no record';
  if (record.threw) return `uncaught throw: ${record.error?.name}: ${record.error?.message}`;
  if (record.status == null) return 'no status (transport error)';
  if (record.status >= 500) return `5xx: ${record.status}`;
  return null;
}

// (canary-leak oracle removed 2026-10-21: exported but referenced by nothing
// in 1.0.0 - the scenario library codes its leak checks inline instead. Trim
// for real when a consumer asks for it.)
