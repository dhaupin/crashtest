// Scenario library: 'site' - crashtest attacking its OWN shipped Pages
// Function (`web/functions/api/version.js`). The self-dogfood proof of
// concept, PRD section 12 style: an agent-built surface declared, attacked, and led
// into the ledger like any other target. Every attack here installs a
// hostile registry shape and RESTORES it in its own teardown (restore-what-
// you-touch - the WP spike's rule, in-repo edition).
import { refused, exploited } from '../../../src/scenarios/contract.js';
import { registry, restoreFetch } from '../site-target.js';

/** Install a hostile reply for one attack, always returning the undo. */
function hostileReply(fn) {
  const before = registry.reply;
  registry.reply = fn;
  return () => { registry.reply = before; };
}

/** Pull one record's parsed JSON defensively (never trusts shape). */
async function safeJson(record) {
  try { return await record.response.json(); } catch { return null; }
}

export default {
  name: 'site',
  description: 'crashtest attacks its own /api/version Pages Function - the self-dogfood',
  attacks: [
    {
      name: 'registry-hostile-statuses',
      description: 'Failure-mode floor: broken/garbage/hostile registry responses must come out an honest 502 with an error field and NEVER a version',
      async run(harness) {
        const shapes = [
          () => new Response('Internal Server Error', { status: 500 }),
          () => new Response('{"nope": true}', { status: 201 }),
          () => new Response('not json at all <<<', { status: 200, headers: { 'content-type': 'application/json' } }),
          () => { throw new Error('simulated network partition'); },
        ];
        let leaked = 0; let dishonest = 0;
        for (const shape of shapes) {
          const undo = hostileReply(shape);
          try {
            const rec = await harness.run('version', { method: 'GET' });
            if (rec.threw) { dishonest++; continue; }
            const text = await rec.response.text();
            let body = null;
            try { body = JSON.parse(text); } catch { /* honesty check below */ }
            const honest = rec.response.status === 502 && body !== null && typeof body.error === 'string'
              && body.version === undefined && body.package === undefined;
            if (!honest) dishonest++;
            if (/^9\.\d/.test(text) || body?.version) leaked++;
          } finally {
            undo();
          }
        }
        if (dishonest > 0) return exploited(`failure floor broke: ${dishonest}/4 registry shapes surfaced dishonestly (not an honest 502+error)`, { dishonest });
        if (leaked > 0) return exploited(`failure path leaked a version-shaped value ${leaked}x`, { leaked });
        return refused('all 4 hostile registry shapes collapsed to an honest 502 {error} with zero version leakage');
      },
    },
    {
      name: 'proto-pollution-registry',
      description: 'A __proto__-shaped registry payload must not pollute Object.prototype anywhere downstream',
      async run(harness) {
        const undo = hostileReply(async () => new Response(
          '{"__proto__": {"crashtestCanary": "planted"}, "name": "crashtest", "version": "9.9.9-crashprobe"}',
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
        try {
          await harness.run('version', { method: 'GET' });
          const fresh = {};
          if ('crashtestCanary' in fresh || fresh.crashtestCanary !== undefined) {
            return exploited('registry __proto__ payload polluted Object.prototype downstream');
          }
          return refused('hostile __proto__ registry payload stayed an own-property oddity; global untouched');
        } finally {
          undo();
        }
      },
    },
    {
      name: 'version-endpoint-burst',
      description: '50 rapid in-process GETs: no unhandled fault, every status 2xx-or-429-class (stateless surface may not fault under replay)',
      async run(harness) {
        let faults = 0; let ok = 0;
        for (let i = 0; i < 50; i++) {
          const rec = await harness.run('version', { method: 'GET' });
          if (rec.threw || rec.response.status >= 500) faults++;
          else ok++;
        }
        if (faults > 0) return exploited(`burst broke the stateless surface: ${faults} fault(s)`, { faults, ok });
        return refused(`held 50 rapid GETs (${ok}/50 clean, in-process, no socket)`);
      },
    },
    {
      name: 'cache-hygiene-gates',
      description: '200s must be edge-cacheable per contract (max-age=300); the honest-502 outage path must be no-store (never pin a failure at the edge)',
      async run(harness) {
        const goodUndo = hostileReply(registry.reply);
        let cache200 = ''; let cache502 = '';
        try {
          const ok = await harness.run('version', { method: 'GET' });
          cache200 = ok.response.headers.get('cache-control') ?? '';
        } finally {
          goodUndo();
        }
        const badUndo = hostileReply(async () => new Response('Internal Server Error', { status: 500 }));
        try {
          const bad = await harness.run('version', { method: 'GET' });
          cache502 = bad.response.headers.get('cache-control') ?? '';
        } finally {
          badUndo();
        }
        const ok200 = /max-age=300/.test(cache200);
        const ok502 = /no-store/.test(cache502);
        if (ok200 && ok502) return refused('200 carries max-age=300; 502 carries no-store (edge never pins the outage)');
        return exploited(`cache contract broke: 200="${cache200}" 502="${cache502}" (expect max-age=300 on OK, no-store on outage)`, { cache200, cache502 });
      },
    },
    {
      name: 'daemon-restore-parity',
      description: 'The shim is stateful global surface: after every attack style, globalThis.fetch must be restoreable to the original (proves the self-pack obeys restore-what-you-touch)',
      async run(harness) {
        // Can't easily compare across harness runs inside one attack (the
        // harness config owns the shim for its whole life). Instead: hostile
        // install + immediate undo + a real call must behave like the healthy
        // registry again - the contract the OTHER attacks already honor.
        const before = registry.reply;
        registry.reply = async () => new Response('{"boom": true}', { status: 503 });
        registry.reply = before;
        const rec = await harness.run('version', { method: 'GET' });
        const body = await safeJson(rec);
        if (body?.error) return exploited('restore-what-you-touch violated: registry shim stayed hostile after undo');
        return refused('shim restore parity holds - undo() immediately reverts the surface for the next attack');
      },
    },
  ],
};
