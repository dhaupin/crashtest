// Seed scenario library: 'governance' - issue #11, the order-keeping family:
// who may act, who succeeds whom, what releases what. Deterministic,
// in-process, model-free; the patient is any app with grant records,
// approval flows, lock/lease records, or a designated-successor map.
//
// Vocabulary (moduleCtx['governance']; undeclared knobs degrade to honest
// skipped-REFUSED - declare them for coverage, same law as every module):
//   grantsRoute  - writes a grant/revocation: POST { principal, capability,
//                  scope, permit: 'allow'|'deny', precedence, trust,
//                  revoke? } -> 2xx
//   resolveRoute - asks the privilege decision: POST { principal,
//                  capability, scope? } -> 2xx with a decision (or 4xx =
//                  denied; both are gradeable answers)
//   escrowRoute  - requests a release: POST { escrow, approvals: [principal],
//                  ttl? } -> 2xx releases, 4xx refuses (typed per issue #11)
//   locksRoute   - lock/write-fence surface: POST { resource, op, token?,
//                  ttl? } -> 2xx acquired/granted, 4xx refused
//   ttlMode      - (optional, for lock-ttl-honesty) the lock behavior the
//                  app DOCUMENTS after a TTL: 'held' or 'free'
//   staleToken   - (optional, for lock-owner-fencing) a fence token the app
//                  considers expired/revoked
//
// Answers may be JSON ({ permit: 'allow'|'deny', ... }) or plain status
// codes - both are gradeable; a 4xx/403-class answer reads as DENY.
//
// House laws: fixed principals/capabilities (no wall clock, no randomness);
// a missing route is a skipped-REFUSED named by row; the fuzz floor applies
// everywhere.

import { refused, exploited } from '../contract.js';

async function readJson(record) {
  const res = record?.response;
  if (!res || typeof res.json !== 'function') return null;
  try { return await res.json(); } catch { return null; }
}

