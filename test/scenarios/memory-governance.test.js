// Two-way teeth for the #10/#11 library families: the same rows must skip
// honestly with no vocabulary, ALL-REFUSE a disciplined fixture app, and
// EXPLOIT its vulnerable twin - plus representative flips per family.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHarness } from '../../src/harness/harness.js';
import { runCampaign } from '../../src/campaigns/runner.js';

const RUN = async (harness, module, ctx) =>
  runCampaign(harness, [{ origin: 'library/test', module }], { moduleCtx: { [module.name]: ctx } });

// ---- the disciplined note store + governance app (hardened) -------------
class HardenedApp {
  constructor() {
    this.notes = new Map();       // id -> { ..., revision, writers[], scope, refs[], deleted? }
    this.grants = new Map();      // `principal|capability` -> precedence-ranked rows
    this.escrows = new Map();
    this.locks = new Map();
    this.staleTokens = new Set(); // fence tokens the app considers expired/revoked
  }

  noteRoutes() {
    return {
      'note-write': async ({ request }) => {
        const body = await request.json();
        const existing = this.notes.get(body.id);
        // the discipline: resolve refs against LIVE notes, refuse contradictions
        if (Array.isArray(body.refs)) {
          for (const ref of body.refs) {
            if (!this.notes.get(ref) || this.notes.get(ref).deleted) {
              return Response.json({ error: `unresolved ref ${ref}` }, { status: 409 });
            }
          }
        }
        if (body.summary && typeof body.body === 'string'
          && body.summary.replace(/\D/g, '') !== body.body.replace(/\D/g, '')) {
          return Response.json({ error: 'summary contradicts body' }, { status: 409 });
        }
        // retired writers cannot poison the current fact
        if (body.retired) return Response.json({ error: 'retired writer refused' }, { status: 409 });
        const revision = (existing?.revision ?? 0) + 1; // every write bumps
        const writers = [...new Set([...(existing?.writers ?? []), ...(body.writers ?? [])])];
        const scope = body.scope ?? existing?.scope ?? null;
        this.notes.set(body.id, { id: body.id, body: body.body, summary: body.summary, refs: body.refs, scope, writers, revision, precedence: body.precedence ?? existing?.precedence ?? 0 });
        return Response.json({ stored: true, revision }, { status: 201 });
      },
      'note-read': async ({ request }) => {
        const { id } = await request.json();
        if (id) {
          const note = this.notes.get(id);
          if (!note) return Response.json({ error: 'no such note' }, { status: 404 });
          // the read layer must FLAG a stored contradiction rather than blend
          const note2 = { ...note };
          if (note2.summary && typeof note2.body === 'string'
            && note2.summary.replace(/\D/g, '') !== note2.body.replace(/\D/g, '')) {
            note2.flag = 'summary-body-contradiction';
          }
          return Response.json(note2);
        }
        return Response.json([...this.notes.values()]);
      },
      'note-delete': async ({ request }) => {
        const { id } = await request.json();
        const note = this.notes.get(id);
        if (!note) return Response.json({ error: 'no such note' }, { status: 404 });
        this.notes.set(id, { ...note, deleted: true, tombstone: 'pruned-by-request' });
        return Response.json({ pruned: true });
      },
    };
  }

