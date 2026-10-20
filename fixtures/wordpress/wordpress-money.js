// Scenario library: 'wordpress-money' — the first WP/PHP scenario pack,
// seeded from the khf-wp plugin's red-team findings (G-01..G-20). The
// envelope shapes stay plugin-agnostic (every WP plugin exposes admin_post
// handlers + template_redirect surfaces); the khf-flavored oracles (fm_ CPT
// + meta keys, fm_mark_registration_paid) ride the fixture ops the worker
// whitelists. Target-config prerequisites (attackCtx:
// 'wordpress-money/<attack>'):
//   ticketAction — the admin_post action slug for a purchase handler
//   paypalEmail  — the receiver fixture email (the widget pool validates it)
import { refused, exploited, bounded } from '../../src/scenarios/contract.js';

const NS = () => 'ct' + Date.now().toString(16); // attacker frame per run

const fuzzNames = [
  'A'.repeat(256), '<script>alert(1)</script>', '🦀'.repeat(64), 'a\0b',
  '{"x":9}', '=WEBSERVICE("http://pwn")', String.fromCharCode(0x2028),
];
const fuzzQty = ['9e9', '-5', '0', 'one', '1; DROP TABLE', '100000', '', '\t'];

async function adminPost(harness, { action, tag, body, ip, method = 'POST' }) {
  return harness.run('app', {
    method,
    url: `/wp-admin/admin-post.php?action=${action}&ct=${tag}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(ip ? { 'x-ct-remote-addr': ip } : {}) },
    body,
  });
}

export default {
  name: 'wordpress-money',
  description: 'WP plugin surfaces: nonce-less writes, hostile bodies, payment replays, gate bursts',

  attacks: [{
    name: 'wp-nonceless-writes',
    description: 'No/tampered nonce + hostile body fields against the purchase handler: never fatal, never a row',
    async run(harness, ctx) {
      const action = ctx.ticketAction ?? 'fm_ticket_purchase';
      if (!harness.listRoutes().includes('app')) return exploited('wordpress harness route not mounted');
      const email = NS() + 'fuzz@probe.example.org';
      const scanPrefix = email.slice(0, 20);
      const before = await harness.wpState({ kind: 'state', op: 'count-emails', prefix: scanPrefix });
      if (before?.body === undefined) return exploited('state oracle unusable (worker wpState)');
      const bodies = [];
      for (const q of fuzzQty) for (const n of fuzzNames.slice(0, 3)) {
        bodies.push(
          `fm_ticket_nonce=&ticket_id=${ctx.ticketId ?? 1}` +
          `&ticket_qty=${encodeURIComponent(q)}&ticket_name=${encodeURIComponent(n)}` +
          `&ticket_email=${encodeURIComponent(email)}` +
          `&ticket_phone=814-555-0000&payment_method=check`);
      }
      bodies.push(`fm_ticket_nonce=${'A'.repeat(40)}&ticket_id=${ctx.ticketId ?? 1}&ticket_qty=1` +
        `&ticket_email=${encodeURIComponent(email)}&ticket_phone=814-555-0000&payment_method=check`);
      let fatals = 0; let sanity = true; let rows = 0;
      for (const body of bodies) {
        const rec = await adminPost(harness, { action, tag: 'fuzz', body, ip: '203.0.113.77' });
        if (rec.threw) { fatals++; break; }
        if ((rec.response?.headers?.get('x-ct-fatal') ?? '') !== '') { fatals++; }
        if (rec.status !== null && rec.status >= 500) { fatals++; }
        const loc = rec.response?.headers?.get('location') ?? '';
        // The plugin must redirect or die (never a silent 200 that writes a new row).
        if (loc && loc.includes('fm_ticket=')) sanity = sanity && true;
      }
      const after = await harness.wpState({ kind: 'state', op: 'count-emails', prefix: scanPrefix });
      rows = parseInt(after.body, 10) - parseInt(before.body, 10);
      if (fatals > 0 || rows !== 0) {
        return exploited(`nonce-less hostile volley broke the floor: fatals=${fatals} rows=${rows}`, { fatals, rows, attempts: bodies.length });
      }
      return refused(`all ${bodies.length} nonce-less hostile volleys refused (no fatals, no fixture rows)`, { attempts: bodies.length });
    },
  }, {
    name: 'wp-payment-replay',
    description: 'A leaked txn id replayed must never pay twice: seed A paid / B pending, replay ×2, B stays pending (G-05)',
    async run(harness, ctx) {
      // The receiver fixture is a khf-run artifact: seeded through the
      // whitelisted state op (probe.example.org only) AND RESTORED after —
      // a probe/restoration standing rule (mutating shared settings without
      // restore was the first crashtest-vs-khf incident; the khf G-05 suite
      // caught it as a REPRODUCED finding).
      const receiver = 'ct-replay-' + ((ctx.seed ?? 0xC0FFEE) >>> 0).toString(36) + '@probe.example.org';
      const prior = await harness.wpState({ kind: 'state', op: 'setting', key: 'fm_paypal_email' });
      const restoreEmail = String(prior.body ?? '');
      const seeded = await harness.wpState({ kind: 'state', op: 'setting', key: 'fm_paypal_email', value: receiver });
      if (String(seeded.body) !== receiver) return exploited('receiver fixture seed failed (state op setting)');
      const mark = ((ctx.seed ?? 0xC0FFEE) >>> 0).toString(36);
      const a = await harness.wpState({ kind: 'state', op: 'mkreg', prefix: `ctreplay${mark}a`, type: 'vendor' });
      const b = await harness.wpState({ kind: 'state', op: 'mkreg', prefix: `ctreplay${mark}b`, type: 'vendor' });
      const ridA = parseInt(a.body, 10); const ridB = parseInt(b.body, 10);
      if (!ridA || !ridB) return exploited('fixture seed failed (mkreg)');
      const paid = await harness.wpState({ kind: 'call', fn: 'fm_mark_registration_paid', args: [ridA, { gateway: 'paypal', txn_id: `CTREPLAY${mark}` }] });
      // khf's real money path returns 'marked' (idempotent re-marks return 'already').
      if (!/^(marked|already|paid)($|\n)/.test(String(paid.body ?? ''))) { await harness.wpState({ kind: 'state', op: 'delete-emails', prefix: `ctreplay${mark}` }); return exploited(`seed paid failed (${String(paid.body).slice(0, 40)})`); }
      const ipn = (custom) => 'payment_status=Completed&txn_type=_xclick'
        + `&mc_gross=75.00&txn_id=CTREPLAY${mark}&custom=${custom || ''}`
        + `&receiver_email=${encodeURIComponent(receiver)}&payer_email=replay${mark}@probe.example.org`;
      let markedB = false; let denied = 0;
      for (const custom of ['', String(ridB)]) {
        await harness.run('app', {
          method: 'POST',
          url: '/?fm_ipn=1',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: ipn(custom),
        });
        const bp = await harness.wpState({ kind: 'state', op: 'postmeta', id: ridB, key: '_fm_reg_paid' });
        if (String(bp.body) === 'paid') markedB = true; else denied++;
      }
      await harness.wpState({ kind: 'state', op: 'delete-emails', prefix: `ctreplay${mark}` });
      // Restore the shared receiver fixture (standing rule: restore what you touch).
      await harness.wpState({ kind: 'state', op: 'setting', key: 'fm_paypal_email', value: restoreEmail });
      if (markedB) return exploited('replayed txn id paid a SECOND registration (G-05 regression)', { regA: ridA, regB: ridB });
      return refused(`replay against reg ${ridB} denied ${denied}x — B stayed pending`, { regA: ridA, regB: ridB, denied });
    },
  }, {
    name: 'wp-gate-burst',
    description: 'Write-gate burst: 15 rapid nopriv sign-ins from one IP — the wall holds with clean 429-class denials (khf paced/ratelimit)',
    async run(harness, ctx) {
      const ip = `203.0.113.${(128 + (Math.abs((ctx.seed ?? 0xC0FFEE) % 100)))}`;
      const holder = NS();
      // A REAL nonce (whitelisted seeder): the security gate is on the way
      // to the pacing surface — with no nonce every mint died a redirect
      // earlier and the wall never got exercised (first pilot run proved
      // that shape: 15 mints, 0 paced).
      const nonce = await harness.wpState({ kind: 'call', fn: 'wp_create_nonce', args: ['fm_portal_login'] });
      const realNonce = String(nonce.body ?? '');
      if (!realNonce) return exploited('nonce seeder failed (whitelist call wp_create_nonce)');
      let fatals = 0; let paced = 0; let other = 0;
      for (let i = 0; i < 15; i++) {
        // fm_ts (fill-time seconds) must plausibly hug the submit — khf's
        // anti-spam tier lives BEFORE the pacing tier (first burst pilot
        // died at spam, which is why the wall never reached its pacing leg).
        const rec = await adminPost(harness, {
          action: 'fm_portal_login', tag: 'burst',
          body: `fm_portal_nonce=${encodeURIComponent(realNonce)}`
            + `&fm_portal_email=${encodeURIComponent(holder + 'burst@probe.example.org')}`
            + `&fm_ts=${Math.floor(Date.now() / 1000) - 5}`,
          ip,
        });
        if (rec.threw) { fatals++; break; }
        if ((rec.response?.headers?.get('x-ct-fatal') ?? '') !== '') { fatals++; break; }
        if (rec.status !== null && rec.status >= 500) fatals++;
        const loc = rec.response?.headers?.get('location') ?? '';
        if (loc.includes('paced') || loc.includes('ratelimit')) paced++;
        else if (loc.startsWith('http')) other++; // unknown/security/welcome style refusals
      }
      if (fatals > 0) return exploited(`burst broke the wall: ${fatals} faulting request(s)`, { fatals });
      if (paced < 1) return exploited(`15 real-nonce mints: ${paced} paced — the wall never tripped`, { paced, other });
      return refused(`gate held: ${paced} paced + ${other} earlier denials walked`, { paced, other });
    },
  }],
};
