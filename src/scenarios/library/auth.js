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
//   invalid-credential-fail-open : an invalid credential (unsigned/expired/
//     wrong-key token) must be DENIED - a grant is the `if (!verify())` bug
//     where verify() resolves to a verdict OBJECT (`{valid:false}`, truthy).
//   over-return-allowlist  : a handler response must not carry undeclared
//     top-level keys - a returned internal object (a live instance carrying
//     its own secret field) or a planted secret echoed back is the leak.

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
  }, {
    name: 'invalid-credential-fail-open',
    description: 'An invalid credential (unsigned / expired / wrong-key token) must be DENIED - a grant is the verify()-returns-an-object fail-open (`if (!verified)` on a `{valid:false}` object)',
    async run(harness, ctx = {}) {
      const route = ctx.authCheckRoute ?? ctx.route ?? 'admin';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - invalid-credential probe skipped (declare it for coverage)`, { route, skipped: true });
      }
      // The baseline: a request with NO credential must already be denied. A
      // route that answers everyone has no credential decision to flip, so a
      // later "grant" would be meaningless.
      const bare = await get(harness, route);
      if (fuzzBroken(bare)) {
        return exploited(`baseline request to "${route}" throws/5xx - ${bare.error?.name ?? bare.status}`, { route });
      }
      if (bare.status < 300) {
        return refused(`"${route}" answers unauthenticated (status ${bare.status}) - no credential decision to measure here`, { route });
      }
      const credentials = ctx.invalidCredentials ?? DEFAULT_INVALID_CREDENTIALS;
      for (const [label, token] of credentials) {
        const rec = await get(harness, route, { authorization: `Bearer ${token}` });
        if (fuzzBroken(rec)) {
          return exploited(`"${route}" threw/5xx on an invalid credential (${label}) - ${rec.error?.name ?? rec.status}`, { route, credential: label });
        }
        if (rec.status < 300) {
          return exploited(`"${route}" GRANTED an invalid credential (${label}): denied ${bare.status} without one -> ${rec.status} with it - the verify() verdict object read as truthy`, { route, credential: label, baselineStatus: bare.status });
        }
      }
      return refused(`all ${credentials.length} invalid credentials denied on "${route}" - no fail-open on an unsigned/expired/wrong-key token`, { route });
    },
  }, {
    name: 'over-return-allowlist',
    description: 'A handler response must not carry undeclared top-level keys (a returned internal object, a leaked secret field) - each declared route is checked against its allowlist, or the internal-field/planted-secret family',
    async run(harness, ctx = {}) {
      const routes = Array.isArray(ctx.routes) ? ctx.routes : [];
      const allowlist = ctx.allowedTopLevelKeys ?? {};
      const hasAllowlist = Object.keys(allowlist).length > 0;
      if (routes.length === 0 && !hasAllowlist) {
        return refused('no routes declared (ctx.routes) and no allowedTopLevelKeys - the over-return surface is unmeasured (declare one for coverage)', { skipped: true });
      }
      const declared = routes.length ? routes : Object.keys(allowlist);
      const secrets = ctx.secrets ?? [harness.env.CRASHTEST_SECRET, harness.env.STRIPE_SECRET].filter(Boolean);
      // Keys that name an internal object even when no allowlist was given.
      const INTERNAL_FIELD = /^(tokenSecret|secret|password|apiKey|apiKeyId|privateKey|_)/i;

      const leaks = [];
      let graded = 0;
      let skippedRoutes = 0;
      for (const route of declared) {
        if (!harness.listRoutes().includes(route)) { skippedRoutes++; continue; }
        const rec = await harness.run(route, { method: ctx.method ?? 'GET', headers: ctx.headers ?? {} });
        if (rec.threw || !rec.response) { skippedRoutes++; continue; } // transport faults belong to the fuzz floor, not this row
        const raw = await rec.response.clone().text();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { skippedRoutes++; continue; } // non-JSON bodies have no key set to grade
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { skippedRoutes++; continue; }
        graded++;
        const allowed = allowlist[route];
        for (const key of Object.keys(parsed)) {
          if (Array.isArray(allowed)) {
            if (!allowed.includes(key)) leaks.push({ route, key, why: 'not in the declared allowlist' });
            continue;
          }
          if (INTERNAL_FIELD.test(key)) { leaks.push({ route, key, why: 'internal-field family name' }); continue; }
          const value = parsed[key];
          if (typeof value === 'string' && secrets.some((s) => value.includes(s))) {
            leaks.push({ route, key, why: 'carries a planted secret marker' });
          }
        }
      }
      if (leaks.length) {
        return exploited(`${leaks.length} over-return leak(s) across ${graded} route(s) - first: "${leaks[0].route}" returns "${leaks[0].key}" (${leaks[0].why})`, { leaks: leaks.slice(0, 5) });
      }
      if (graded === 0) {
        return refused(`no gradable JSON route among ${declared.length} declared (${skippedRoutes} skipped: undeclared/faulting/non-JSON) - nothing to grade`, { skipped: true });
      }
      return refused(`${graded} declared route(s) returned only allow-listed top-level keys (${skippedRoutes} skipped) - no internal object or secret field escaped`, { graded });
    },
  }],
};

// Deterministic invalid-credential corpus (no wall clock): an unsigned
// (alg:none) JWT, an expired one, and a wrong-key one - the three shapes a
// verify() most often mishandles, plus an opaque non-token.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const JWT_HEADER = b64url({ alg: 'HS256', typ: 'JWT' });
const JWT_CLAIMS = b64url({ sub: 'attacker', role: 'admin', exp: 1000000000 }); // 2001 - expired by construction
const DEFAULT_INVALID_CREDENTIALS = [
  ['unsigned (alg:none)', `${b64url({ alg: 'none', typ: 'JWT' })}.${JWT_CLAIMS}.`],
  ['expired', `${JWT_HEADER}.${JWT_CLAIMS}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`],
  ['wrong-key signature', `${JWT_HEADER}.${JWT_CLAIMS}.Zm9yZ2VkLXNpZ25hdHVyZS12YWx1ZQ`],
  ['opaque non-token', 'not.a.valid.token'],
];

function fuzzBroken(record) {
  return record.threw || (record.status != null && record.status >= 500);
}
