// Seed scenario library: 'guards' - response hygiene + throttle/breaker
// behavior (PRD section 6, gistory guards tests generalized).
//
// Oracles:
//   hygiene-no-store   : a surviving write (2xx on a state-changing request)
//     must not be silently cacheable - no Cache-Control at all is a finding
//     (shared caches replaying writes is the gistory failure mode).
//   burst-wall         : N identical rapid requests - any 429/503s mean a wall
//     exists and MUST carry Retry-After; zero walls allowed, breaks = EXPLOITED.

import { refused, exploited } from '../contract.js';

export default {
  name: 'guards',
  description: 'Walls and hygiene: Cache-Control on writes, Retry-After on throttled bursts, no breaks',

  attacks: [{
    name: 'hygiene-no-store',
    description: 'A surviving state-change (2xx POST) must carry explicit caching hygiene',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - attack skipped (declare it for coverage)`, { route, skipped: true });
      }
      // Determinism (rule 4): the write body's key is SEED-DERIVED, never
      // time-derived - Date.now() here would make same-commit runs differ in
      // the stored row shape even when the verdict held.
      const body = ctx.body !== undefined ? ctx.body : JSON.stringify({ key: `hyg-${(ctx.seed ?? 0xC0FFEE) % 100000}`, owner: 'rook' });
      const record = await harness.run(route, {
        method: 'POST', body,
        headers: { 'content-type': 'application/json' },
      });
      if (record.threw) {
        return exploited(`write to "${route}" throws - ${record.error.name}: ${record.error.message}`, { route });
      }
      if (record.status >= 500) return exploited(`write to "${route}" -> ${record.status}`, { route });
      if (record.status >= 400) {
        return refused(`write to "${route}" refused (${record.status}) - hygiene not yet on the wire`, { route });
      }
      const cacheControl = record.response.headers.get('cache-control');
      if (!cacheControl) {
        return exploited(`2xx write from "${route}" has NO Cache-Control - shared caches may replay the write`,
          { route, status: record.status });
      }
      const lower = cacheControl.toLowerCase();
      if (lower.includes('no-store') || lower.includes('private')) {
        return refused(`"${route}" write responses marked ${cacheControl}`, { route, cacheControl });
      }
      return exploited(`"${route}" write responses cacheable in shared caches (${cacheControl})`,
        { route, cacheControl });
    },
  }, {
    name: 'burst-wall',
    description: 'Burst N rapid identical requests: walls (429/503) must include Retry-After; breaks are findings',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'burst';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - attack skipped (declare it for coverage)`, { route, skipped: true });
      }
      if (!harness.listRoutes().includes(route)) {
        // Config gap, not a finding - zero false-positive CI failures (PRD section 12).
        return refused(`route "${route}" not declared on this target - wall check skipped (declare it for burst coverage)`, { route, skipped: true });
      }
      const burst = ctx.burst ?? 50;
      const body = ctx.body !== undefined ? ctx.body : JSON.stringify({ items: [1, 2, 3] });
      const counts = { ok: 0, throttled: 0, broke: 0, clientErr: 0 };
      const breaks = [];
      let missingRetryAfter = 0;

      for (let i = 0; i < burst; i++) {
        const record = await harness.run(route, {
          method: 'POST',
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
        if (record.threw && /no route registered/.test(String(record.error?.message))) {
          // Config gap, not a finding - zero false-positive CI failures (PRD section 12).
          return refused(`route "${route}" not declared on this target - wall check skipped (declare it for burst coverage)`, { route, skipped: true });
        }
        if (record.threw) {
          counts.broke++;
          breaks.push(`uncaught at ${i}: ${record.error?.name}: ${record.error?.message}`);
          continue;
        }
        if (record.status >= 500) {
          counts.broke++;
          breaks.push(`5xx at ${i}: ${record.status}`);
          continue;
        }
        if (record.status === 429 || record.status === 503) {
          counts.throttled++;
          const retry = record.response.headers.get('retry-after');
          if (!retry || Number.isNaN(Number(retry)) && Number.isNaN(Date.parse(retry))) missingRetryAfter++;
        } else if (record.status >= 400) {
          counts.clientErr++;
        } else {
          counts.ok++;
        }
      }

      if (counts.broke) {
        return exploited(`burst on "${route}" broke the handler ${counts.broke}/${burst}x - ${breaks[0]}`,
          { route, burst, counts, breaks: breaks.slice(0, 5) });
      }
      if (counts.throttled && missingRetryAfter) {
        return exploited(`"${route}" throttled ${counts.throttled}x but ${missingRetryAfter} refused responses lack a usable Retry-After`,
          { route, counts });
      }
      if (counts.throttled) {
        return refused(`burst contained: ${counts.throttled}/${burst} throttled, all with Retry-After`, { route, counts });
      }
      return refused(`no wall under ${burst}-burst on "${route}" (${counts.clientErr} client errors) - wall presence optional, breakage none`,
        { route, counts });
    },
  }],
};
