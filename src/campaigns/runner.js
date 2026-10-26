// S1.3 - campaign runner. Drives every (module, attack) from the loaded
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
  // Zero-match refuses LOUDLY (rule 3): a typo'd or empty `modules:` filter
  // would otherwise run a zero-row campaign and exit 0 - a silent green on a
  // misfired config is the worst class of lie this tool exists to prevent.
  // Filters that match real modules are unaffected (the honest-skip law
  // governs attacks on matched modules that degrade, not the filter itself).
  if (moduleFilter && !scenarios.some((s) => moduleFilter.has(s.module.name))) {
    throw new Error(
      `module filter matched nothing: ${JSON.stringify([...moduleFilter])}`
      + ` (loaded modules: ${scenarios.map((s) => s.module.name).sort().join(', ')})`
      + ' - a typo supports a zero-row run and exit 0; fix the filter or drop it',
    );
  }
  // ctx-knob census (rule 3, same misfire class as the filter guard): a
  // typo'd moduleCtx/attackCtx key silently applies NOTHING - for packs that
  // arm through ctx.config[<name>] the miss reads as an honest "not armed"
  // skip, which is exactly the veil a silent misfire wants. Unmatched keys
  // refuse loudly naming both the orphan keys AND the loaded targets.
  // Deliberate absence is config-free (omit the key); typos are config.
  const moduleCtx = opts.moduleCtx ?? {};
  const availableModules = new Set(scenarios.map((s) => s.module.name));
  const availableAttackIds = new Set(scenarios.flatMap((s) => attackIds(s.module)));
  const orphanKnobs = [
    ...Object.keys(moduleCtx).filter((k) => !availableModules.has(k)).map((k) => `moduleCtx['${k}']`),
    ...Object.keys(opts.attackCtx ?? {}).filter((k) => !availableAttackIds.has(k)).map((k) => `attackCtx['${k}']`),
  ];
  if (orphanKnobs.length) {
    throw new Error(
      `ctx knobs matched nothing: ${orphanKnobs.join(', ')}`
      + ` (loaded modules: ${[...availableModules].sort().join(', ')}; attack ids: ${[...availableAttackIds].sort().join(', ')})`
      + ' - a typo silently applies nothing; fix the key or drop it',
    );
  }
  const startedAt = new Date().toISOString();
  const rows = [];
  // Cross-row state (issue #15): a campaign-scoped vars registry (JSON-
  // deterministic values, re-writes conflict loudly) and objects() accessors
  // for the wordier fixture handles. Both are per-campaign by construction:
  // nothing crosses runs, everything is listed in the campaign output.
  const vars = createCampaignVars();
  const objectNamespaces = new Map();
  const objects = (name) => {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name)) {
      throw new TypeError(`objects(): namespace name must be kebab-case, got ${JSON.stringify(name)}`);
    }
    let ns = objectNamespaces.get(name);
    if (!ns) {
      ns = {
        name,
        set(key, value, setBy) {
          if (typeof key !== 'string' || !key.trim()) throw new TypeError(`objects('${name}'): keys are non-empty strings`);
          if (ns._store.has(key)) {
            throw new Error(`campaign objects('${name}'): "${key}" already set by ${ns._store.get(key).setBy} - re-writes conflict loudly (late-key canary law)`);
          }
          ns._store.set(key, { value, setBy });
        },
        get(key) { return ns._store.get(key)?.value; },
        has(key) { return ns._store.has(key); },
        _store: new Map(),
      };
      objectNamespaces.set(name, ns);
    }
    return ns;
  };

  for (const { module } of scenarios) {
    if (moduleFilter && !moduleFilter.has(module.name)) continue;

    // Module-level lifecycle hooks. contract.js validates them (arity-1,
    // ctx-only); runCampaign is where they actually FIRE - once before the
    // module's first attack and once after its last, with the module's
    // moduleCtx + seed (issue #7: a pack's one-loud arming check lives
    // here). A throw inside either hook fails the campaign loudly at cause
    // (rule 3) - never a half-run with a silently skipped module.
    const hookCtx = { ...(opts.moduleCtx?.[module.name] ?? {}), config: moduleCtx, seed: campaignSeed };
    if (typeof module.beforeAll === 'function') await module.beforeAll(hookCtx);
    for (const attack of module.attacks) {
      const id = `${module.name}/${attack.name}`;
      // Per-ATTACK baseline: requests are per-attack truth, not cumulative-
      // from-module-start. The old shape skewed when a module carries two
      // attacks: attack #2's `requests` field counted attack #1's requests
      // too, so `cost.totals.requests` (the ledger's economic line) INFLATED
      // by triangular arithmetic with the per-attack rows.
      const beforeAttack = { rowsBefore: harness.log().length };
      const costBefore = harness.costTotals();
      let findResult;
      try {
        const ctx = {
          ...(opts.moduleCtx?.[module.name] ?? {}),
          ...(opts.attackCtx?.[id] ?? {}),
          // The pack-module arming contract (the init/packs-add scaffolds and
          // the shipped wp-money-shapes pack teach ctx.config[<name>]): the
          // earlier runner shape never carried it, so packs written per the
          // docs could NEVER arm - the honest-skip law then graded every row
          // "not armed" and the misfire hid behind a legitimate skip. The
          // namespaced bag rides alongside the flattened vocabulary now, and
          // both read paths arm the same values.
          config: moduleCtx,
          seed: campaignSeed,
          vars,
          objects,
        };
        findResult = attack.steps !== undefined
          ? await runChainAttack(attack, harness, ctx)
          : await attack.run(harness, ctx);
        if (findResult?.verdict === 'BOUNDED' && (!findResult.owner || !findResult.bound)) {
          // An accepted risk without a bound is a finding (principle 6).
          findResult = { ...findResult, verdict: 'EXPLOITED', detail: `${findResult.detail || 'BOUNDED'} - owner/bound missing (finding per PRD principle 6)` };
        }
      } catch (err) {
        findResult = { verdict: 'EXPLOITED', detail: `attack itself threw - harness-wide fault: ${err?.name}: ${err?.message}` };
      }

      const record = {
        id,
        module: module.name,
        attack: attack.name,
        verdict: findResult.verdict,
        detail: findResult.detail ?? '',
        owner: findResult.owner,
        bound: findResult.bound,
        // The honest-skip flag the modules return (skipped: true) must SURVIVE
        // the runner boundary: every library row sets it, nothing downstream
        // could read it, and a skipped-REFUSED row was indistinguishable from
        // a plain hold in the ledger - the exact vacuous-green veil the law
        // (PRD section 7 / issue #37) forbids. undefined drops out of JSON,
        // so committed artifacts only change for rows that actually skip.
        skipped: findResult.skipped === true || undefined,
        evidence: findResult.evidence ?? findResult.violations ?? findResult.counts ?? undefined,
        ...(attack.group !== undefined ? { group: attack.group } : {}),
        costDelta: delta(harness.costTotals(), costBefore),
        requests: harness.log().length - beforeAttack.rowsBefore,
      };
      rows.push(record);
    }
    if (typeof module.afterAll === 'function') await module.afterAll(hookCtx);
  }

  // Groups (issue #15): the named bundles grade ONE feature as an aggregate
  // of their member rows' graded verdicts - each row keeps its own record.
  const groupsMap = new Map();
  const worse = (a, b) => (a === 'EXPLOITED' || b === 'EXPLOITED'
    ? 'EXPLOITED'
    : a === 'BOUNDED' || b === 'BOUNDED' ? 'BOUNDED' : 'REFUSED');
  for (const r of rows) {
    if (!r.group) continue;
    let g = groupsMap.get(r.group);
    if (!g) { g = { name: r.group, ids: [], verdict: 'REFUSED' }; groupsMap.set(r.group, g); }
    g.ids.push(r.id);
    g.verdict = worse(g.verdict, r.verdict);
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
    groups: [...groupsMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    vars: vars.listing(),
    objects: [...objectNamespaces.values()].map((ns) => ({
      name: ns.name,
      keys: [...ns._store.entries()].map(([k, v]) => ({ key: k, setBy: v.setBy })),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    cost: summarizeCost(rows),
    startedAt, finishedAt,
  };
}

// ---------- campaign state primitives (issue #15) ----------

/**
 * A deterministic campaign-scoped string->value registry. Values must be
 * JSON round-trippable (serializable + deterministic; no wall clock, no
 * Math.random products - the determinism law inherits wholesale). A re-write
 * of a set key is a LOUD late-key error naming both writers - never
 * last-write-wins. Reads of unset keys return undefined; the reader skips
 * honestly citing the name (coverage-follows-the-fixture, now for data).
 * Everything written is listed in the campaign output (vars listing); values
 * do not serialize INTO the report - the keys + writers do, so nothing
 * crosses runs silently and nothing bloats the ledger.
 */
function createCampaignVars() {
  const map = new Map();
  return {
    set(key, value, setBy = 'ctx.vars.set') {
      if (typeof key !== 'string' || !key.trim()) {
        throw new TypeError('ctx.vars.set: keys are non-empty strings');
      }
      if (map.has(key)) {
        throw new Error(`campaign vars: "${key}" already set by "${map.get(key).setBy}" - ctx.vars re-writes conflict loudly (late-key canary law, never last-write-wins)`);
      }
      assertProtoSafe(value, `campaign vars: "${key}"`, 0);
      let probe = value;
      try { probe = JSON.parse(JSON.stringify(value)); } catch (err) {
        throw new TypeError(`campaign vars: "${key}" value is not JSON round-trippable (${err.message}) - vars accept only serializable deterministic values`);
      }
      if (!sameShape(value, probe)) {
        throw new TypeError(`campaign vars: "${key}" value changed shape across JSON.stringify/parse - vars accept only serializable deterministic values`);
      }
      map.set(key, { value, setBy });
    },
    get(key) { return map.get(key)?.value; },
    has(key) { return map.has(key); },
    listing() { return [...map.entries()].map(([key, v]) => ({ key, setBy: v.setBy })).sort((a, b) => a.key.localeCompare(b.key)); },
  };
}

/**
 * Reject NON-plain objects at cause: a var whose prototype carries data
 * ({ __proto__: {...} } object literals) poisons every later reader through
 * inheritance while looking harmless to stringify AND to own-key comparison
 * - the input.js hostileSerialize canary, one level deeper. Vars accept
 * objects whose [[Prototype]] is Object.prototype (or null) and arrays -
 * nothing else climbs the inheritance ladder silently.
 */
function assertProtoSafe(value, label, depth) {
  if (depth > 64) throw new TypeError(`${label} value nesting exceeds 64 levels`);
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) assertProtoSafe(v, label, depth + 1);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${label} value is not prototype-safe (its [[Prototype]] is ${proto?.constructor?.name ?? 'non-standard'}) - vars accept plain JSON-shaped data only`);
  }
  for (const v of Object.values(value)) assertProtoSafe(v, label, depth + 1);
}

/**
 * Structural equality WITHOUT stringify tricks: JSON.stringify silently
 * drops __proto__ own-keys (input.js's hostileSerialize lesson), so comparing
 * stringified forms would compare dropped-to-dropped and pass. Recursive own-
 * key comparison instead - a stringify-dropped key (or missing one) does not
 * survive the shape check.
 */
function sameShape(a, b, depth = 0) {
  if (depth > 64) throw new TypeError('value nesting exceeds 64 levels - vars accept bounded deterministic shapes');
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b; // number/string/boolean/undefined
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const kbSet = new Set(kb);
  if (!ka.every((k) => kbSet.has(k))) return false;
  return ka.every((k) => sameShape(a[k], b[k], depth + 1));
}

// ---------- chain attacks (issue #14) ----------

/**
 * Run one step-scoped attack: every step grades its own record against the
 * evaluative `expect` spec, the chain reports ONE summary verdict, and the
 * summary/finding detail names the flipped steps explicitly - a 6-step flow
 * never smears into an unattributable blob.
 */
async function runChainAttack(attack, harness, ctx) {
  const c = { ...ctx, state: {} };
  const stepRows = [];
  for (const step of attack.steps) {
    if (step.guard) {
      // A guard that THROWS is an authoring fault on this step - it names the
      // step here rather than escaping runChainAttack as an anonymous
      // attack-level throw (the crash still grades EXPLOITED: same law).
      let guardOk;
      try {
        guardOk = step.guard(c);
      } catch (err) {
        stepRows.push({ name: step.name, verdict: 'EXPLOITED', detail: `guard(c) threw on step "${step.name}": ${err?.name}: ${err?.message}` });
        continue;
      }
      if (!guardOk) {
        stepRows.push({ name: step.name, verdict: 'REFUSED', skip: true, detail: 'guard(c) returned false - step skips honestly' });
        continue;
      }
    }
    if (!step.route || !harness.listRoutes().includes(step.route)) {
      // Honest-skip inherits: a route the run root never declared is a
      // skipped-REFUSED step named by step - never a false positive.
      stepRows.push({ name: step.name, verdict: 'REFUSED', skip: true, detail: `no route "${step.route ?? '<none>'}" registered in the harness - step skips honestly` });
      continue;
    }
    let rec;
    try {
      const reqInit = step.init ? step.init(c) ?? {} : {};
      // The authoring shape contract: init returns a Request, a request-init
      // object, or nothing. Anything else (a string, a number, an array) used
      // to degrade SILENTLY into a GET on "/" inside harness.run - a step
      // that fired the wrong route and still graded "held".
      if (!(reqInit instanceof Request) && (typeof reqInit !== 'object' || Array.isArray(reqInit))) {
        throw new TypeError(`step "${step.name}" init(c) returned a ${Array.isArray(reqInit) ? 'array' : typeof reqInit} - init returns a Request, a request-init object, or nothing (undefined/null)`);
      }
      rec = await harness.run(step.route, reqInit);
    } catch (err) {
      rec = { route: step.route, status: null, ok: false, response: null, threw: true, error: err, durationMs: null, ops: null };
    }
    // The expect GRADER is attack code too: a grader that throws names the
    // step as a per-step finding instead of escaping as an anonymous
    // harness-wide fault - the chain summary stays attributable.
    let stepGrade;
    try {
      stepGrade = gradeExpect(step.expect, rec);
    } catch (err) {
      stepGrade = { verdict: 'EXPLOITED', detail: `expect grader threw at step "${step.name}": ${err?.name}: ${err?.message}`, status: rec?.status ?? null };
    }
    stepRows.push({ name: step.name, ...stepGrade });
  }
  const flipped = stepRows.filter((s) => s.verdict === 'EXPLOITED').map((s) => s.name);
  const allSkipped = stepRows.length > 0 && stepRows.every((s) => s.skip);
  const verdict = flipped.length ? 'EXPLOITED' : 'REFUSED';
  const detail = flipped.length
    ? `chain EXPLOITED at step${flipped.length > 1 ? 's' : ''}: ${flipped.join(', ')}`
    : allSkipped
      ? `chain skipped: all ${stepRows.length} step${stepRows.length === 1 ? '' : 's'} skipped their route/guard - nothing was graded (declare the routes for coverage)`
      : `chain held: ${stepRows.length} step${stepRows.length === 1 ? '' : 's'} - ${stepRows.map((s) => `${s.name}${s.skip ? ' (skip)' : ''}`).join(', ')}`;
  return {
    verdict,
    detail,
    // An all-skip chain is honest skip, not "held": carry the same flag the
    // other rows use, or a configless chain graded vacuous-green coverage.
    ...(allSkipped ? { skipped: true } : {}),
    evidence: { steps: stepRows },
  };
}

/**
 * Grade one step record against expect. The fuzz floor always applies
 * (threw / 5xx / no status = EXPLOITED); the expect spec then decides the
 * shape question - REFUSED when the wire did what the chain expected.
 */
function gradeExpect(expect, rec) {
  const fail = (why) => ({ verdict: 'EXPLOITED', detail: why, status: rec?.status ?? null });
  if (!rec) return fail('no record');
  if (rec.threw) return fail(`uncaught throw: ${rec.error?.name}: ${rec.error?.message}`);
  if (rec.status == null) return fail('no status (transport error)');
  if (rec.status >= 500) return fail(`5xx: ${rec.status}`);
  if (expect === undefined) {
    return { verdict: 'REFUSED', detail: `status ${rec.status} (no expect - fuzz floor held)`, status: rec.status };
  }
  if (typeof expect === 'function') {
    const out = expect(rec);
    const ok = out && typeof out === 'object' ? Boolean(out.ok) : Boolean(out);
    const why = out && typeof out === 'object' && out.detail ? out.detail : `expect grader said not ok at status ${rec.status}`;
    return ok
      ? { verdict: 'REFUSED', detail: typeof out === 'object' && out.detail ? out.detail : `matched expect grader at status ${rec.status}`, status: rec.status }
      : fail(why);
  }
  if (statusMatches(rec.status, expect)) {
    return { verdict: 'REFUSED', detail: `status ${rec.status} matched expect ${expect}`, status: rec.status };
  }
  return fail(`status ${rec.status} did not match expect ${expect}`);
}

/** '2xx-or-4xx' -> status classes; a number -> exact status. */
function statusMatches(status, spec) {
  if (typeof spec === 'number') return status === spec;
  return String(spec)
    .split('-or-')
    .some((part) => {
      const cls = /^(\d)xx$/.exec(part.trim());
      if (cls) return Math.floor(status / 100) === Number(cls[1]);
      const exact = /^\d{3}$/.exec(part.trim());
      if (exact) return status === Number(part.trim());
      throw new TypeError(`expect spec "${spec}": part "${part.trim()}" is not a status class ('2xx') or exact status ('429')`);
    });
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
 * Cost economics (PRD section 7): backend ops per refused vs admitted request folded
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
