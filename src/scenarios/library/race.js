// Seed scenario library: 'race' - PRD section 6 expansion: the concurrency
// dimension. The PRD's old wording said this needed "interleaved scheduling
// in the harness"; in-process the scheduling comes FREE: handlers under one
// Promise.all interleave at every await boundary (the fake D1/KV calls are
// async), which is exactly the read-before-write / write-after-read window
// the classic races live in. Two attacks, both honest-paired (every probe
// is a labeled concurrent burst, deterministic by microtask order - the
// same inputs always schedule the same way):
//
//   double-submit-idempotency : N concurrent POSTs carrying the SAME
//     idempotency key (ctx.submitKey) must land exactly ONE side effect.
//     Two 2xx-and-stored = the double-charge class (TOCTOU through
//     read-then-insert with an await gap) = EXPLOITED with both rows named.
//     One row + shaped 409s = REFUSED. (Unique-constraint or insert-or-refresh
//     both hold; the wires differ, the ledger doesn't care.)
//   concurrent-write-lost-update : two concurrent writers submit DIFFERENT
//     fields into the same logical record; after BOTH complete, every
//     submitted field must be present in the store. A record holding only
//     the last writer's fields is the silent last-write-stomps class
//     (naive full-record PUT) = EXPLOITED with the lost field named.
//     Per-field storage (or conflict-detecting writes) = REFUSED.
//
// ctx vocabulary: submitRoute (default 'charge'), submitKey, embedRoute
// (default 'profile'). D1 store reads are the oracles (ctx.db names the
// database binding, default 'DB'). Undeclared routes or missing tables skip
// honestly, same contract as every other library.

import { refused, exploited } from '../contract.js';

/** Honest burst: every submission is a labeled promise; all fire together
 * and finish in the order the (deterministic) scheduler lets them. */
async function burst(harness, route, submissions) {
  return Promise.all(submissions.map((s) => harness.run(route, s.init).then((rec) => ({ label: s.label, rec }))));
}