  govRoutes() {
    return {
      'grants': async ({ request }) => {
        const body = await request.json();
        const key = body.revoke ? `revoke|${body.principal}|${body.capability}` : `${body.principal}|${body.capability}`;
        const rows = this.grants.get(key) ?? [];
        rows.push(body);
        this.grants.set(key, rows);
        return Response.json({ recorded: true });
      },
      'resolve': async ({ request }) => {
        const { principal, capability, scope } = await request.json();
        // revocations carry first and loudest
        for (const rows of this.grants.values()) {
          if (rows.some((r) => r.revoke === true)) {
            for (const r of rows) if (r.principal === principal && r.capability === capability) {
              if (r.revoke === true || r.permit === 'deny') return Response.json({ permit: 'deny', reason: `revoked for ${principal}` }, { status: 403 });
            }
          }
        }
        const key = `${principal}|${capability}`;
        const rows = (this.grants.get(key) ?? []).filter((r) => !r.revoke);
        if (rows.length) {
          // scope isolation: the grant must name the exact scope asked for
          if (scope && rows.every((r) => r.scope !== scope)) {
            return Response.json({ permit: 'deny', reason: `no grant for scope ${scope}` }, { status: 403 });
          }
          // precedence winner (HIGHER number = higher authority)
          const winner = [...rows].sort((a, b) => (b.precedence ?? 0) - (a.precedence ?? 0))[0];
          if (winner.permit === 'deny') return Response.json({ permit: 'deny', reason: 'deny outranks by precedence' }, { status: 403 });
          // trust floor: deep-private needs trust >= 3 in the grant vocabulary
          if (scope === 'deep-private' && (winner.trust ?? 0) < 3) {
            return Response.json({ permit: 'deny', reason: 'below trust floor' }, { status: 403 });
          }
          return Response.json({ permit: 'allow', principal: rows[0].principal });
        }
        return Response.json({ permit: 'deny', reason: `no grant on file for ${principal}` }, { status: 403 });
      },
      'escrow': async ({ request }) => {
        const { escrow, approvals = [], ttl, expired } = await request.json();
        const seen = new Map();
        for (const approver of approvals) {
          if (seen.has(approver)) {
            return Response.json({ reason: `approver ${seen.get(approver)} and ${approver} resolve to one principal - two-key gate refused` }, { status: 403 });
          }
          seen.set(approver, approver);
        }
        if (expired === true) {
          return Response.json({ reason: `escrow ${escrow} is past its ttl${ttl === 0 ? ' (0)' : ''} - nothing releases, fail closed` }, { status: 410 });
        }
        if (!approvals.length) {
          return Response.json({ reason: `escrow ${escrow} refused by approvals: none on file` }, { status: 403 });
        }
        if (approvals.length < 2) {
          return Response.json({ reason: `escrow ${escrow} blocked by the two-key gate (one approval is not two)` }, { status: 403 });
        }
        return Response.json({ released: true, escrow });
      },
      'locks': async ({ request }) => {
        const { resource, op, token, ttl } = await request.json();
        // the fencing rule: a token on the stale list is a REVOKED leave -
        // nothing may write through it, loudly
        if (token && this.staleTokens.has(token)) {
          return Response.json({ reason: `fence token ${token} is expired for ${resource} - stale holder refused` }, { status: 403 });
        }
        const lock = this.locks.get(resource);
        if (!lock) {
          this.locks.set(resource, { held: token ?? true, ttl, mode: ttl === 0 ? 'free' : 'held', expired: ttl === 0 });
          return Response.json({ acquired: true });
        }
        if (lock.expired) {
          if (lock.mode === 'held') {
            return Response.json({ reason: `lock on ${resource} still held past its ttl (documented: held)` }, { status: 409 });
          }
          return Response.json({ acquired: true }); // documented mode: free-past-ttl
        }
        return Response.json({ reason: `lock on ${resource} held` }, { status: 409 });
      },
    };
  }
}

// the app's own fixture vocabulary: route names + the DOCUMENTED lock/escrow
// knobs the governance rows grade against (ttlMode 'free' = free-past-ttl is
// the documented mode this fixture implements)
const GOV_CTX = {
  grantsRoute: 'grants', resolveRoute: 'resolve', escrowRoute: 'escrow',
  locksRoute: 'locks', ttlMode: 'free', staleToken: 'fence-stale-000',
};

const hardApp = new HardenedApp();
hardApp.staleTokens.add(GOV_CTX.staleToken); // this app considers that token expired


const MEM_CTX = { writeRoute: 'note-write', readRoute: 'note-read', deleteRoute: 'note-delete' };

test('memory + governance load through the scenario contract (19 attacks, unique names)', async () => {
  const { loadScenarios } = await import('../../src/scenarios/loader.js');
  const mods = await loadScenarios([]);
  const memory = mods.find((m) => m.module.name === 'memory');
  const governance = mods.find((m) => m.module.name === 'governance');
  assert.equal(memory.module.attacks.length, 9, 'memory census');
  assert.equal(governance.module.attacks.length, 10, 'governance census');
});