async function postJson(harness, route, body) {
  return harness.run(route, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// A deny is either a 4xx-class answer or an explicit permit:false/false.
function isDeny(record, body) {
  if (record.status >= 400) return true;
  if (isObject(body)) {
    const permit = body.permit ?? body.allowed ?? body.granted;
    if (permit === false || permit === 'deny' || permit === 'denied') return true;
    if (permit === true || permit === 'allow' || permit === 'allowed') return false;
  }
  return null; // unreadable answer - callers grade it as a gap
}

const isObject = (b) => b && typeof b === 'object' && !Array.isArray(b);

// name the missing KNOB, not its undefined value - a skip that says
// `route "undefined"` names nothing (the honest-skip line is the docs).
const missingKnobs = (ctx, knobs, routes) => knobs.filter((k) => !ctx[k] || !routes.includes(ctx[k]));
const knobLine = (knobs) => knobs.map((k) => `"${k}"`).join(', ');

export default {
  name: 'governance',
  description: 'Governance discipline: succession chains, escrow gates, trust floors, lock fencing',

  attacks: [
    {
      name: 'succession-trust-floor',
      description: 'A designated successor at trust level L inherits only capabilities >= L - the deep-private half stays locked below the floor',
      async run(harness, ctx = {}) {
        const grants = ctx.grantsRoute;
        const resolve = ctx.resolveRoute;
        const missing = missingKnobs(ctx, ['grantsRoute', 'resolveRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage)`, { missing, skipped: true });
        }
        const grant = await postJson(harness, grants, { principal: 'heir-floor-1', capability: 'estate:read', scope: 'surface', permit: 'allow', trust: 2, role: 'successor' });
        if (grant.status >= 500) return exploited(`grants path 5xx while seating the successor (${grant.status})`, { principal: 'heir-floor-1' });
        const ask = await postJson(harness, resolve, { principal: 'heir-floor-1', capability: 'estate:rewrite-roots', scope: 'deep-private' });
        if (ask.status >= 500) return exploited(`resolve path 5xx below the trust floor (${ask.status})`, { principal: 'heir-floor-1' });
        const denied = isDeny(ask, await readJson(ask));
        if (denied === false) {
          return exploited(`trust floor breached: heir at trust 2 resolved ALLOW for deep-private estate:rewrite-roots (below their level)`, { principal: 'heir-floor-1' });
        }
        if (denied === null) {
          return exploited(`trust-floor answer unreadable on resolve (${ask.status}, body ${JSON.stringify(await readJson(ask))}) - decision shape must be 4xx/refusal or {permit}`, { principal: 'heir-floor-1' });
        }
        return refused('deep-private capability below the heir\'s trust floor denied', { principal: 'heir-floor-1' });
      },
    },

    {
      name: 'succession-single-heir',
      description: 'Two successor declarations for the same role must resolve deterministically by declared precedence - never arrival order or RNG',
      async run(harness, ctx = {}) {
        const grants = ctx.grantsRoute;
        const resolve = ctx.resolveRoute;
        const missing = missingKnobs(ctx, ['grantsRoute', 'resolveRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage)`, { missing, skipped: true });
        }
        const cap = 'custodian:step-down';
        const first = await postJson(harness, grants, { principal: 'heir-alpha', capability: cap, permit: 'allow', precedence: 2, role: 'successor' });
        const second = await postJson(harness, grants, { principal: 'heir-beta', capability: cap, permit: 'allow', precedence: 1, role: 'successor' });
        if (first.status >= 500 || second.status >= 500) {
          return exploited(`grants path 5xx while seating two successors (${first.status}/${second.status})`, { capability: cap });
        }
        if (second.status >= 400) {
          return refused(`second declaration for the same role refused with ${second.status} - single-heir enforced at write time`, { capability: cap, status: second.status });
        }
        const winnerOf = async () => {
          const ask = await postJson(harness, resolve, { capability: cap });
          if (ask.status >= 500) return { error: `resolve 5xx (${ask.status})` };
          const body = await readJson(ask);
          const denied = isDeny(ask, body);
          return { denied, who: isObject(body) ? (body.principal ?? body.successor ?? body.who) : null };
        };
        const one = await winnerOf();
        const two = await winnerOf();
        if (one.error || two.error) return exploited(`resolution errored mid-grade: ${one.error ?? two.error}`, { capability: cap });
        if (one.who !== null && one.who !== two.who) {
          return exploited(`two heirs resolved to different principals across identical asks (${one.who ?? one.denied} vs ${two.who ?? two.denied}) - precedence not a pure function`, { capability: cap, one: one.who, two: two.who });
        }
        if (one.who === null && !(one.denied === false)) {
          return exploited(`single-heir winner unreadable on read-back both times - the declared precedence could not be graded`, { capability: cap });
        }
        return refused(`succession resolved deterministically (${one.who ?? 'denied-each-ask'} twice)`, { capability: cap });
      },
    },

    {
      name: 'succession-revocation-carry',
      description: 'Revoking an heir\'s grants must propagate to a session opened AFTER the revocation, including any cached capability map',
      async run(harness, ctx = {}) {
        const grants = ctx.grantsRoute;
        const resolve = ctx.resolveRoute;
        const missing = missingKnobs(ctx, ['grantsRoute', 'resolveRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage)`, { missing, skipped: true });
        }
        const heir = 'heir-revoke-3';
        const cap = 'estate:session-open';
        const grant = await postJson(harness, grants, { principal: heir, capability: cap, permit: 'allow', precedence: 1 });
        if (grant.status >= 500) return exploited(`grants path 5xx while arming the revocation (${grant.status})`, { principal: heir });
        const before = await postJson(harness, resolve, { principal: heir, capability: cap });
        if (isDeny(before, await readJson(before)) === true) {
          return refused(`baseline ask denied even BEFORE revocation - the positive case is unreachable on this target (nothing to carry)`, { principal: heir, skipped: true });
        }
        const revoke = await postJson(harness, grants, { principal: heir, capability: cap, permit: 'deny', precedence: 9, revoke: true });
        if (revoke.status >= 500) return exploited(`grants path 5xx while revoking (${revoke.status})`, { principal: heir });
        if (revoke.status >= 400) {
          return refused(`revocation rejected with ${revoke.status} - app expects a different carry convention (document it in moduleCtx)`, { principal: heir, status: revoke.status });
        }
        // the "session opened after revocation": an ask from a FRESH round, not
        // a replay of the before-session answer
        const after = await postJson(harness, resolve, { principal: heir, capability: cap, session: 'post-revocation' });
        if (after.status >= 500) return exploited(`resolve path 5xx after revocation (${after.status})`, { principal: heir });
        const denied = isDeny(after, await readJson(after));
        if (denied === false) {
          return exploited(`revocation did not carry: "${heir}" still resolves ALLOW for "${cap}" in the post-revocation session (cached capability map?)`, { principal: heir, capability: cap });
        }
        if (denied === null) {
          return exploited(`post-revocation answer unreadable on resolve (${after.status})`, { principal: heir });
        }
        return refused(`revocation carried into the post-revocation session (denied)`, { principal: heir });
      },
    },

    {
      name: 'escrow-two-key-release',
      description: 'An escrowed operation releases only under TWO independent approvals - one principal self-signing twice must not pass',
      async run(harness, ctx = {}) {
        const escrow = ctx.escrowRoute;
        const missing = missingKnobs(ctx, ['escrowRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage)`, { missing, skipped: true });
        }
        const escrowId = 'escrow-two-key-4';
        const selfTwice = await postJson(harness, escrow, { escrow: escrowId, approvals: ['approver-self-1', 'approver-self-1'] });
        if (selfTwice.status >= 500) return exploited(`escrow path 5xx on the self-signed pair (${selfTwice.status})`, { escrow: escrowId });
        const released = selfTwice.status < 400 || isDeny(selfTwice, await readJson(selfTwice)) === false;
        if (released) {
          return exploited(`escrow failed the two-key gate: ONE principal signing twice released "${escrowId}" (self-approval must resolve to one principal)`, { escrow: escrowId });
        }
        return refused(`self-signed-twice did not release "${escrowId}" (denied or typed refusal)`, { escrow: escrowId });
      },
    },

    {
      name: 'escrow-expiry-is-fail-closed',
      description: 'An escrow past its TTL releases nothing and answers typed - silent past-TTL release is the classic class',
      async run(harness, ctx = {}) {
        const escrow = ctx.escrowRoute;
        const missing = missingKnobs(ctx, ['escrowRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage)`, { missing, skipped: true });
        }
        const escrowId = 'escrow-expired-5';
        const request = await postJson(harness, escrow, { escrow: escrowId, approvals: ['approver-a'], ttl: 0, expired: true });
        if (request.status >= 500) {
          return exploited(`escrow path 5xx could not even REGISTER the expired escrow - fail-closed means a typed refusal, not a fault (${request.status})`, { escrow: escrowId });
        }
        const released = request.status < 400 || isDeny(request, await readJson(request)) === false;
        if (released) {
          return exploited(`expiry is fail-OPEN: the ttl-0 escrow "${escrowId}" released (2xx/allow) - silent past-TTL release`, { escrow: escrowId });
        }
        return refused(`expired escrow "${escrowId}" answered closed (denied/refused)`, { escrow: escrowId });
      },
    },

    {
      name: 'escrow-refusal-is-typed',
      description: 'Denied releases answer with a typed reason naming who/what blocked them - raw 500s or blank errors are findings',
      async run(harness, ctx = {}) {
        const escrow = ctx.escrowRoute;
        const missing = missingKnobs(ctx, ['escrowRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - escrow skipped (export moduleCtx['governance'].escrowRoute for coverage)`, { missing, skipped: true });
        }
        const escrowId = 'escrow-refusal-6';
        const denied = await postJson(harness, escrow, { escrow: escrowId, approvals: [] }); // nothing approves -> must refuse
        if (denied.status >= 500) {
          return exploited(`refusal is UNtyped: the unapproved escrow "${escrowId}" answered ${denied.status} (raw 5xx) instead of a typed refusal`, { escrow: escrowId });
        }
        const body = await readJson(denied);
        const typed = denied.status >= 400 && (body
          ? ['reason', 'blocked', 'by', 'who', 'why', 'error'].some((k) => isObject(body) && body[k] != null && String(body[k]).length > 0)
          : true); // a plain-text 4xx body still names what blocked it - typed enough
        if (!typed) {
          return exploited(`refusal is BLANK: the denied escrow "${escrowId}" answered ${denied.status} with no reason payload naming the blocker`, { escrow: escrowId });
        }
        return refused(`refusal typed (status ${denied.status} with a reason payload) on "${escrowId}"`, { escrow: escrowId });
      },
    },

    {
      name: 'grant-conflict-deterministic',
      description: 'Two conflicting grants (allow/deny) resolve by declared precedence regardless of insertion order',
      async run(harness, ctx = {}) {
        const grants = ctx.grantsRoute;
        const resolve = ctx.resolveRoute;
        const missing = missingKnobs(ctx, ['grantsRoute', 'resolveRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage)`, { missing, skipped: true });
        }
        // deny carries HIGHER declared precedence (2) and is written SECOND:
        // the winner must be the declared-precedence winner, not last-write
        // and not arrival order.
        await postJson(harness, grants, { principal: 'p-conflict-7', capability: 'tenancy:write', permit: 'allow', precedence: 1 });
        await postJson(harness, grants, { principal: 'p-conflict-7', capability: 'tenancy:write', permit: 'deny', precedence: 2 });
        const ask = await postJson(harness, resolve, { principal: 'p-conflict-7', capability: 'tenancy:write' });
        if (ask.status >= 500) return exploited(`resolve path 5xx on the conflicting grants (${ask.status})`, { principal: 'p-conflict-7' });
        const denied = isDeny(ask, await readJson(ask));
        if (denied === false) {
          return exploited(`conflict resolved wrong: the precedence-2 DENY lost to the precedence-1 allow (declared precedence not honored)`, { principal: 'p-conflict-7' });
        }
        if (denied === null) {
          return exploited(`conflicting-grant answer unreadable on resolve (${ask.status})`, { principal: 'p-conflict-7' });
        }
        return refused('allow/deny conflict resolved by declared precedence (deny won)', { principal: 'p-conflict-7' });
      },
    },

    {
      name: 'capability-no-sideways',
      description: 'A grant scoped to brain/namespace A must not authorize writes into B even when the objects share a parent',
      async run(harness, ctx = {}) {
        const grants = ctx.grantsRoute;
        const resolve = ctx.resolveRoute;
        const missing = missingKnobs(ctx, ['grantsRoute', 'resolveRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - governance skipped (export moduleCtx['governance'].grantsRoute/resolveRoute for coverage)`, { missing, skipped: true });
        }
        const grant = await postJson(harness, grants, { principal: 'p-sideways-8', capability: 'notes:write', scope: 'brain/ledger-alpha', permit: 'allow' });
        if (grant.status >= 500) return exploited(`grants path 5xx while arming the sideways probe (${grant.status})`, { principal: 'p-sideways-8' });
        const ask = await postJson(harness, resolve, { principal: 'p-sideways-8', capability: 'notes:write', scope: 'brain/ledger-beta' });
        if (ask.status >= 500) return exploited(`resolve path 5xx on the sideways ask (${ask.status})`, { principal: 'p-sideways-8' });
        const denied = isDeny(ask, await readJson(ask));
        if (denied === false) {
          return exploited(`capability leaked sideways: ledger-alpha scope resolved ALLOW into brain/ledger-beta (shared parent, no isolation)`, { principal: 'p-sideways-8' });
        }
        if (denied === null) {
          return exploited(`sideways answer unreadable on resolve (${ask.status})`, { principal: 'p-sideways-8' });
        }
        return refused('sibling-namespace write denied (no sideways capability leak)', { principal: 'p-sideways-8' });
      },
    },

    {
      name: 'lock-ttl-honesty',
      description: 'A lock past TTL behaves exactly as the app documents it - the finding is the disagreement between the advertised mode and the actual behavior',
      async run(harness, ctx = {}) {
        const locks = ctx.locksRoute;
        const ttlMode = ctx.ttlMode;
        const missing = [!harness.listRoutes().includes(locks) ? 'locksRoute' : null, !ttlMode ? 'ttlMode' : null].filter(Boolean);
        if (missing.length) {
          return refused(`governance knob(s) ${missing.map((r) => `"${r}"`).join(', ')} not declared on this target - lock-ttl-honesty skipped (declare locksRoute + the DOCUMENTED ttlMode for coverage)`, { missing, skipped: true });
        }
        const resource = 'lock-ttl-9';
        const hold = await postJson(harness, locks, { resource, op: 'write', ttl: 0 });
        if (hold.status >= 500) return exploited(`locks path 5xx while arming the expired hold (${hold.status})`, { resource });
        const fresh = await postJson(harness, locks, { resource, op: 'write' });
        const freeNow = fresh.status < 400;
        if (ttlMode === 'held' && freeNow) {
          return exploited(`ttl dishonesty: "${resource}" documents held-past-TTL but a fresh writer GRANTED (${fresh.status}) after expiry`, { resource });
        }
        if (ttlMode === 'free' && !freeNow) {
          return exploited(`ttl dishonesty: "${resource}" documents free-past-TTL but a fresh writer was REFUSED (${fresh.status}) after expiry`, { resource });
        }
        return refused(`lock past TTL behaved as documented ("${ttlMode}", fresh writer ${freeNow ? 'granted' : 'refused'})`, { resource });
      },
    },

    {
      name: 'lock-owner-fencing',
      description: 'A stale holder writing through an expired fence token is refused loudly - a deleted-token write that succeeds is the fencing gap',
      async run(harness, ctx = {}) {
        const locks = ctx.locksRoute;
        const staleToken = ctx.staleToken;
        const missing = [!harness.listRoutes().includes(locks) ? 'locksRoute' : null, !staleToken ? 'staleToken' : null].filter(Boolean);
        if (missing.length) {
          return refused(`governance knob(s) ${missing.map((r) => `"${r}"`).join(', ')} not declared on this target - fencing skipped (declare locksRoute + staleToken for coverage)`, { missing, skipped: true });
        }
        const resource = 'lock-fence-10';
        const stale = await postJson(harness, locks, { resource, op: 'write', token: staleToken });
        if (stale.status >= 500) {
          return exploited(`fencing gap: the stale token write faulted with ${stale.status} - refusal must be loud AND shaped, not a crash`, { resource });
        }
        if (stale.status < 400 && isDeny(stale, await readJson(stale)) !== true) {
          return exploited(`fencing gap: writing through the expired fence token "${staleToken}" SUCCEEDED (${stale.status}) on "${resource}"`, { resource, staleToken });
        }
        return refused(`stale fence token refused loudly (${stale.status}) on "${resource}"`, { resource });
      },
    },
  ],
};
