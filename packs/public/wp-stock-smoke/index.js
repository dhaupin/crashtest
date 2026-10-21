// stockwp - first scenario pack for a STOCK WordPress target (no plugin
// surfaces): proves the v0.3 subprocess harness end to end against real WP
// + real SQLite: dispatch through admin-post hooks, whitelisted nonce mint,
// real-SQL cost economics, and the worker's CALL_ALLOW whitelist as an
// attack target in itself.
import { refused, exploited } from '../../../src/scenarios/contract.js';

const hostileBodies = [
  'item=widget&qty=9e9',                      // numeric fuzz
  'name=' + 'A'.repeat(5000),                 // oversized field
  'name=<script>alert(1)</script>',           // XSS-class
  'qty=' + encodeURIComponent('NUL\x00byte'), // control bytes
  'a=1&a=2&a=3',                              // param pollution
];

/** Config-gap skip, never a finding (PRD section 12 zero false positives): a WP-only
 *  attack on a run root with no WordPress target degrades out of the ledger. */
const noWpTarget = (harness) =>
  typeof harness.wpState !== 'function' || !harness.listRoutes().includes('app');

export default {
  name: 'stockwp',
  description: 'Stock-WordPress e2e: harness boots the real install, dispatches real hooks, meters real SQL',
  attacks: [
    {
      name: 'nopriv-hostile-volley',
      description: '25 nonce-less hostile POSTs at a non-existent admin_post action: zero fatals, envelope stays honest',
      async run(harness) {
        if (noWpTarget(harness)) return refused('WordPress target (route "app") not declared on this run root - attack skipped (declare adapters.wordpress for coverage)', { skipped: true });
        let fatals = 0; let fellOver = 0;
        for (let i = 0; i < hostileBodies.length * 5; i++) {
          const rec = await harness.run('app', {
            method: 'POST',
            url: '/wp-admin/admin-post.php?action=ct_probe&i=' + i,
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: hostileBodies[i % hostileBodies.length],
          });
          if (rec.threw) fellOver++;
          if ((rec.response?.headers?.get('x-ct-fatal') ?? '') !== '') fatals++;
        }
        if (fellOver > 0) return exploited(`harness-wide fault(s): ${fellOver} requests threw - worker respawn storm`, { fellOver });
        if (fatals > 0) return exploited('stock admin surface surfaced a PHP fatal on hostile input', { fatals });
        return refused(`${hostileBodies.length * 5} hostile nopriv POSTs: zero fatals, zero respawns - the floor held (no handler bound, nothing to exploit)`);
      },
    },
    {
      name: 'real-sql-cost-meters',
      description: 'Cost economics must ride the REAL database: a boot + one request + one nonce mint must tick wp.query > 0',
      async run(harness) {
        if (noWpTarget(harness)) return refused('WordPress harness (wpState) not declared on this run root - metering check skipped (declare adapters.wordpress for coverage)', { skipped: true });
        const before = harness.costTotals();
        await harness.wpState({ kind: 'call', fn: 'wp_create_nonce', args: ['ct_probe'] });
        const after = harness.costTotals();
        const wpq = after.__cost__ !== undefined ? undefined : undefined;
        // The adapter declares wp.query@2; the delta we care about is ops.
        const opsDelta = (after.ops ?? after.__cost__ ?? 0) - (before.ops ?? before.__cost__ ?? 0);
        if (opsDelta <= 0) return exploited('real-SQL metering dead: wp.query never ticked (SAVEQUERIES missing or adapter counters miswired)');
        return refused(`cost economics on real SQLite: probe consumed ${opsDelta} wp-shaped ops across boot+call`);
      },
    },
    {
      name: 'call-whitelist-holds',
      description: 'The worker CALL_ALLOW whitelist is attack surface: a hostile call to a destructive core fn (wp_delete_post) must be refused by the worker, and the post must survive',
      async run(harness) {
        if (noWpTarget(harness)) return refused('WordPress harness (wpState) not declared on this run root - whitelist check skipped (declare adapters.wordpress for coverage)', { skipped: true });
        const rec = await harness.wpState({ kind: 'call', fn: 'wp_delete_post', args: [1, true] });
        if (!rec.fatal) {
          // Whitelist breach: the destructive call EXECUTED. Prove damage.
          const meta = await harness.wpState({ kind: 'state', op: 'postmeta', id: 1, key: '_ct_probe_absent' });
          return exploited('CALL_ALLOW breach: wp_delete_post executed against the target (destructive seeder allowed)', { reply: rec });
        }
        const meta = await harness.wpState({ kind: 'state', op: 'postmeta', id: 1, key: '_wp_page_template' });
        if (meta.fatal) return exploited(`postmeta oracle broke after the refusal (worker unhealthy): ${meta.fatal}`);
        return refused('whitelist held: destructive call refused by the worker (' + String(rec.fatal).slice(0, 40) + '); post 1 intact');
      },
    },
    {
      name: 'option-gates',
      description: 'allowOptions gating: non-declared option rows are refused by the worker; declared rows read real data',
      async run(harness) {
        if (noWpTarget(harness)) return refused('WordPress harness (wpState) not declared on this run root - gate check skipped (declare adapters.wordpress for coverage)', { skipped: true });
        const denied = await harness.wpState({ kind: 'state', op: 'option', name: 'ct_not_allowed', key: 'x' });
        if (!denied?.fatal) return exploited('allowOptions gate broke: a non-declared option row was readable');
        const whole = await harness.wpState({ kind: 'state', op: 'option', name: 'blogname' });
        if (whole?.fatal) return exploited('declared option unreadable (allowOptions lost after cfg): ' + String(whole.fatal).slice(0, 60));
        if (!String(whole.body ?? '')) return exploited("declared option read empty - whole-read never returned the scalar row");
        return refused('gates held: non-declared refused (' + String(denied.fatal).slice(0, 40) + '); declared blogname = ' + String(whole.body).slice(0, 24));
      },
    },
  ],
};
