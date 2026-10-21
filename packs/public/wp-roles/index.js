// wp-roles - the role/callback dimension on the WP envelope wire (PRD
// section 8 experimental lane, shipped on the back of the stub-WP worker
// fixture). Every attack rides the REAL dispatch surface: admin-post
// callbacks resolved by the target's own hook registration, id supplied by
// the caller's cookies/x-ct-user-id, capability decisions made by the
// target's own current_user_can. Three wire rules:
//
//   nopriv-callback-denied      : the logged-out hit on a role-gated action
//     must die (wp_die 401/403 class). A 200 on the nopriv hook is the
//     classic bypass: someone registered a WRITE on both hooks.
//   low-privilege-callback-blocked: a seeded non-admin (subscriber/editor)
//     hitting the priv hook must die 403. A 200 (esp. probe-ok) means the
//     capability gate flipped for a user the role store never privileged.
//   capability-constants-hold   : the admin DOES pass the gate, and - the
//     decisive half - a low-priv request carrying a body-declared role
//     ("role=admin") must still die. Body roles feeding current_user_can
//     is the LLM-draft privilege flip class.
//
// ctx vocabulary (moduleCtx['wp-roles']): action (default 'ct_role_probe' -
// the stub fixture's gated callback), userAdmin (default 1), userSub
// (default 2), userEditor (default 3), seedCalls (defaults
// ['ct_create_user','ct_reset_users']), probe option nothing - verdicts
// read the wire, not the store. Degrades to honest skipped-REFUSED on any
// run root without a WordPress adapter (noWpTarget), same as stockwp.

import { refused, exploited } from '../../../src/scenarios/contract.js';

const noWpTarget = (harness) =>
  typeof harness.wpState !== 'function' || !harness.listRoutes().includes('app');

async function hit(harness, { method = 'POST', userId = 0, body = '', action, url = '/wp-admin/admin-post.php' }) {
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (userId) headers['x-ct-user-id'] = String(userId);
  const fullUrl = url + '?action=' + encodeURIComponent(action);
  const init = { method, url: fullUrl, headers };
  // GET/HEAD may never carry a wire body (the fetch contract refuses).
  if (method !== 'GET' && method !== 'HEAD') init.body = body;
  return harness.run('app', init);
}

const dieInfo = (rec) => {
  const wpDie = rec.response?.headers?.get('x-ct-wp-die');
  return wpDie ? Number(wpDie) : 0;
};

