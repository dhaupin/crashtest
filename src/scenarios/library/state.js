// Seed scenario library: 'state' — PRD §6: cross-tenant reads, id-enumeration
// oracles, row-move/aliasing bugs, watermark/pin analogues. State attacks
// need a little more ctx than input fuzz (tenancy is app-shaped); defaults
// match the lab fixtures and every knob is documented:
//   enumeration-oracle : { route, mustDenyIds, param, idField }  — ids the
//     CURRENT identity must never read must return <400 ( denied/404).
//     Also treats missing routes as skipped (no false-positive CI).
//   id-collision-alias : { route, key } — two different owners may NOT both
//     own the same identifier: the second owner's write must conflict or
//     spawn a SEPARATE row — never silently overwrite the first owner's row
//     (verified by snapshot diff, not by verdict text).

import { refused, exploited } from '../contract.js';

export default {
  name: 'state',
  description: 'State boundaries: cross-tenant reads, id enumeration, row-move/alias overwrite',

  attacks: [{
    name: 'enumeration-oracle',
    description: 'Resources belonging to others must deny (or 404) — never leak rows by sequential id',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'device';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — enumeration skipped (declare it for coverage)`, { route, skipped: true });
      }
      const mustDenyIds = ctx.mustDenyIds ?? [];
      if (!mustDenyIds.length) {
        return refused('no mustDenyIds configured — declare ids the CURRENT identity must never read to arm the oracle', { route, armed: false });
      }
      const param = ctx.param ?? 'key';
      const leaks = [];

      for (const id of mustDenyIds) {
        // Two probe styles: body/params (handlers that read JSON or ctx.params —
        // the common agent-app shape) and query-string (ctx.query). GET with
        // no id would just 404/no-op, telling us nothing — always carry the id.
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
        if (!record.threw && record.status < 400) {
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
    description: 'Second owner claiming the same identifier must conflict or fork — never silently overwrite',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — alias check skipped`, { route, skipped: true });
      }
      const key = ctx.key ?? `alias-${(ctx.seed ?? 0xC0FFEE) % 100000}`; // deterministic — aliasing findings must reproduce
      const first = { key, owner: 'owner-a', ...(ctx.extraFirst ?? {}) };
      const second = { key, owner: 'owner-b', ...(ctx.extraSecond ?? {}) };

      const r1 = await harness.run(route, {
        method: 'POST', body: JSON.stringify(first), headers: { 'content-type': 'application/json' },
      });
      if (r1.threw || r1.status >= 500) {
        return exploited(`baseline write to "${route}" broke — ${r1.threw ? r1.error?.name + ': ' + r1.error?.message : r1.status}`, { route });
      }
      const before = harness.env.DB.snapshot();

      const r2 = await harness.run(route, {
        method: 'POST', body: JSON.stringify(second), headers: { 'content-type': 'application/json' },
      });
      if (r2.threw) {
        // Uniqueness constraint cranked the route — that's REFUSED, the wall held.
        return refused(`second-owner claim rejected by "${route}" (uncaught: ${r2.error?.name} — handler relies on checks, not constraints)`, { route });
      }

      const after = harness.env.DB.snapshot();
      const victimRows = (before.devices ?? []).filter(r => r.key === key);
      const afterRows = (after.devices ?? []).filter(r => r.key === key);
      const overwritten = victimRows.length > 0
        && afterRows.length === victimRows.length
        && afterRows.some((r, i) => r.id === victimRows[i].id && r.owner !== victimRows[i].owner);

      if (r2.status < 400 && overwritten) {
        return exploited(`"${route}" let owner-b silently overwrite owner-a's row [${key}] (no conflict, same id)`, { route, key });
      }
      if (overwritten) {
        return exploited(`"${route}" reported ${r2.status} for owner-b's claim, but the snapshot shows owner-a's row [${key}] was overwritten in place`, { route, key });
      }
      return refused(`owner-b's claim on [${key}] by "${route}" stayed separate (status ${r2.status}; owner-a row intact)`, { route, key });
    },
  }],
};
