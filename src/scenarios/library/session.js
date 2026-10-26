// Seed scenario library: 'session' - PRD section 6 expansion (shipped
// 2026-10-21): the login-cookie dimension. auth/ tests WHO you claim to be
// (headers) and WHAT you own (owner writes); session/ tests HOW the session
// itself behaves on the wire. Three attacks, all in-process, all arming via
// ctx route names - the same honest-skip contract the other libraries use:
//
//   cookie-hygiene      : the auth transition (login) must mint a Set-Cookie
//     carrying Secure, HttpOnly, and a SameSite policy (Lax/Strict). A
//     missing flag = EXPLOITED. A login that mints no cookie at all is
//     honestly un-assessable here (REFUSED, armed=false) - bearer-token
//     auth is not this module's surface.
//   session-fixation    : two logins must mint DIFFERENT session ids (a
//     shared sid across privileged transitions is the fixation classic),
//     and a forged/canary sid must never authenticate (me with an unknown
//     sid cannot 200).
//   logout-invalidates  : a logged-out sid must be dead on arrival - me()
//     with the pre-logout cookie must deny (4xx class). Still-200 = EXPLOITED.
//
// Defaults aim at the common agent-app shape: login/me/logout routes over a
// `sid` cookie. Nothing here is app-specific; arms live in per-module ctx
// (see docs/getting-started/config for the cheat sheet).
//
// Replay window (shipped 2026-10-21): token-replay-deny covers the
// "expiry-to-deletion" class the PRD reserved - in-process the honest oracle
// is the ISSUER REGISTRY: a server that ever re-issues a sid it already
// issued (same account re-login, or a colliding pool) makes every expired-
// but-still-known token replayable. Four logins, pairwise distinct sids;
// the re-login for the SAME account must not resurrect its original sid.

import { refused, exploited } from '../contract.js';

const CRASHTEST_SID_CANARY = 'crashtestSidCanary2f9a';

/** Parse the module/cookie path: find the `sid`-class value from a Cookie header. */
function sidFromCookie(cookieHeader, name = 'sid') {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}

/** Hygiene flags of a Set-Cookie value (missing list). */
function missingFlags(setCookieValue) {
  const v = String(setCookieValue ?? '');
  const missing = [];
  if (!/\bsecure\b/i.test(v)) missing.push('Secure (cookie must never ride plain http on a real surface)');
  if (!/\bhttponly\b/i.test(v)) missing.push('HttpOnly (script-readability = one XSS harvests every session)');
  if (!/\bsamesite=(lax|strict)\b/i.test(v)) missing.push('SameSite=Lax (or Strict) (un-padded cross-site carrying)');
  return missing;
}

