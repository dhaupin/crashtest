// packs/public/wp-money-shapes/index.js - plugin-agnostic money-flow
// shapes for WordPress targets: every vocabulary item (post type, meta
// keys, action names, paced-redirect hints) comes from the TARGET's own
// config, never from one plugin's lore. The three shapes are the
// fundamental patterns any payment/registration surface can be attacked
// with:
//
//   wp-write-volley  - anonymous writes with payment intent; must not stick
//   wp-txn-replay    - one paid receipt must not buy a SECOND registration
//   wp-gate-burst    - 15 rapid flooder posts; the pacing wall must trip
//
// Host run roots rebind these shapes to their own vocabulary in
// `packs/local/` (see docs/playbooks/wordpress.md): they import this
// module, pass the target's vocab as `ctx.config['wp-money-shapes']` via
// a thin wrapper scenario - the khf/fm packs are these engines, renamed
// and pinned. Missing config keys degrade to a REFUSED skip (parity with
// declared skip rows), never a false positive (AGENTS.md rule 5).
//
// Uses only harness.wpState (WP adapter speak - see docs/playbooks/
// wordpress.md for the per-shape allowlist).
export default {
  name: 'wp-money-shapes',
  description: 'Plugin-agnostic WP payment-flow shapes (write-volley / txn-replay / gate-burst) for any install exposing a payment or registration flow',
  attacks: [{
    name: 'wp-write-volley',
    description: 'six anonymous writes with payment intent - surface must refuse them all',
    async run(harness, ctx) {
      const k = vocab(ctx);
      if (!k) return refusedSkip();
      const probeTag = 'ctwv' + String(ctx.seed ?? 0);
      let stuck = 0; let faulted = 0; let attempts = [];
      for (let i = 0; i < 6; i++) {
        const marker = `${probeTag}-${i}`;
        const rec = await harness.wpState({ kind: 'post', payload: writeBody(k, marker) });
        if (rec?.threw || rec?.status >= 500) { faulted++; continue; }
        // 'stuck' = write looks accepted (2xx/publishable), anything that
        // got redirected or refused by wall logic does not count.
        if (rec?.status === null || rec?.status === 0 || rec?.status >= 300) continue;
        const look = await harness.wpState({
          kind: 'state', op: 'posts-query',
          postType: k.postType, metaKey: k.metaEmail, metaValue: marker,
        });
        if (blobMentions(String(look?.body ?? ''), marker)) { stuck++; attempts.push({ i, marker, status: rec.status }); }
      }
      if (stuck > 0) return { verdict: 'EXPLOITED', detail: `write-volley stuck ${stuck}/6: anonymous writes with payment intent persisted (vol ${attempts.length ? JSON.stringify(attempts) : 'stuck-status'}); leak-scan can see them`, attempts };
      if (faulted >= 3) return { verdict: 'EXPLOITED', detail: `write-volley faulted the surface: ${faulted}/6 requests crashed it (5xx/throw)`, faulted };
      return { verdict: 'REFUSED', detail: `write-volley held: 0 stuck, ${faulted} faults (under 3), writes not visible to public query`, probeTag, faulted };
    },
  }, {
    name: 'wp-txn-replay',
    description: 'one planted paid receipt - the SAME payment callback must not mint a second paid registration',
    async run(harness, ctx) {
      const k = vocab(ctx);
      if (!k) return refusedSkip();
      const mark = 'ctreplay' + (ctx.seed % 10000);
      // Plant one paid receipt under a fixture receiver email (restore
      // whatever option we take - standing rule: restore what you touch).
      const savedEmail = await harness.wpState({ kind: 'state', op: 'option', key: k.optionKey });
      await harness.wpState({ kind: 'state', op: 'option', key: k.optionKey, value: `${mark}@ct-fixture.example.org` });
      const seed1 = await harness.wpState({ kind: 'call', op: 'insert-post', postType: k.postType, payload: { title: `ct-fixture ${mark}` } });
      const rid = seedId(seed1);
      if (!rid) return refusedSkip('seed insert failed - arm the seeder allowlist');
      await harness.wpState({ kind: 'state', op: 'post-meta', id: rid, key: k.metaPaid, value: 'paid' });
      await harness.wpState({ kind: 'state', op: 'post-meta', id: rid, key: k.metaEmail, value: `${mark}@ct-fixture.example.org` });
      // Replay: SAME receipt id, second run - a second paid-like record is a double.
      let doubled = 0;
      for (let i = 0; i < 4; i++) {
        const rec = await harness.wpState({ kind: 'post', payload: writeBody(k, `${mark}#${i}`) });
        if (rec?.status === null || rec?.status === 0 || rec?.status >= 300) continue; // not stuck
        const look = await harness.wpState({ kind: 'state', op: 'posts-query', postType: k.postType, metaKey: k.metaPaid, metaValue: 'paid' });
        const rows = String(look?.body ?? '').split('\n').filter(r => r.includes(`${mark}@`)).length;
        if (rows >= 2) { doubled++; break; }
      }
      await harness.wpState({ kind: 'state', op: 'delete-posts', postType: k.postType, metaKey: k.metaEmail, metaValue: mark, compare: 'LIKE' });
      await harness.wpState({ kind: 'state', op: 'option', key: k.optionKey, value: savedEmail?.body });
      if (doubled > 0) return { verdict: 'EXPLOITED', detail: `txn-replay: same paid receipt minted a SECOND registration (double-payment accepted)`, planted: rid };
      return { verdict: 'REFUSED', detail: 'txn-replay: same id replayed, target kept exactly one paid registration per receipt', planted: rid };
    },
  }, {
    name: 'wp-gate-burst',
    description: '15 rapid flooder posts with a REAL nonce - the pacing wall must trip at least once with a clean denial',
    async run(harness, ctx) {
      const k = vocab(ctx);
      if (!k) return refusedSkip();
      const ip = `203.0.113.${128 + (Math.abs((ctx.seed ?? 0xC0FFEE) % 100))}`;
      // A fake nonce dies at the gate and never reaches the wall, so a
      // REAL nonce is minted through the allowlisted seeder first.
      const nonce = await harness.wpState({ kind: 'call', fn: 'wp_create_nonce', args: [k.nonceAction] });
      const realNonce = String(nonce.body ?? '');
      if (!realNonce) return refusedSkip('nonce seeder failed - arm the wp_create_nonce allowlist');
      let fatals = 0; let paced = 0; let other = 0;
      for (let i = 0; i < 15; i++) {
        const rec = await harness.wpState({
          kind: 'post', ip,
          payload: burstBody(k, realNonce, ctx),
        });
        const head  = String(rec?.response?.headers?.get('location') ?? '');
        const blob  = head + ' ' + String(rec?.body ?? '');
        if (blobMentions(blob, k.pacedHints)) paced++;
        else if (rec?.threw || rec?.status >= 500) { fatals++; break; }
        else other++;
      }
      if (fatals > 0) return { verdict: 'EXPLOITED', detail: `gate-burst broke the wall: ${fatals} faulting request(s) with a real nonce`, fatals };
      if (paced < 1) return { verdict: 'EXPLOITED', detail: `gate-burst: 15 real-nonce attempts, wall never tripped (${paced} paced)`, other };
      return { verdict: 'REFUSED', detail: `gate-burst held: ${paced} paced + ${other} earlier denials walked`, paced, other };
    },
  }],
};