test('honeft honest-skip: undeclared vocabulary degrades every row to skipped-REFUSED (never false positives)', async () => {
  const { loadScenarios } = await import('../../src/scenarios/loader.js');
  const mods = await loadScenarios([]);
  const run = await runCampaign(buildHarness({}), mods.filter((m) => ['memory', 'governance'].includes(m.module.name)), { moduleCtx: {} });
  assert.equal(run.tally.TOTAL, 19);
  assert.equal(run.exploited.length, 0, run.exploited.map((r) => `${r.id}: ${r.detail}`).join('\n'));
  assert.equal(run.rows.every((r) => r.verdict === 'REFUSED'), true, 'every row skips or refuses honestly');
});

test('two-way teeth: the disciplined fixture holds ALL 13 armed rows (memory all 9, governance arms gr/escrow/lock routes)', async () => {
  const { loadScenarios } = await import('../../src/scenarios/loader.js');
  const mods = await loadScenarios([]);
  const harness = buildHarness({ ...hardApp.noteRoutes(), ...hardApp.govRoutes() });
  const run = await runCampaign(harness, mods.filter((m) => ['memory', 'governance'].includes(m.module.name)), {
    moduleCtx: { memory: MEM_CTX, governance: GOV_CTX },
  });
  const bad = run.exploited;
  assert.deepEqual(bad, [], bad.map((r) => `${r.id}: ${r.detail}`).join('\n'));
  // every memory row ran (armed); governance lock rows need documented knobs (armed below)
  assert.equal(run.rows.filter((r) => r.module === 'memory').length, 9);
});

test('two-way teeth: the vulnerable twin flips representative rows (drift, resolution, escrow, sideways, fencing)', async () => {
  const vulnerableStore = {
    'note-write': async ({ request }) => {
      const body = await request.json();
      return Response.json({ stored: true });
    },
    'note-read': async () => Response.json({ id: 'note-drift-1', body: 'blended', writers: ['writer-b'] }),
    'note-delete': async () => Response.json({ pruned: true }),
  };
  const vulnerableGov = {
    'grants': async () => Response.json({ recorded: true }),
    'resolve': async () => Response.json({ permit: 'allow' }),
    'escrow': async () => Response.json({ released: true }),
    'locks': async () => Response.json({ acquired: true }),
  };
  const { loadScenarios } = await import('../../src/scenarios/loader.js');
  const mods = await loadScenarios([]);
  const harnessV = buildHarness({ ...vulnerableStore, ...vulnerableGov });
  const run = await runCampaign(harnessV, mods.filter((m) => ['memory', 'governance'].includes(m.module.name)), {
    moduleCtx: { memory: MEM_CTX, governance: GOV_CTX },
  });
  const flipped = new Set(run.exploited.map((r) => r.id));
  for (const id of [
    'memory/drift-silent-overwrite',      // silent blend + single-provenance read-back
    'memory/identity-merge-collision',    // one vanished author
    'governance/escrow-two-key-release',  // self-signed twice releases
    'governance/capability-no-sideways',  // ledger-alpha scope into ledger-beta
    'governance/lock-owner-fencing',      // stale fence token accepted
  ]) {
    assert.ok(flipped.has(id), `expected ${id} to EXPLOIT the vulnerable fixture; the run tripped: ${[...flipped].join(', ')}`);
  }
});

test('two-way teeth: the fencing half goes the OTHER way too - the hardened lock REFUSES the stale token', async () => {
  const { loadScenarios } = await import('../../src/scenarios/loader.js');
  const mods = await loadScenarios([]);
  const app = new HardenedApp();
  const harness = buildHarness(app.govRoutes());
  app.locks.set('lock-fence-10', { ownerToken: GOV_CTX.staleToken, tokenValid: false });
  const run = await runCampaign(harness, mods.filter((m) => m.module.name === 'governance'), { moduleCtx: { governance: { ...GOV_CTX, locksRoute: 'locks', staleToken: 'fence-stale-000' } } });
  const fence = run.rows.find((r) => r.attack === 'lock-owner-fencing');
  assert.equal(fence.verdict, 'REFUSED');
  assert.match(fence.detail, /refused loudly/);
  // and a stale holder GRANTED would be the EXPLOITED flip (pinned above via the vulnerable twin)
});
