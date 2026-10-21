// Seed scenario library: 'authz' - PRD section 6 expansion (shipped
// 2026-10-21): the door `auth/privilege-escalation` opens. privilege-
// escalation replays WRITES where owner names someone else; authz attacks
// the privilege DECISION itself - ways a handler's admin gate gets flipped
// without touching the owner field at all. Three attacks, all in-process,
// all with honest skips (an undeclared privileged route is a config gap,
// never a false positive):
//
//   method-matrix-privileged : the privileged route must deny the SAME way
//     on every HTTP method carrying no identity - a gate that trips only
//     on the method the developer tested (usually POST) is EXPLOITED with
//     the winning method named.
//   role-body-spoof-family   : self-declared role bodies never route: the
//     role-word field family (role, isAdmin, is_admin, scope, permissions,
//     nested user.role, ...) must not flip a declared deny. ANY grant = the
//     classic LLM "trust the body's role field" draft, EXPLOITED per field.
//   handler-alias-confusion  : a second route performing the same privileged
//     action (the dev/debug leftover) must deny identically - unauthenticated
//     AND under identity-header spoofing. An alias that honors what the
//     primary ignores is the trapdoor, EXPLOITED with the alias named.
//
// ctx vocabulary: privilegedRoute (default 'admin'), aliasRoute
// (default 'dev-check'). Declare them for coverage; undeclared skips are
// REFUSED with the skipped flag (same contract as every other library).

import { refused, exploited } from '../contract.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SPOOF_HEADERS = [
  { name: 'x-is-admin', value: 'admin' },
  { name: 'x-user-role', value: 'admin' },
  { name: 'x-user-role', value: 'true' },
];

// The self-declared role family (field, wire-shape). All deterministic -
// no RNG - the family is short and classic.
const ROLE_CLAIMS = [
  ['role', { role: 'admin' }],
  ['isAdmin', { isAdmin: true }],
  ['is_admin', { is_admin: true }],
  ['admin flag', { admin: true }],
  ['scope', { scope: 'admin' }],
  ['permissions', { permissions: ['admin'] }],
  ['user.role (nested)', { user: { role: 'admin' } }],
  ['x-user-role (body echo)', { 'x-user-role': 'admin' }],
];

