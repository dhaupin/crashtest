// Seed scenario library: 'memory' - issue #10, the general memory-row family
// for agent-shaped apps that persist notes and re-read them. All rows are
// deterministic, in-process, model-free: the patient is any app that (a)
// writes versioned notes, (b) reads them back, (c) merges/prunes them. The
// verdicts grade what the storage discipline DID, never what an LLM meant.
//
// Vocabulary (moduleCtx['memory']; undeclared knobs degrade to honest
// skipped-REFUSED - declare them for coverage, same law as every module):
//   writeRoute  - persists a note: POST { id, body, summary?, refs?, scope?,
//                 writers? } -> 2xx (4xx = the app refused the write, also a
//                 valid DEFENSE several rows accept)
//   readRoute   - reads notes back: returns JSON (a note object for one id,
//                 or an array; ids are matched wherever the app puts them)
//   deleteRoute - (optional) prunes a note: POST { id }
//   readStyle   - 'body' (POST { id }) by default, or 'query' (GET ?id=)
//
// Read-back contract (the fields the oracles read BY NAME when present):
//   writers [], revision (number), body, summary, refs [], scope,
//   deleted / tombstone markers. Absent fields simply fail the matching
//   acceptance - the row says so, rather than guessing.
//
// House laws: fixed ids/canaries (no wall clock, no randomness); a missing
// route is a skipped-REFUSED named by row; a 5xx anywhere is an EXPLOITED
// via the fuzz floor story (never stateful).

import { refused, exploited, fuzzFloorViolation } from '../contract.js';

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

// findNote: apps read back one note as an object or as a list - match id
// WHEREVER the app puts it (id field, or note.id in a returned map value).
function findNote(readBack, id) {
  if (readBack === null || readBack === undefined) return null;
  if (Array.isArray(readBack)) {
    const hit = readBack.find((n) => n && typeof n === 'object' && n.id === id);
    return hit ?? null;
  }
  if (typeof readBack === 'object') {
    if (readBack.id === id) return readBack;
    if (typeof readBack.note === 'object' && readBack.note?.id === id) return readBack.note;
    for (const v of Object.values(readBack)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && v.id === id) return v;
    }
  }
  return null;
}

const isObject = (n) => n && typeof n === 'object' && !Array.isArray(n);

// floorHit: the fuzz-floor gate for a record the row just produced. A thrown
// request (uncaught handler error - the harness reports status null) or a 5xx
// is a crash-grade EXPLOITED, never provable via a later read. null means the
// record rode the wire honestly and the row keeps grading its own oracle.
const floorHit = (record, label) => {
  const v = fuzzFloorViolation(record);
  return v ? exploited(`${label} broke the fuzz floor: ${v}`) : null;
};

// name the missing KNOB, not its undefined value - a skip that says
// `route "undefined"` names nothing (the honest-skip line is the docs).
const missingKnobs = (ctx, knobs, routes) => knobs.filter((k) => !ctx[k] || !routes.includes(ctx[k]));
const knobLine = (knobs) => knobs.map((k) => `"${k}"`).join(', ');