export default {
  name: 'wp-roles',
  description: 'WP role-callback discipline: nopriv hooks refuse, capability gates need a privileged seeded user, body-declared roles never flip current_user_can (experimental; vocabulary from ctx)',
  armedByKey: 'wp-roles',

  attacks: [
    {
      name: 'nopriv-callback-denied',
      description: 'The logged-out hit on the role-gated action must die on the wp_die path (401/403 class) - a 200 from the nopriv hook is the registration-bypass classic',
      async run(harness, ctx = {}) {
        if (noWpTarget(harness)) {
          return refused('WordPress target (route "app") not declared on this run root - attack skipped (declare adapters.wordpress for coverage)', { skipped: true });
        }
        const action = ctx.action ?? 'ct_role_probe';
        const rec = await hit(harness, { method: 'POST', body: 'probe=1', action });
        if (rec.threw) return exploited(`nopriv probe faulted the worker: ${String(rec.error).slice(0, 80)}`, { action });
        const status = rec.status;
        const died = dieInfo(rec);
        if (status === 200 && !died) {
          const body = await rec.response.text();
          return exploited(
            `nopriv callback answered 200 on "${action}" (${body.slice(0, 60)}) - the logged-out hook performs privileged work`,
            { action },
          );
        }
        const shaped = status === 401 || status === 403 || (died && status >= 400);
        if (!shaped) {
          return exploited(
            `nopriv callback on "${action}" answered ${status} without the wp_die shape - neither refused nor honest`,
            { action, status },
          );
        }
        return refused(`nopriv hook on "${action}" refuses (status ${status}, wp_die=${died}) - the registration keeps logged-out traffic out`, { action });
      },
    },

    {
      name: 'low-privilege-callback-blocked',
      description: 'Seeded low-privilege users (subscriber, editor) hitting the privileged hook must die 403 - a 200 flips the capability gate for a user the role store never privileged',
      async run(harness, ctx = {}) {
        if (noWpTarget(harness)) {
          return refused('WordPress target (route "app") not declared on this run root - attack skipped (declare adapters.wordpress for coverage)', { skipped: true });
        }
        const action = ctx.action ?? 'ct_role_probe';
        const users = [ctx.userSub ?? 2, ctx.userEditor ?? 3];
        const seedFns = ctx.seedCalls ?? ['ct_create_user', 'ct_reset_users'];
        const faults = [];
        let seeding = '';
        try {
          // Deterministic seeding: reset, then grant the low-priv identities.
          const reset = await harness.wpState({ kind: 'call', fn: seedFns[1], args: [] });
          if (reset?.fatal) {
            return refused(`identity seeding unavailable - declare "${seedFns[0]}" + "${seedFns[1]}" via callAllow in the run-root config (skip: ${String(reset.fatal).slice(0, 60)})`, { action, skipped: true });
          }
          const seeded = await harness.wpState({ kind: 'call', fn: seedFns[0], args: [users[0], ['subscriber']] });
          if (seeded?.fatal) {
            return refused(`identity seeding failed (${String(seeded.fatal).slice(0, 60)}) - skip, never a false positive`, { action, skipped: true });
          }
          await harness.wpState({ kind: 'call', fn: seedFns[0], args: [users[1], ['editor']] });
        } catch (e) {
          seeding = String(e).slice(0, 60);
        }
        if (seeding) {
          return refused(`identity seeding cross-wire failed (${seeding}) - skip`, { action, skipped: true });
        }
        for (const userId of users) {
          const rec = await hit(harness, { method: 'POST', userId, body: 'probe=1', action });
          if (rec.threw) { faults.push(`user ${userId}: worker fault - ${String(rec.error).slice(0, 60)}`); continue; }
          const died = dieInfo(rec);
          if (rec.status === 200 && !died) {
            faults.push(`user ${userId} (non-privileged seed) passed the gate: 200 ${String((await rec.response.text())).slice(0, 60)}`);
          } else if (rec.status < 400 && !died) {
            faults.push(`user ${userId}: status ${rec.status} is neither the die shape nor a deny`);
          }
        }
        if (faults.length) {
          return exploited(`capability gate flipped on "${action}": ${faults[0]} (+${faults.length - 1} more)`, { action });
        }
        return refused(`low-privilege seeds (${users.join(', ')}) all die on "${action}" (403 class) - the gate reads the role store, not the wire`, { action });
      },
    },

    {
      name: 'capability-constants-hold',
      description: 'The admin passes the gate, and the decisive half: a low-priv request carrying a body-declared role ("role=admin") must STILL die - current_user_can fed from request input is the LLM-draft privilege flip',
      async run(harness, ctx = {}) {
        if (noWpTarget(harness)) {
          return refused('WordPress target (route "app") not declared on this run root - attack skipped (declare adapters.wordpress for coverage)', { skipped: true });
        }
        const action = ctx.action ?? 'ct_role_probe';
        const userAdmin = ctx.userAdmin ?? 1;
        const userSub = ctx.userSub ?? 2;
        const seedFns = ctx.seedCalls ?? ['ct_create_user', 'ct_reset_users'];
        const faults = [];
        // Warm the seeded identities (same allowlist contract as attack two).
        try {
          const reset = await harness.wpState({ kind: 'call', fn: seedFns[1], args: [] });
          if (reset?.fatal) {
            return refused(`identity seeding unavailable - declare the seed calls via callAllow (skip: ${String(reset.fatal).slice(0, 60)})`, { action, skipped: true });
          }
          await harness.wpState({ kind: 'call', fn: seedFns[0], args: [userAdmin, ['administrator']] });
          await harness.wpState({ kind: 'call', fn: seedFns[0], args: [userSub, ['subscriber']] });
        } catch (e) {
          return refused(`identity seeding cross-wire failed (${String(e).slice(0, 60)}) - skip`, { action, skipped: true });
        }

        // (a) the privileged seed passes - the gate EXISTS and fires
        const adminRec = await hit(harness, { method: 'POST', userId: userAdmin, body: 'probe=1', action });
        if (adminRec.threw) return exploited(`admin probe faulted the worker: ${String(adminRec.error).slice(0, 80)}`, { action });
        const adminBody = await adminRec.response.text();
        if (adminRec.status !== 200 || !adminBody.includes('probe-ok')) {
          return exploited(`the ADMIN probe did not pass on "${action}" (status ${adminRec.status}, body ${adminBody.slice(0, 60)}) - the fixture vocabulary is not wired; this dock cannot yet grade capability flips`, { action, status: adminRec.status, skipped: true });
        }

        // (b) body-declared role on a low-priv user must NOT flip the gate
        const spoofed = await hit(harness, {
          method: 'POST', userId: userSub, body: 'role=admin&wp_capabilities=admin&probe=1', action,
        });
        if (spoofed.threw) {
          faults.push(`body-role probe faulted the worker: ${String(spoofed.error).slice(0, 70)}`);
        } else {
          const died = dieInfo(spoofed);
          if (spoofed.status === 200 && !died) {
            faults.push(`body-declared role flipped the gate: 200 ${String((await spoofed.response.text())).slice(0, 60)}`);
          } else if (spoofed.status < 400 && !died) {
            faults.push(`body-role probe answered ${spoofed.status} without the die shape`);
          }
        }
        if (faults.length) {
          return exploited(`body-declared identity reached the capability decision on "${action}": ${faults[0]} (+${faults.length - 1} more)`, { action });
        }
        return refused(`capability constants hold on "${action}": admin passes, subscriber + body-declared admin still dies - roles live in the seeded store, never the wire`, { action });
      },
    },
  ],
};
