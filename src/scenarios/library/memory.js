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
        const w2 = await postJson(harness, writeRoute, { id, body: 'balance ledger: 825', writers: ['writer-b'] });
        if (w1.status >= 500 || w2.status >= 500) {
          return exploited(`write path 5xx during the two-writer update (${w1.status}/${w2.status})`, { id });
        }
        // A refusing write is a valid defense (second writer told no).
        if (w2.status >= 400) {
          return refused(`second writer refused with ${w2.status} - no silent overwrite possible`, { id, status: w2.status });
        }
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        const stale = await postJson(harness, writeRoute, { id, body: 'relay window: closed', writers: ['writer-retired'], retired: true });
        if (fresh.status >= 500 || stale.status >= 500) {
          return exploited(`write path 5xx during the stale/fresh race (${fresh.status}/${stale.status})`, { id });
        }
        if (stale.status >= 400) {
          return refused(`retired writer's write refused with ${stale.status} - staleness can never win`, { id, status: stale.status });
        }
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        if (w.status >= 500) return exploited(`write path 5xx for the contradictory note (${w.status})`, { id });
        if (w.status >= 400) return refused(`contradictory note refused with ${w.status} - the write path already caught it`, { id, status: w.status });
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        if (w.status >= 500) return exploited(`write path 5xx for the ghost-ref note (${w.status})`, { id });
        if (w.status >= 400) return refused(`ghost-referencing note refused with ${w.status} - unresolved claims cannot enter`, { id, status: w.status });
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        await postJson(harness, writeRoute, { id: anchor, body: 'anchor fact: pinned' });
        await postJson(harness, deleteRoute, { id: anchor });
        const w = await postJson(harness, writeRoute, { id: citing, body: 'derived from anchor fact', refs: [anchor] });
        if (w.status >= 500) return exploited(`write path 5xx for the drifting citation (${w.status})`, { citing });
        if (w.status >= 400) return refused(`note citing the dead anchor refused with ${w.status} - dangling claims cannot enter`, { citing, status: w.status });
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id: citing }), headers: { 'content-type': 'application/json' } })), citing);
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
        if (w.status >= 500) return exploited(`write path 5xx for the phantom-scope note (${w.status})`, { id });
        if (w.status >= 400) return refused(`scope-provenance note refused with ${w.status}`, { id, status: w.status });
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        const b = await postJson(harness, writeRoute, { id, body: 'same fact, identity beta', writers: ['agent-beta'] });
        if (a.status >= 500 || b.status >= 500) {
          return exploited(`write path 5xx during the identity merge (${a.status}/${b.status})`, { id });
        }
        if (b.status >= 400) {
          return refused(`second identity's write refused with ${b.status} - no silent merge possible`, { id, status: b.status });
        }
        const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
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
        for (const round of rounds) {
          const w = await postJson(harness, writeRoute, { id, ...round });
          if (w.status >= 500) return exploited(`write path 5xx during the conflict seeding (${w.status})`, { id });
        }
        const winnerOf = async (roundLabel) => {
          const note = findNote(await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } })), id);
          if (!note) return null;
          return note.writers?.[0] ?? (typeof note.body === 'string' ? note.body.match(/writer-(one|two|three)/)?.[1] ?? note.body : null);
        };
        const first = await winnerOf('round-1');
        const second = await winnerOf('round-2');
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
        const d = await postJson(harness, deleteRoute, { id });
        if (w.status >= 500 || d.status >= 500) {
          return exploited(`5xx on the write/delete pair (${w.status}/${d.status})`, { id });
        }
        const readBack = await readJson(await harness.run(readRoute, { method: 'POST', body: JSON.stringify({ id }), headers: { 'content-type': 'application/json' } }));
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