export default {
  name: 'race',
  description: 'Concurrency: idempotency keys that survive same-key bursts, and concurrent partial writes where nothing silently stomps a field it never saw',

  attacks: [{
    name: 'double-submit-idempotency',
    description: 'N concurrent POSTs with the SAME idempotency key must produce exactly ONE stored side effect - two acknowledged-and-stored submissions is the double-charge class (shaped 409 on the rest is the honest wall shape)',
    async run(harness, ctx = {}) {
      const route = ctx.submitRoute ?? 'charge';
      const submitKey = ctx.submitKey ?? 'idem-0001';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - race skipped (declare it for coverage)`, { route, skipped: true });
      }
      const init = (label) => ({
        method: 'POST',
        body: JSON.stringify({ idem: submitKey, user: 'rook', cents: 1400 }),
        headers: { 'content-type': 'application/json' },
      });
      const pair = await burst(harness, route, [
        { label: 'first', init: init('first') },
        { label: 'second', init: init('second') },
        { label: 'third', init: init('third') },
      ]);

      const acked = pair.filter((p) => !p.rec.threw && p.rec.status >= 200 && p.rec.status < 300);
      const conflicts = pair.filter((p) => !p.rec.threw && p.rec.status === 409);
      const threw = pair.filter((p) => p.rec.threw);
      const faults = [];
      if (acked.length > 1) faults.push(`${acked.length} submissions acknowledged with the SAME idempotency key`);
      if (threw.length) {
        faults.push(`${threw.length} submission(s) threw uncaught in the burst - the storage wall exists but the wire never shaped it (${String(threw[0].rec.error).slice(0, 70)})`);
      }
      if (conflicts.length && acked.length + conflicts.length !== pair.length && !threw.length) {
        faults.push(`shaped answers arrived that are neither 2xx nor 409 (statuses: ${pair.map((p) => p.rec.threw ? 'threw' : p.rec.status).join('/')})`);
      }
      const db = harness.env[ctx.db ?? 'DB'];
      if (!db) return refused(`no D1 binding "${ctx.db ?? 'DB'}" - cannot read the ledger-side truth (skip)`, { route, skipped: true });
      const rows = await db.prepare('SELECT id FROM charges WHERE cid = ?').bind(submitKey).all();
      const stored = rows?.results?.length ?? 0;
      if (stored > 1) {
        faults.push(`the store kept ${stored} charge rows under one key ("${submitKey}") - the double-charge landed`);
      }
      if (faults.length) {
        return exploited(`same-key burst on "${route}" broke idempotency: ${faults[0]}`, { route, submitKey });
      }
      return refused(
        `3-way same-key burst on "${route}" landed exactly one ${acked.length ? 'acknowledged' : 'shaped'} effect + ${conflicts.length} honest 409(s); the store held ${stored} row(s)`,
        { route, submitKey },
      );
    },
  }, {
    name: 'concurrent-write-lost-update',
    description: 'Two concurrent writers submit DIFFERENT fields into the same record; after both land, every submitted field must be present - a record holding only the last writer is the silent-stomp lost-update class',
    async run(harness, ctx = {}) {
      const route = ctx.embedRoute ?? 'profile';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - race skipped (declare it for coverage)`, { route, skipped: true });
      }
      // Field-split concurrent pair: writer A owns {name, beta}, writer B owns {email, alpha}.
      const writerA = { method: 'POST', body: JSON.stringify({ user: 'rook', name: 'rook-name', beta: 'beta-keep' }), headers: { 'content-type': 'application/json' } };
      const writerB = { method: 'POST', body: JSON.stringify({ user: 'rook', email: 'rook-mail', alpha: 'alpha-keep' }), headers: { 'content-type': 'application/json' } };
      const pair = await burst(harness, route, [
        { label: 'A (name/beta)', init: writerA },
        { label: 'B (email/alpha)', init: writerB },
      ]);
      const faults = [];
      if (pair.some((p) => p.rec.threw)) {
        const t = pair.find((p) => p.rec.threw);
        faults.push(`writer "${t.label}" threw uncaught in the burst (a never-guarded race window: ${String(t.rec.error).slice(0, 70)})`);
      }

      const db = harness.env[ctx.db ?? 'DB'];
      if (!db) return refused(`no D1 binding "${ctx.db ?? 'DB'}" - cannot read the storage-side truth (skip)`, { route, skipped: true });
      // The hardened shape stores PER-FIELD rows; the vulnerable shape stores
      // whole-record blobs. BOTH shapes must keep every submitted field.
      const asStr = (v) => (v == null ? '' : String(v));
      let found = { name: false, beta: false, email: false, alpha: false };
      const rows = await db.prepare('SELECT field, value FROM settings WHERE user = ?').bind('rook').all();
      for (const row of rows?.results ?? []) {
        const fv = asStr(row.field);
        if (fv === 'name' && asStr(row.value) === 'rook-name') found.name = true;
        if (fv === 'beta' && asStr(row.value) === 'beta-keep') found.beta = true;
        if (fv === 'email' && asStr(row.value) === 'rook-mail') found.email = true;
        if (fv === 'alpha' && asStr(row.value) === 'alpha-keep') found.alpha = true;
      }
      const blobRows = await db.prepare('SELECT json FROM blobs WHERE user = ?').bind('rook').all();
      for (const row of blobRows?.results ?? []) {
        let parsed = null;
        try { parsed = JSON.parse(asStr(row.json)); } catch { /* unparsable later */ }
        if (parsed) {
          if (parsed.name === 'rook-name') found.name = true;
          if (parsed.beta === 'beta-keep') found.beta = true;
          if (parsed.email === 'rook-mail') found.email = true;
          if (parsed.alpha === 'alpha-keep') found.alpha = true;
        }
      }
      const lost = ['name', 'beta', 'email', 'alpha'].filter((f) => !found[f]);
      if (lost.length) {
        faults.push(`fields lost in the concurrent write: ${lost.join(', ')} - the last writer's record replaced a concurrent write it never saw`);
      }
      if (faults.length) {
        return exploited(`concurrent pair on "${route}" lost data: ${faults[0]}`, { route });
      }
      return refused(
        `concurrent field-split pair both landed on "${route}" - all four submitted fields present in the store; no silent stomp`,
        { route },
      );
    },
  }],
};
