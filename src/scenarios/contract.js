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
    if (typeof a.run === 'function' && a.steps !== undefined) {
      fail(`attack "${a.name}" declares both run and steps - pick one`);
    }
    if (typeof a.run === 'function') {
      if (a.group !== undefined && (typeof a.group !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.group))) {
        fail(`attack "${a.name}": "group" wants a kebab-case name`);
      }
      continue;
    }
    validateSteps(a, fail);
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

/**
 * Validate the step-scoped attack shape (issue #14). Every wrong shape is a
 * loud contract error - never a half-graded chain.
 */
function validateSteps(a, fail) {
  if (!Array.isArray(a.steps) || a.steps.length === 0) {
    fail(`attack "${a.name}" needs run(harness, ctx) - or a non-empty steps array`);
  }
  const seenSteps = new Set();
  for (const s of a.steps) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      fail(`attack "${a.name}": each step must be an object`);
    }
    if (typeof s.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(s.name)) {
      fail(`attack "${a.name}": step name must be kebab-case, got ${JSON.stringify(s.name)}`);
    }
    if (seenSteps.has(s.name)) fail(`attack "${a.name}": duplicate step name: ${s.name}`);
    seenSteps.add(s.name);
    if (s.route !== undefined && (typeof s.route !== 'string' || !s.route.trim())) {
      fail(`attack "${a.name}" step "${s.name}": route must be a route name`);
    }
    for (const fn of ['init', 'guard']) {
      if (s[fn] !== undefined && (typeof s[fn] !== 'function' || s[fn].length > 1)) {
        fail(`attack "${a.name}" step "${s.name}": ${fn}(c) takes at most one arg`);
      }
    }
    if (s.expect !== undefined
      && typeof s.expect !== 'string' && typeof s.expect !== 'number' && typeof s.expect !== 'function') {
      fail(`attack "${a.name}" step "${s.name}": expect wants a status number, a spec string ('2xx', '4xx-or-429'), or a (record) => {ok, detail} grader`);
    }
    // Validate expect SPEC STRINGS here, not mid-campaign: statusMatches()
    // throws at grading time, which means a typo'd spec ('2sc'/'4xx-or-dead')
    // survived load and detonated the campaign at the step - a contract error
    // that loads is a config error, never a mid-run blowup.
    if (typeof s.expect === 'string') {
      for (const part of String(s.expect).split('-or-')) {
        const p = part.trim();
        if (!/^(\d)xx$/.test(p) && !/^\d{3}$/.test(p)) {
          fail(`attack "${a.name}" step "${s.name}": expect spec part "${p}" is not a status class ('2xx') or exact status ('429')`);
        }
      }
    }
  }
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
 *
 * Step-scoped attacks (issue #14, additive): an attack may declare `steps`
 * instead of `run` - a conversational row where each step fires a route,
 * grades its own record against an evaluative `expect` spec, and the chain
 * reports ONE summary verdict named by the flipped steps:
 *
 *   steps: [
 *     { name: 'request-code', route: 'auth', init: (c) => ({ ... }),
 *       expect: '2xx' },
 *   ]
 *
 *   - expect: a status number, a spec string ('2xx', '4xx', '2xx-or-4xx'),
 *     or (record) => {ok, detail}/boolean for richer oracles; omitted means
 *     the fuzz floor alone (never threw, never 5xx).
 *   - c is the chain bag: { ...ctx, state: {} } - steps share c.state
 *     deterministically (set/read across steps, no wall clock allowed).
 *   - a step whose route is not registered skips honestly (never a false
 *     positive mid-chain); a guard=false step skips honestly too.
 *
 * Cross-row state (issue #15): attacks may set/get campaign-scoped vars
 * (ctx.vars, JSON-deterministic values, conflicting re-writes are LOUD) and
 * objects namespaced bags (ctx.objects('name'), wordier fixture handles),
 * and may declare `group: 'feature-name'` to grade jointly in the report.
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
