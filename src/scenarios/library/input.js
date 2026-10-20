// Seed scenario library: 'input' — mutation fuzz + hostile-field attacks.
// Generalized from the PRD §6 catalog (gistory WAF suite seeded the ideas;
// gistory-specific bits stripped). Zero app-specific fixtures: every attack
// works against ANY route table the harness exposes.
//
// The oracle the module reports on, per attack:
//   proto-pollution-body : in-process canary key planted via the payload
//     appears on a fresh object literal → EXPLOITED (global state poisoned)
//   never-fail-mutations : any request that threw OR returned 5xx → EXPLOITED
//     (the fuzz floor: "never 500, never uncaught throws")
//   oversized-field      : same fuzz floor, one 1 MiB body

import { Rng, mixSpreadSeeds } from '../../rng.js';
import { fuzzFloorViolation, refused, exploited } from '../contract.js';

const CRASHTEST_CANARY = 'crashtestCanary7d3f';

/**
 * JSON serialization that KEEPS '__proto__'-class own keys. JSON.stringify
 * silently drops them (rook lesson: "send raw JSON to test prototype-pollution
 * defenses") — payload generation must not, since the whole point is what
 * the app's JSON.parse sees.
 */
export function hostileSerialize(v) {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function' || v === undefined)) {
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(hostileSerialize).join(',') + ']';
  const parts = [];
  for (const k of Object.keys(v)) {
    parts.push(`${JSON.stringify(k)}:${hostileSerialize(v[k])}`);
  }
  return '{' + parts.join(',') + '}';
}

async function post(harness, routeName, body, extra = {}) {
  return harness.run(routeName, {
    method: 'POST',
    body: typeof body === 'string' ? body : hostileSerialize(body),
    headers: { 'content-type': 'application/json' },
    ...extra,
  });
}

/** Deterministic hostile-field shapes for fuzzing (no crypto needed). */
function hostilePayload(rng) {
  const shapes = [
    () => ({ [rng.pick(['x', '__proto__', 'constructor', 'toString'])]: rng.pick([
      'a', 1, true, null, {}, [], { nested: 'deep' },
    ]) }),
    () => ({ [rng.pick(['id', 'key', 'owner'])]: rng.pick([0, -1, 2147483648, '', ']\x00{']) }),
    () => ({ body: rng.pick(['{[}]', '\x00123', '﻿ json-with-bom', '{"a":', 'null']) }),
    () => ({ [rng.pick(['a', 'field'])]: 'D'.repeat(rng.int(0, 4096)) }),
    () => ({ list: [1, 'two', { three: null }, null, undefined] }),
  ];
  return shapes[rng.int(0, shapes.length - 1)]();
}

export default {
  name: 'input',
  description: 'Hostile input surfaces: prototype keys, type confusion, mutation fuzz, oversized fields',

  attacks: [{
    name: 'proto-pollution-body',
    description: 'Plant a canary via JSON body __proto__ keys; it must never surface on a fresh object',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — attack skipped (declare it for coverage)`, { route, skipped: true });
      }
      const payload = { ['__proto__']: { [CRASHTEST_CANARY]: 'planted' } };
      const record = await post(harness, route, payload);
      const fresh = {}; // object literal — inherits Object.prototype only
      const planted = fresh[CRASHTEST_CANARY];

      if (planted === 'planted') {
        delete Object.prototype[CRASHTEST_CANARY]; // keep the process sane between attacks
        return exploited(
          `canary planted on Object.prototype via payload to "${route}" (status ${record.status ?? 'threw'})`,
          { route, transport: record.status ?? record.error?.message },
        );
      }
      return refused(
        `payload to "${route}" did not pollute state (status ${record.status ?? 'threw'})`,
        { route },
      );
    },
  }, {
    name: 'never-fail-mutations',
    description: 'Seed-deterministic hostile bodies: never 500, never an uncaught throw',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — attack skipped (declare it for coverage)`, { route, skipped: true });
      }
      const iterations = ctx.iterations ?? 64;
      const seed = mixSpreadSeeds(ctx.seed ?? 0xC0FFEE, 'input/never-fail-mutations');
      const rng = new Rng(seed);
      const violations = [];

      for (let i = 0; i < iterations; i++) {
        const body = hostilePayload(rng);
        const record = await post(harness, route, body);
        const violation = fuzzFloorViolation(record);
        if (violation) violations.push({ i, body: JSON.stringify(body).slice(0, 80), violation });
      }
      if (violations.length) {
        return exploited(`${violations.length}/${iterations} hostile bodies broke the floor on "${route}" — first: ${violations[0].violation} (${violations[0].body})`,
          { route, seed, violations: violations.slice(0, 5) });
      }
      // Determinism + cleanliness: seeded runs must not leave planted keys.
      delete Object.prototype[CRASHTEST_CANARY];
      return refused(`${iterations} hostile bodies all under the floor on "${route}" (seed ${seed})`,
        { route, seed });
    },
  }, {
    name: 'oversized-field',
    description: 'A 1 MiB value must be refused or handled — never 5xx, never an uncaught throw',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — attack skipped (declare it for coverage)`, { route, skipped: true });
      }
      const size = ctx.size ?? 1024 * 1024;
      const big = { key: 'D'.repeat(size), owner: 'crashtest-oversize' };
      const record = await post(harness, route, big);
      const violation = fuzzFloorViolation(record);
      if (violation) {
        return exploited(`oversized ${Math.round(size / 1024)}KB body broke the floor on "${route}" — ${violation}`,
          { route, size });
      }
      return refused(`oversized body handled on "${route}" (status ${record.status})`, { route, size });
    },
  }],
};