export default {
  name: 'memory',
  description: 'Memory discipline: note drift, hallucinated refs, resolution stability (no model needed)',

  attacks: [
    {
      name: 'drift-silent-overwrite',
      description: 'Two writers update the same fact without revision bumps - the read must surface the conflict or keep both provenance lines, never a silent blend',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-drift-1';
        const w1 = await postJson(harness, writeRoute, { id, body: 'balance ledger: 300', writers: ['writer-a'] });
        const firstFloor = floorHit(w1, 'first write');
        if (firstFloor) return firstFloor;
        const w2 = await postJson(harness, writeRoute, { id, body: 'balance ledger: 825', writers: ['writer-b'] });
        const secondFloor = floorHit(w2, 'second write');
        if (secondFloor) return secondFloor;
        // ...and a refusing FIRST writer is a defense too: no two-writer
        // conflict ever existed, so a later single-provenance read is not a
        // silent blend. This check runs FIRST - "second writer refused" would
        // imply the first succeeded, which a both-refused app never did.
        if (w1.status >= 400) {
          return refused(`first writer refused with ${w1.status} - the two-writer conflict was never staged on "${id}"`, { id, status: w1.status });
        }
        if (w2.status >= 400) {
          return refused(`second writer refused with ${w2.status} - no silent overwrite possible`, { id, status: w2.status });
        }
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" not found on read-back after a 2xx write - the CURRENT content is unknowable (nothing hands back the conflict or the winner)`, { id });
        }
        const surfaced = Array.isArray(note.writers) && note.writers.length >= 2
          || (typeof note.revision === 'number' && note.revision >= 2)
          || ['conflict', 'conflicting', 'disagree', 'diverge'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (!surfaced) {
          return exploited(`second write silently blended: "${id}" read back with single-provenance content and no revision/conflict trace (writers/revision/conflict required)`, { id });
        }
        return refused(`two-writer update surfaced on "${id}" (provenance or revision trace present)`, { id });
      },
    },

    {
      name: 'drift-stale-poisons-fresh',
      description: 'A fact written by a retired writer must not outrank the current writer for the same key - staleness beats recency = EXPLOITED',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-stale-2';
        const fresh = await postJson(harness, writeRoute, { id, body: 'relay window: open', writers: ['writer-current'], active: true });
        const freshFloor = floorHit(fresh, 'fresh-writer write');
        if (freshFloor) return freshFloor;
        const stale = await postJson(harness, writeRoute, { id, body: 'relay window: closed', writers: ['writer-retired'], retired: true });
        const staleFloor = floorHit(stale, 'retired-writer write');
        if (staleFloor) return staleFloor;
        if (stale.status >= 400) {
          return refused(`retired writer's write refused with ${stale.status} - staleness can never win`, { id, status: stale.status });
        }
        // A refused FRESH writer means the race was never staged: the retired
        // fact that remains is marked retired at the write, not a poison win.
        if (fresh.status >= 400) {
          return refused(`fresh writer refused with ${fresh.status} - no fresh/stale race was ever staged on "${id}"`, { id, status: fresh.status });
        }
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" not found on read-back after two 2xx writes - the stale/fresh rank is unverifiable`, { id });
        }
        const winsTheWindow = typeof note.body === 'string' && note.body.includes('closed')
          && !['stale', 'retired', 'supersede'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (winsTheWindow) {
          return exploited(`stale poison: the retired writer's fact is the current content of "${id}" with no stale/retired marker`, { id });
        }
        return refused(`stale writer's fact did not outrank the fresh one on "${id}" (refused, marked, or outranked)`, { id });
      },
    },

    {
      name: 'drift-contradiction-carry',
      description: 'A note whose body contradicts its own declared summary must be flagged by the read path',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-contra-3';
        const w = await postJson(harness, writeRoute, { id, summary: 'invoice total: 42', body: 'invoice total: 87' });
        const writeFloor = floorHit(w, 'contradictory-note write');
        if (writeFloor) return writeFloor;
        if (w.status >= 400) return refused(`contradictory note refused with ${w.status} - the write path already caught it`, { id, status: w.status });
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" vanished between write and read - the contradiction can never be graded`, { id });
        }
        const flagged = ['contradict', 'disagree', 'conflict', 'mismatch', 'flagged', 'inconsistent'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (!flagged) {
          return exploited(`contradiction carried silently: "${id}" reads back summary/content-wrong with no flag from the read layer`, { id });
        }
        return refused(`contradiction flagged on read-back of "${id}"`, { id });
      },
    },

    {
      name: 'hallucinated-fact-probe',
      description: 'A claim referencing a note id that never existed must be detectable on read-back (deterministic ghost key)',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-ghost-4';
        const ghostRef = 'note-ghost-0001'; // deterministic probe id: nothing ever wrote it
        const w = await postJson(harness, writeRoute, { id, body: 'inherit rate from', refs: [ghostRef] });
        const writeFloor = floorHit(w, 'ghost-ref write');
        if (writeFloor) return writeFloor;
        if (w.status >= 400) return refused(`ghost-referencing note refused with ${w.status} - unresolved claims cannot enter`, { id, status: w.status });
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" vanished between write and read - the ghost claim is unverifiable`, { id });
        }
        const detectable = note.refs?.includes(ghostRef)
          && ['unresolved', 'dangling', 'dead', 'missing', 'unknown', 'orphan'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (!detectable) {
          return exploited(`ghost claim undetectable: "${id}" cites "${ghostRef}" (never written) and read-back flags nothing unresolved`, { id, ghostRef });
        }
        return refused(`ghost reference detected on read-back of "${id}"`, { id });
      },
    },

    {
      name: 'citation-drift',
      description: 'A note citing an anchor that got deleted is a dangling claim - the read path must refuse it loudly',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const deleteRoute = ctx.deleteRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute', 'deleteRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - citation drift skipped (export moduleCtx['memory'].writeRoute/readRoute/deleteRoute for coverage)`, { missing, skipped: true });
        }
        const anchor = 'note-anchor-5';
        const citing = 'note-cites-5';
        const anchorW = await postJson(harness, writeRoute, { id: anchor, body: 'anchor fact: pinned' });
        const anchorFloor = floorHit(anchorW, 'anchor write');
        if (anchorFloor) return anchorFloor;
        const prune = await postJson(harness, deleteRoute, { id: anchor });
        const pruneFloor = floorHit(prune, 'anchor prune');
        if (pruneFloor) return pruneFloor;
        // A refused prune means the anchor is STILL LIVE - a citation to it is
        // not dangling, so the row refuses instead of grading a live paper
        // trail as drift (the old path graded a refusing delete as EXPLOITED).
        if (prune.status >= 400) {
          return refused(`anchor prune refused with ${prune.status} - "${anchor}" is still live, so a citation to it is not dangling`, { citing, status: prune.status });
        }
        const w = await postJson(harness, writeRoute, { id: citing, body: 'derived from anchor fact', refs: [anchor] });
        const writeFloor = floorHit(w, 'citing-note write');
        if (writeFloor) return writeFloor;
        if (w.status >= 400) return refused(`note citing the dead anchor refused with ${w.status} - dangling claims cannot enter`, { citing, status: w.status });
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id: citing }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), citing);
        if (!note) {
          return exploited(`note "${citing}" vanished between write and read - the dangling citation is unverifiable`, { citing });
        }
        const flagged = ['dangling', 'unresolved', 'dead', 'missing', 'stale', 'orphan'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (!flagged) {
          return exploited(`citation drift silent: "${citing}" reads back citing the deleted "${anchor}" with no dangling marker`, { citing, anchor });
        }
        return refused(`dangling citation flagged on read-back of "${citing}"`, { citing });
      },
    },

    {
      name: 'phantom-scope',
      description: 'A private-scoped note must not inherit a wider scope when its content claims public provenance',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-scope-6';
        const w = await postJson(harness, writeRoute, { id, body: 'public provenance claimed in content', scope: 'private' });
        const writeFloor = floorHit(w, 'phantom-scope write');
        if (writeFloor) return writeFloor;
        if (w.status >= 400) return refused(`scope-provenance note refused with ${w.status}`, { id, status: w.status });
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" vanished between write and read - the scope claim is unverifiable`, { id });
        }
        if (note.scope && note.scope !== 'private') {
          return exploited(`phantom scope: "${id}" was written private but reads back scoped "${note.scope}" - the content claim widened it`, { id, scope: note.scope });
        }
        if (!note.scope) {
          return exploited(`scope not visible on read-back of "${id}" - a merged note with no recorded scope cannot prove it stayed private`, { id });
        }
        return refused(`"${id}" stayed private on read-back (content claim did not widen it)`, { id });
      },
    },

    {
      name: 'identity-merge-collision',
      description: 'Two agent identities that both wrote the same fact keep BOTH provenance lines through the merge - one vanished author is the silent-loss class',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-merge-7';
        const a = await postJson(harness, writeRoute, { id, body: 'same fact, identity alpha', writers: ['agent-alpha'] });
        const alphaFloor = floorHit(a, "identity alpha's write");
        if (alphaFloor) return alphaFloor;
        const b = await postJson(harness, writeRoute, { id, body: 'same fact, identity beta', writers: ['agent-beta'] });
        const betaFloor = floorHit(b, "identity beta's write");
        if (betaFloor) return betaFloor;
        if (b.status >= 400) {
          return refused(`second identity's write refused with ${b.status} - no silent merge possible`, { id, status: b.status });
        }
        // A refused alpha write means only beta's line ever landed - grading
        // the surviving line "lost provenance" punished the refusal defense.
        if (a.status >= 400) {
          return refused(`first identity's write refused with ${a.status} - the two-identity merge was never staged on "${id}"`, { id, status: a.status });
        }
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'read-back');
        if (readFloor) return readFloor;
        const note = findNote(await readJson(readRec), id);
        if (!note) {
          return exploited(`note "${id}" not found on read-back after two 2xx identity writes`, { id });
        }
        const kept = isObject(note) && (note.writers ?? note.authors ?? []);
        if (!Array.isArray(kept) || !kept.includes('agent-alpha') || !kept.includes('agent-beta')) {
          return exploited(`identity merge lost provenance: "${id}" reads back without BOTH agent-alpha and agent-beta lines (have: ${JSON.stringify(kept)})`, { id, kept });
        }
        return refused(`both identity provenance lines survived the merge on "${id}"`, { id });
      },
    },

    {
      name: 'resolution-order-stability',
      description: 'Resolving N conflicting facts must be a deterministic function of declared (precedence) inputs - same inputs twice, same winner, twice',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - memory skipped (export moduleCtx['memory'].writeRoute/readRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-resolve-8';
        const rounds = [
          { body: 'winner claim: precedence two', precedence: 2, writers: ['writer-two'] },
          { body: 'winner claim: precedence one', precedence: 1, writers: ['writer-one'] },
          { body: 'winner claim: precedence three', precedence: 3, writers: ['writer-three'] },
        ];
        const seedStatuses = [];
        for (const round of rounds) {
          const w = await postJson(harness, writeRoute, { id, ...round });
          const seedFloor = floorHit(w, `conflict-seed write (precedence ${round.precedence})`);
          if (seedFloor) return seedFloor;
          seedStatuses.push(w.status);
        }
        // A policy that refuses ALL conflicting writes never staged the
        // resolution problem - grading its deterministic refusal as an
        // "unstable winner" punished the defense (the old path did exactly
        // that once the read-back found nothing to resolve).
        if (seedStatuses.length && seedStatuses.every((s) => s != null && s >= 400)) {
          return refused(`all ${seedStatuses.length} conflict-seed writes refused (statuses: ${seedStatuses.join(', ')}) - no resolution to grade on "${id}"`, { id, statuses: seedStatuses });
        }
        const winnerOf = async (roundLabel) => {
          const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
          const readFloor = floorHit(readRec, `resolution read (${roundLabel})`);
          if (readFloor) return { floor: readFloor };
          const note = findNote(await readJson(readRec), id);
          if (!note) return null;
          return note.writers?.[0] ?? (typeof note.body === 'string' ? note.body.match(/writer-(one|two|three)/)?.[1] ?? note.body : null);
        };
        const first = await winnerOf('round-1');
        if (first?.floor) return first.floor;
        const second = await winnerOf('round-2');
        if (second?.floor) return second.floor;
        if (first === null || second === null) {
          return exploited(`winner of the "${id}" conflict is unreadable on read-back - resolution cannot be graded`, { id });
        }
        if (first !== second) {
          return exploited(`resolution unstable: conflicting facts on "${id}" resolved to "${first}" then "${second}" on identical inputs`, { id, first, second });
        }
        return refused(`resolution stable on "${id}": "${first}" twice (declared inputs, deterministic winner)`, { id, winner: first });
      },
    },

    {
      name: 'delete-is-loud',
      description: 'Pruning deletes must leave traceable residue (tombstone/prune trace) - a forget-claim with none is erased history',
      async run(harness, ctx = {}) {
        const writeRoute = ctx.writeRoute;
        const readRoute = ctx.readRoute;
        const deleteRoute = ctx.deleteRoute;
        const missing = missingKnobs(ctx, ['writeRoute', 'readRoute', 'deleteRoute'], harness.listRoutes());
        if (missing.length) {
          return refused(`vocabulary knob(s) ${knobLine(missing)} not declared on this target - delete skip (export moduleCtx['memory'].writeRoute/readRoute/deleteRoute for coverage)`, { missing, skipped: true });
        }
        const id = 'note-prune-9';
        const w = await postJson(harness, writeRoute, { id, body: 'to be pruned' });
        const writeFloor = floorHit(w, 'pre-prune write');
        if (writeFloor) return writeFloor;
        // A refused WRITE staged no note: a null read-back alone would read as
        // "silently erased history" - a lie about an app that never had the note.
        if (w.status >= 400) {
          return refused(`write refused with ${w.status} - no note was ever stored to prune on "${id}"`, { id, status: w.status });
        }
        const d = await postJson(harness, deleteRoute, { id });
        const deleteFloor = floorHit(d, 'prune');
        if (deleteFloor) return deleteFloor;
        // A refused prune is an honest "we don't delete" - not silent history.
        if (d.status >= 400) {
          return refused(`prune refused with ${d.status} - nothing was deleted, so there is no history to trace on "${id}"`, { id, status: d.status });
        }
        const readRec = await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } });
        const readFloor = floorHit(readRec, 'post-prune read-back');
        if (readFloor) return readFloor;
        const readBack = await readJson(readRec);
        const note = findNote(readBack, id);
        const tombstoned = note && ['deleted', 'tombstone', 'pruned', 'removed-by'].some((mark) => JSON.stringify(note).toLowerCase().includes(mark));
        if (!tombstoned) {
          return exploited(`delete is silent: "${id}" left no tombstone/prune trace on read-back (history erased without a residue)`, { id });
        }
        return refused(`prune of "${id}" left a traceable tombstone on read-back`, { id });
      },
    },
  ],
};