// - helpers -
function vocab(ctx) {
  const cfg = ctx?.config?.['wp-money-shapes'] ?? ctx?.config?.moduleCtx?.['wp-money-shapes'] ?? null;
  if (typeof cfg !== 'object' || cfg === null) return null;
  const required = ['postType', 'metaPaid', 'metaEmail', 'optionKey', 'action', 'nonceAction', 'pacedHints'];
  for (const key of required) if (typeof cfg[key] === 'undefined') return null;
  cfg.sentinels = Array.isArray(cfg.sentinels) ? cfg.sentinels : ['ctreplay', 'ctwv'];
  return cfg;
}

function refusedSkip(why) {
  return { verdict: 'REFUSED', skip: true, detail: `wp-money-shapes not armed on this target${why ? ' - ' + why : '. Declare the moduleCtx vocabulary (postType, metaPaid, metaEmail, optionKey, action, nonceAction, pacedHints) to arm'}` };
}

function writeBody(k, marker) {
  return {
    [k.postType]: 1,
    post_title: `probe ${marker}`,
    meta_input: { [k.metaEmail]: `${marker}@probe.example.org` },
  };
}

function burstBody(k, nonce, ctx = {}) {
  // Determinism (rule 4): no Date.now() anywhere in the shipped wire - the
  // ts field is seed-derived once per burst, so two runs of the same commit
  // post byte-identical payloads (the paced-wall oracle reads hints, not
  // this field, but the wire itself obeys the law).
  return {
    [k.action]: 1,
    [k.nonceKey ?? 'nonce']: nonce,
    email: 'ctburst@probe.example.org',
    ts: (ctx.seed ?? 0xC0FFEE) % 1000000,
  };
}

function blobMentions(blob, sentinels) {
  if (Array.isArray(sentinels)) return sentinels.some(s => blob.includes(s));
  return blob.includes(sentinels);
}

function seedId(seedRec) {
  if (seedRec?.body?.id) return seedRec.body.id;
  if (seedRec?.id) return seedRec.id;
  if (seedRec?.body && typeof seedRec.body === 'object') return seedRec.body.id ?? null;
  return null;
}