export default {
  name: 'session',
  description: 'Session behavior: cookie hygiene on the auth transition, sid rotation, forged-id rejection, logout invalidation',

  attacks: [{
    name: 'cookie-hygiene',
    description: 'The login transition must mint a Set-Cookie carrying Secure, HttpOnly, and a SameSite policy - any missing flag is EXPLOITED',
    async run(harness, ctx = {}) {
      const loginRoute = ctx.loginRoute ?? 'login';
      const code = { user: ctx.user ?? 'rook' };
      if (!harness.listRoutes().includes(loginRoute)) {
        return refused(`route "${loginRoute}" not declared on this target - session skipped (declare it for coverage)`, { loginRoute, skipped: true });
      }
      const record = await harness.run(loginRoute, {
        method: 'POST',
        body: JSON.stringify(code),
        headers: { 'content-type': 'application/json' },
      });
      if (record.threw) {
        return exploited(`login threw on "${loginRoute}" (status unavailable: ${String(record.error).slice(0, 80)})`, { loginRoute });
      }
      const setCookie = record.response?.headers?.get('set-cookie');
      if (!setCookie) {
        // A REFUSED login minted nothing: not a hygiene finding and not a
        // bearer-token shape note - it is a refusal the row cannot grade
        // (the old path folded it into the bearer-message, naming the wrong cause).
        if (record.status >= 400) {
          return refused(`login refused with ${record.status} on "${loginRoute}" - no cookie was minted, nothing to grade (arm the route for coverage)`, { loginRoute, status: record.status });
        }
        return refused(`login "${loginRoute}" minted no Set-Cookie - bearer-token auth is outside this module's surface (arm with cookie auth for coverage)`, { loginRoute, armed: false });
      }
      const missing = missingFlags(setCookie);
      if (missing.length) {
        return exploited(
          `login cookie on "${loginRoute}" misses ${missing.length} hygiene flag(s): ${missing.join('; ')}`,
          { loginRoute, setCookie: setCookie.slice(0, 160) },
        );
      }
      return refused(
        `login cookie on "${loginRoute}" carries the full hygiene set: Secure + HttpOnly + SameSite policy`,
        { loginRoute, setCookie: setCookie.slice(0, 160) },
      );
    },
  }, {
    name: 'session-fixation',
    description: 'Two logins must mint different session ids, and a forged canary sid must never authenticate (me with an unknown sid cannot 200)',
    async run(harness, ctx = {}) {
      const loginRoute = ctx.loginRoute ?? 'login';
      const meRoute = ctx.meRoute ?? 'me';
      const code = { user: ctx.user ?? 'rook' };
      const missingRoutes = [loginRoute, meRoute].filter(r => !harness.listRoutes().includes(r));
      if (missingRoutes.length) {
        return refused(`route(s) ${missingRoutes.map(r => `"${r}"`).join(', ')} not declared on this target - session skipped (declare it for coverage)`, { loginRoute, meRoute, skipped: true });
      }

      const loginOnce = async () => {
        const rec = await harness.run(loginRoute, {
          method: 'POST',
          body: JSON.stringify(code),
          headers: { 'content-type': 'application/json' },
        });
        if (rec.threw) return { threw: true };
        const setCookie = rec.response?.headers?.get('set-cookie');
        return { status: rec.status, sid: sidFromCookie(setCookie) };
      };

      const first = await loginOnce();
      const second = await loginOnce();
      const problems = [];
      if (first.threw || second.threw) {
        problems.push(`login threw (first: ${first.threw}, second: ${second.threw})`);
      } else {
        if (!first.sid) problems.push('first login minted no sid cookie');
        if (!second.sid) problems.push('second login minted no sid cookie');
        if (first.sid && second.sid && first.sid === second.sid) {
          problems.push(`both logins minted the SAME sid ("${first.sid.slice(0, 24)}") - fixation classic: a pre-auth sid survives the privilege transition`);
        }
      }

      // Forged-sid phase: a sid the server never minted must deny.
      const forged = await harness.run(meRoute, {
        method: 'GET',
        headers: { cookie: `sid=${CRASHTEST_SID_CANARY}; other=x` },
      });
      if (forged.threw) {
        problems.push(`me threw on the forged sid (transport failure)`);
      } else if (forged.status === 200) {
        problems.push('"me" honored a FORGED cookie (status 200 for a sid the server never minted)');
      }

      // A login the app REFUSES minted no session: pinning a session-limit
      // refusal as "fixation-surface findings" (the old zero-sid problem row)
      // punished a defense. With both attempts refused there is no pair to
      // compare - the forged-sid phase still ran above and is reported in detail.
      const refusedLogins = [first, second].filter((l) => !l.threw && l.status >= 400);
      if (refusedLogins.length) {
        return refused(
          `login refused with ${refusedLogins[0].status} on "${loginRoute}" - no rotation pair to grade (${refusedLogins.length}/2 attempts refused); forged-sid denial held at ${forged.status}`,
          { loginRoute, meRoute, forgedStatus: forged.status, status: refusedLogins[0].status },
        );
      }

      if (problems.length) {
        return exploited(`fixation-surface findings on "${loginRoute}"/"${meRoute}" - first: ${problems[0]}`, { problems });
      }
      return refused(
        `session rotation + forged-id rejection hold on "${loginRoute}"/"${meRoute}" (two distinct sids, forged sid denied with ${forged.status})`,
        { loginRoute, meRoute, forgedStatus: forged.status },
      );
    },
  }, {
    name: 'token-replay-deny',
    description: 'No login may ever re-issue a sid it already issued: 4 logins (same account, second account, the first account again, a third) must all mint pairwise-distinct sids, and the re-login must not resurrect its original sid - a reused sid makes every known token replayable',
    async run(harness, ctx = {}) {
      const loginRoute = ctx.loginRoute ?? 'login';
      const code = (u) => ({ user: u ?? ctx.user ?? 'rook' });
      const mint = async (who) => {
        const rec = await harness.run(loginRoute, {
          method: 'POST', body: JSON.stringify(code(who)),
          headers: { 'content-type': 'application/json' },
        });
        if (rec.threw) return { threw: true };
        const sid = sidFromCookie(rec.response?.headers?.get('set-cookie'));
        return { status: rec.status, sid, who };
      };
      if (!harness.listRoutes().includes(loginRoute)) {
        return refused(`route "${loginRoute}" not declared on this target - session skipped (declare it for coverage)`, { loginRoute, skipped: true });
      }
      const first = await mint('rook');    // account A, first session
      const second = await mint('other'); // account B
      const again = await mint('rook');   // account A again - the replay probe
      const third = await mint('guest');  // account C
      if (first.threw || second.threw || again.threw || third.threw) {
        return exploited(`login threw during the replay-window burst (first threw: ${first.threw})`, { loginRoute });
      }
      if (!first.sid) {
        return refused(`login minted no sid cookie - replay window unassessable (arm with cookie auth for coverage)`, { loginRoute, armed: false });
      }
      const logins = [first, second, again, third];
      // A REFUSED mint minted nothing - "sids the server never minted cannot
      // collide or replay". The old path counted a refused login in `zeroed`
      // and pinned a session-limiting app as an open replay window.
      const refusedMints = logins.filter((l) => (l.status ?? 0) >= 400);
      if (refusedMints.length) {
        return refused(
          `login for account "${refusedMints[0].who}" refused with ${refusedMints[0].status} on "${loginRoute}" - no sid was minted, and the server never re-issued one to collide`,
          { loginRoute, status: refusedMints[0].status },
        );
      }
      const zeroed = logins.filter((l) => !l.sid).length;
      const problems = [];
      if (zeroed) problems.push(`${zeroed}/4 logins minted no sid (analytics gap or lazy issuance)`);
      const pairs = [];
      for (let i = 0; i < logins.length; i++) {
        for (let j = i + 1; j < logins.length; j++) {
          if (logins[i].sid && logins[j].sid && logins[i].sid === logins[j].sid) {
            pairs.push(`login ${i + 1} + login ${j + 1} share a sid`);
          }
        }
      }
      if (pairs.length) problems.push(`sid collision across the burst: ${pairs[0]} (${pairs.length} total)`);
      if (again.sid && again.sid === first.sid) {
        problems.push(`the same-account RE-LOGIN resurrected its original sid - the expiry-to-deletion window is replayable forever`);
      }
      if (problems.length) {
        return exploited(`replay window is open on "${loginRoute}": ${problems[0]} (+${problems.length - 1} more)`, { loginRoute, problems });
      }
      return refused(
        `4 logins across 3 accounts minted pairwise-distinct sids on "${loginRoute}" - no token is ever re-issued, so expired-and-known tokens cannot replay`,
        { loginRoute },
      );
    },
  }, {
    name: 'logout-invalidates',
    description: 'A logged-out sid must be dead on arrival: me() with the pre-logout cookie must deny (4xx class) - still-200 = EXPLOITED',
    async run(harness, ctx = {}) {
      const loginRoute = ctx.loginRoute ?? 'login';
      const meRoute = ctx.meRoute ?? 'me';
      const logoutRoute = ctx.logoutRoute ?? 'logout';
      const code = { user: ctx.user ?? 'rook' };
      const missingRoutes = [loginRoute, meRoute, logoutRoute].filter(r => !harness.listRoutes().includes(r));
      if (missingRoutes.length) {
        return refused(`route(s) ${missingRoutes.map(r => `"${r}"`).join(', ')} not declared on this target - session skipped (declare it for coverage)`, { loginRoute, meRoute, logoutRoute, skipped: true });
      }

      const login = await harness.run(loginRoute, {
        method: 'POST',
        body: JSON.stringify(code),
        headers: { 'content-type': 'application/json' },
      });
      if (login.threw) return exploited(`login threw on "${loginRoute}" (cannot grade logout: ${String(login.error).slice(0, 80)})`, { loginRoute });
      const sid = sidFromCookie(login.response?.headers?.get('set-cookie'));
      if (!sid) return refused(`login minted no sid cookie - logout invalidation un-assessable (arm with cookie auth)`, { loginRoute, armed: false });

      const logout = await harness.run(logoutRoute, {
        method: 'POST',
        headers: { cookie: `sid=${sid}` },
      });
      const after = await harness.run(meRoute, {
        method: 'GET',
        headers: { cookie: `sid=${sid}` },
      });

      if (after.threw) {
        return exploited(`me threw after logout on "${meRoute}" (transport failure, not a verdict)`, { meRoute });
      }
      if (after.status === 200) {
        return exploited(
          `sid stayed authenticated across logout on "${logoutRoute}": me() returned 200 with the logged-out cookie (session never invalidated)`,
          { logoutStatus: logout.status ?? 'threw', afterStatus: after.status },
        );
      }
      return refused(
        `logout invalidation holds on "${logoutRoute}" - me() with the logged-out sid denies (status ${after.status})`,
        { logoutStatus: logout.status ?? 'threw', afterStatus: after.status },
      );
    },
  }],
};