export default {
  name: 'authz',
  description: 'Privilege decision discipline: method-blind admin gates, role claims in the body never route, and no alias route honors what the primary denies',

  attacks: [{
    name: 'method-matrix-privileged',
    description: 'The privileged route must deny ON EVERY HTTP METHOD (GET/POST/PUT/PATCH/DELETE, bare and with bodies) - a gate that only trips on one method is EXPLOITED with the winning method named',
    async run(harness, ctx = {}) {
      const route = ctx.privilegedRoute ?? 'admin';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - authz skipped (declare it for coverage)`, { route, skipped: true });
      }
      const grants = [];
      for (const method of METHODS) {
        // GET/HEAD cannot carry a wire body (the fetch contract refuses it) -
        // the bare attempt covers them; body shapes ride the writing methods.
        const attempts = (method === 'GET')
          ? [undefined]
          : [undefined, JSON.stringify({ data: {} })];
        for (const body of attempts) {
          const headers = {};
          if (body !== undefined) headers['content-type'] = 'application/json';
          const rec = await harness.run(route, { method, body, headers });
          if (rec.threw) { grants.push(`${method} (fault: ${String(rec.error).slice(0, 60)})`); continue; }
          if (rec.status < 400) { grants.push(`${method} (${body === undefined ? 'bare' : 'body'}: status ${rec.status})`); }
        }
      }
      if (grants.length) {
        return exploited(
          `privileged route "${route}" answered ${grants.length} method/body combination(s) with a non-deny: ${grants.join(' | ')}`,
          { route },
        );
      }
      return refused(
        `${METHODS.length} methods (bare + bodies where the method carries one) all denied on "${route}" - the gate is method-blind`,
        { route },
      );
    },
  }, {
    name: 'role-body-spoof-family',
    description: 'Self-declared role bodies never route: the role-word field family (role, isAdmin, is_admin, scope, permissions, nested user.role) fired at the privileged route must not flip a deny - any grant is EXPLOITED with the field named',
    async run(harness, ctx = {}) {
      const route = ctx.privilegedRoute ?? 'admin';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - authz skipped (declare it for coverage)`, { route, skipped: true });
      }
      const grants = [];
      for (const [claim, payload] of ROLE_CLAIMS) {
        for (const method of ['POST', 'PUT', 'PATCH']) {
          const rec = await harness.run(route, {
            method,
            body: JSON.stringify(payload),
            headers: { 'content-type': 'application/json' },
          });
          if (rec.threw) { grants.push(`${claim} via ${method} (fault: ${String(rec.error).slice(0, 60)})`); continue; }
          if (rec.status < 400) grants.push(`${claim} via ${method} (status ${rec.status})`);
        }
      }
      if (grants.length) {
        return exploited(
          `body-declared role claims flipped the privilege decision on "${route}": ${grants.join(' | ')}`,
          { route },
        );
      }
      return refused(
        `${ROLE_CLAIMS.length} role-word claims x 3 methods all denied on "${route}" - identity lives in the request the server derives, not in the body the attacker owns`,
        { route },
      );
    },
  }, {
    name: 'handler-alias-confusion',
    description: 'A second route performing the same privileged action (the dev/debug leftover) must deny identically to the primary - unauthenticated AND under identity-header spoofing; an alias that honors what the primary ignores is the trapdoor',
    async run(harness, ctx = {}) {
      const route = ctx.privilegedRoute ?? 'admin';
      const alias = ctx.aliasRoute ?? 'dev-check';
      const declared = [route, alias].filter(r => harness.listRoutes().includes(r));
      if (!declared.includes(route)) {
        return refused(`route "${route}" not declared on this target - authz skipped (declare it for coverage)`, { route, skipped: true });
      }
      if (!declared.includes(alias)) {
        return refused(`no alias route "${alias}" declared - single-route targets are non-suspect for this attack (skip)`, { route, alias, skipped: true });
      }

      const probe = async (extras = {}) => {
        const primary = await harness.run(route, { method: 'GET', ...extras });
        const secondary = await harness.run(alias, { method: 'GET', ...extras });
        return {
          primary: primary.threw ? { threw: true } : primary.status,
          secondary: secondary.threw ? { threw: true } : secondary.status,
        };
      };

      const faults = [];
      const bare = await probe();
      if (bare.primary.threw || bare.secondary.threw) {
        faults.push('a route threw on the bare request (transport failure, not a verdict)');
      } else if (bare.secondary < 400 && bare.primary >= 400) {
        faults.push(`alias "${alias}": unauthenticated ${bare.secondary} where the primary("${route}") denies ${bare.primary} - the leftover is wider than the gate`);
      }

      for (const spoof of SPOOF_HEADERS) {
        const withSpoof = await probe({ headers: { [spoof.name]: spoof.value } });
        if (withSpoof.primary.threw || withSpoof.secondary.threw) continue;
        if (withSpoof.secondary < 400 && withSpoof.primary >= 400) {
          faults.push(`alias "${alias}": honors ${spoof.name}: ${spoof.value} (${withSpoof.secondary}) while the primary denies ${withSpoof.primary} - handler alias confusion, same action two gates`);
        }
      }

      if (faults.length) {
        return exploited(`privilege decision drifts between "${route}" and its alias "${alias}" - first: ${faults[0]}`, { route, alias });
      }
      return refused(
        `alias "${alias}" denies identically to "${route}" - no unauthenticated grant, no identity-header trapdoor (3 spoof vectors probed)`,
        { route, alias },
      );
    },
  }],
};
