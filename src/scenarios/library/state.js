// Seed scenario library: 'state' - PRD section 6: cross-tenant reads, id-enumeration
// oracles, row-move/aliasing bugs, watermark/pin analogues. State attacks
// need a little more ctx than input fuzz (tenancy is app-shaped); defaults
// match the lab fixtures and every knob is documented:
//   enumeration-oracle : { route, mustDenyIds, param, idField }  - ids the
//     CURRENT identity must never read must return <400 ( denied/404).
//     Also treats missing routes as skipped (no false-positive CI).
//   id-collision-alias : { route, key } - two different owners may NOT both
//     own the same identifier: the second owner's write must conflict or
//     spawn a SEPARATE row - never silently overwrite the first owner's row
//     (verified by snapshot diff, not by verdict text).

import { refused, exploited, fuzzFloorViolation } from '../contract.js';

export default {
  name: 'state',
  description: 'State boundaries: cross-tenant reads, id enumeration, row-move/alias overwrite',

  attacks: [{
    name: 'enumeration-oracle',
    description: 'Resources belonging to others must deny (or 404) - never leak rows by sequential id',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'device';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - enumeration skipped (declare it for coverage)`, { route, skipped: true });
      }
      const mustDenyIds = ctx.mustDenyIds ?? [];
      if (!mustDenyIds.length) {
        return refused('no mustDenyIds configured - declare ids the CURRENT identity must never read to arm the oracle', { route, armed: false });
      }
      const param = ctx.param ?? 'key';
      const leaks = [];

      for (const id of mustDenyIds) {
        // Two probe styles: body/params (handlers that read JSON or ctx.params -
        // the common agent-app shape) and query-string (ctx.query). GET with
        // no id would just 404/no-op, telling us nothing - always carry the id.
        const record = ctx.query
          ? await harness.run(route, {
              method: ctx.method ?? 'GET',
              url: `/${route}?${param}=${encodeURIComponent(id)}`,
            })
          : await harness.run(route, {
              method: ctx.method && ctx.method !== 'GET' ? ctx.method : 'POST',
              body: JSON.stringify({ [param]: id }),
              headers: { 'content-type': 'application/json' },
              params: { [param]: id },
            });
        // A crashed/5xx foreign-id probe is a fuzz-floor finding, not a deny:
        // grading only `<400 = leak` graded a crashed route as a held wall.
        const floor = fuzzFloorViolation(record);
        if (floor) {
          return exploited(`foreign-id probe for "${id}" broke the fuzz floor on "${route}": ${floor} - a crash is not a deny`, { route, id });
        }
        if (record.status < 400) {
          leaks.push({ id, status: record.status });
        }
      }

      if (leaks.length) {
        const detail = leaks.map(l => l.id).join(', ');
        return exploited(`cross-boundary reads on "${route}": ids [${detail}] returned 2xx for an identity that must not see them`,
          { route, leaks });
      }
      return refused(`all ${mustDenyIds.length} foreign ids denied on "${route}" (no ripple, no oracle)`, { route });
    },
  }, {
    name: 'id-collision-alias',
    description: 'Second owner claiming the same identifier must conflict or fork - never silently overwrite',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - alias check skipped`, { route, skipped: true });
      }
      // Row-level aliasing needs a row snapshot to diff - targets that
      // declare no D1 binding have no snapshot to read, so say so instead
      // of crashing (learned against un-audited external targets where the
      // binding simply isn't there).
      if (typeof harness.env?.DB?.snapshot !== 'function') {
        return refused(`no DB binding declared on this target (env.DB.snapshot missing) - alias check skipped (declare env.DB for coverage)`, { route, skipped: true });
      }
      const key = ctx.key ?? `alias-${(ctx.seed ?? 0xC0FFEE) % 100000}`; // deterministic - aliasing findings must reproduce
      const first = { key, owner: 'owner-a', ...(ctx.extraFirst ?? {}) };
      const second = { key, owner: 'owner-b', ...(ctx.extraSecond ?? {}) };

      const r1 = await harness.run(route, {
        method: 'POST', body: JSON.stringify(first), headers: { 'content-type': 'application/json' },
      });
      if (r1.threw || r1.status >= 500) {
        return exploited(`baseline write to "${route}" broke - ${r1.threw ? r1.error?.name + ': ' + r1.error?.message : r1.status}`, { route });
      }
      const before = harness.env.DB.snapshot();

      const r2 = await harness.run(route, {
        method: 'POST', body: JSON.stringify(second), headers: { 'content-type': 'application/json' },
      });
      // An uncaught throw (or a 5xx) on the collision claim is a fuzz-floor
      // finding - the binding contract grades crashes/misbehavior EXPLOITED,
      // never as "the wall held". A well-behaved handler catches the
      // constraint violation and answers 409, which keeps grading below.
      const claimFloor = fuzzFloorViolation(r2);
      if (claimFloor) {
        return exploited(`second-owner claim to [${key}] broke the fuzz floor on "${route}": ${claimFloor} - a crash is not a conflict refusal`, { route, key });
      }

      const after = harness.env.DB.snapshot();
      // The identity claim lives wherever THIS target's D1 keeps rows, not in a
      // fixture table name - a store tiled under any other name would diff an
      // empty pair against an empty pair and silently always refuse. Walk every
      // table in the snapshot and gather the rows carrying the claim key.
      const claimRows = (snap) => {
        const rows = [];
        for (const table of Object.values(snap)) {
          if (Array.isArray(table)) rows.push(...table.filter((r) => r && typeof r === 'object' && r.key === key));
        }
        return rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      };
      const victimRows = claimRows(before);
      const afterRows = claimRows(after);
      const overwritten = victimRows.length > 0
        && afterRows.length === victimRows.length
        && afterRows.some((r, i) => r.id === victimRows[i].id && r.owner !== victimRows[i].owner);
      // The row-MOVE class the module names: owner-a's claim vanished and
      // owner-b holds the key in a different row id - the tenant flipped with
      // no conflict, exactly as silent as the in-place overwrite.
      const movedInPlace = victimRows.length === 1 && afterRows.length === 1
        && victimRows[0].id !== afterRows[0].id
        && afterRows[0].owner !== victimRows[0].owner;

      if (r2.status < 400 && overwritten) {
        return exploited(`"${route}" let owner-b silently overwrite owner-a's row [${key}] (no conflict, same id)`, { route, key });
      }
      if (overwritten) {
        return exploited(`"${route}" reported ${r2.status} for owner-b's claim, but the snapshot shows owner-a's row [${key}] was overwritten in place`, { route, key });
      }
      if (movedInPlace) {
        return exploited(`"${route}" reported ${r2.status} for owner-b's claim, but owner-a's row [${key}] (id ${victimRows[0].id}) is gone - owner-b now claims the key at id ${afterRows[0].id} (row-move, tenant flipped)`, { route, key });
      }
      return refused(`owner-b's claim on [${key}] by "${route}" stayed separate (status ${r2.status}; owner-a row intact)`, { route, key });
    },
  }],
};
