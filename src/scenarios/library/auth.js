// Seed scenario library: 'auth' - identity spoofing, secret handling,
// privilege confusion. Generalized from PRD section 6 (gistory write-auth suite
// seeded the ideas; gistory-specific bits stripped - contract-first, these
// work against any route table).
//
// Oracles per attack:
//   identity-spoof-headers : a request AUTHORIZED vs the same request with a
//     spoofed identity header - a 403->2xx flip is an unauthenticated bypass.
//   secret-watermark       : known fake-secret values planted in env must
//     never appear in any response body or header bucket.
//   privilege-escalation   : mutating identity fields (role/owner/isAdmin) in
//     a denied request must not flip the verdict.

import { refused, exploited } from '../contract.js';

const SPOOF_HEADERS = [
  'x-user-role', 'x-user-id', 'x-forwarded-user', 'x-original-url',
  'x-remote-user', 'x-admin', 'x-is-admin', 'x-tenant-id', 'x-actor',
];
const PRIVILEGES = ['admin', 'root', '1', 'true', 'owner', '0'];

async function get(harness, routeName, headers = {}, body) {
  return harness.run(routeName, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default {
  name: 'auth',
  description: 'Identity boundaries: spoofed identity headers, secret leakage, privilege escalation',

  attacks: [{
    name: 'identity-spoof-headers',
    description: 'Spoof identity headers on a denied request; a 403->2xx flip is an unauthenticated bypass',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'admin';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - spoof matrix skipped (declare it for coverage)`, { route, skipped: true });
      }
      const base = await get(harness, route);
      if (base.threw) {
        return exploited(`baseline request to "${route}" throws - ${base.error.name}: ${base.error.message}`, { route });
      }
      if (base.status < 300) {
        // Can't measure privilege flip if the route only speaks to everyone;
        // still verify the route is stable under spoofing.
        const stable = await get(harness, route, { 'x-user-role': 'root' });
        if (fuzzBroken(stable)) return exploited(`spoofed header broke "${route}"`, { route });
        return refused(`baseline open - spoof flip unmeasurable on "${route}" (status ${base.status})`, { route });
      }

      for (const header of SPOOF_HEADERS) {
        for (const value of PRIVILEGES) {
          const spoofed = await get(harness, route, { [header]: value });
          if (fuzzBroken(spoofed)) {
            return exploited(`spoof ${header}: ${value} broke "${route}"`, { route, header, value });
          }
          if (spoofed.threw === false && spoofed.status < 300 && base.status >= 400) {
            return exploited(`"${route}" trusts "${header}: ${value}" - denied (${base.status}) becomes allowed (${spoofed.status})`,
              { route, header, value, baselineStatus: base.status });
          }
        }
      }
      return refused(`all ${SPOOF_HEADERS.length * PRIVILEGES.length} identity-header spoofs denied or ignored on "${route}"`, { route });
    },
  }, {
    name: 'secret-watermark',
    description: 'Fake secrets planted in env must never surface in any response (errors included)',
    async run(harness, ctx = {}) {
      const routes = ctx.routes ?? harness.listRoutes();
      const watermarks = ctx.watermarks ?? [
        harness.env.CRASHTEST_SECRET,
        harness.env.STRIPE_SECRET,
      ].filter(Boolean);
      if (!watermarks.length) {
        return refused('no fake secrets planted in env - declare CRASHTEST_SECRET to arm this probe', {});
      }
      const leaks = [];
      for (const route of routes) {
        // push error paths hard: bad bodies, weird headers
        const probes = [
          get(harness, route),
          get(harness, route, { authorization: 'Bearer !!not-a-token!!' }),
          harness.run(route, { method: 'POST', body: '{"k"', headers: { 'content-type': 'application/json' } }),
        ];
        for await (const record of probes) {
          const text = record.response ? await record.response.clone().text() : String(record.error ?? record);
          const headersDump = [...(record.response?.headers?.entries?.() ?? [])].flat().join(' ');
          for (const mark of watermarks) {
            if (text.includes(mark) || headersDump.includes(mark)) {
              leaks.push({ route, mark: `${mark.slice(0, 4)}...`, status: record.status ?? 'threw' });
            }
          }
        }
      }
      if (leaks.length) {
        return exploited(`${leaks.length} secret leak(s) across ${routes.length} routes - first: ${leaks[0].route} (${leaks[0].status})`, { leaks: leaks.slice(0, 5) });
      }
      return refused(`${routes.length} routes x 3 error-path probes: no fake secret ever left the env`, { routes: routes.length });
    },
  }, {
    name: 'privilege-escalation',
    description: 'Mutating identity/ownership fields in a denied request must never flip it',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'device';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - escalation skipped (declare it for coverage)`, { route, skipped: true });
      }
      const baseline = await harness.run(route, {
        method: 'POST',
        body: ctx.baselineBody !== undefined ? ctx.baselineBody : JSON.stringify({ key: 'r1', owner: 'victim' }),
        headers: { 'content-type': 'application/json' },
      });
      if (baseline.status == null || baseline.threw) {
        return exploited(`baseline write to "${route}" throws - ${baseline.error?.name}: ${baseline.error?.message}`, { route });
      }
      const field = ctx.field ?? 'owner';
      const baseDenied = baseline.status >= 400;
      for (const [writer, victim] of [['attacker', 'victim'], ['attacker', 'admin'], ['', 'admin']]) {
        const body = JSON.stringify({ ...JSON.parse(ctx.baselineBody ?? '{"key":"r1","owner":"victim"}'), [field]: victim, writeAs: writer });
        const probe = await harness.run(route, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
        if (probe.threw) continue; // crashes belong to input/guards attacks, not privilege checks
        if (baseDenied && probe.status < 300) {
          return exploited(`write-as "${writer}"-${field}: "${victim}" accepted by "${route}" (denied baseline ${baseline.status} -> ${probe.status})`,
            { route, field, victim });
        }
      }
      return refused(`ownership mutations rejected by "${route}" (baseline ${baseline.status})`, { route });
    },
  }],
};

function fuzzBroken(record) {
  return record.threw || (record.status != null && record.status >= 500);
}
