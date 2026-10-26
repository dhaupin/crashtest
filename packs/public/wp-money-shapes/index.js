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
// wordpress.md for the per-shape allowlist). Oracle wires this pack grades
// on: posts-query returns POST IDS (array), never text rows; option rows
// are keyed by `name` with `key` slicing inside the row.
export default {
  name: 'wp-money-shapes',
  description: 'Plugin-agnostic WP payment-flow shapes (write-volley / txn-replay / gate-burst) for any install exposing a payment or registration flow',
  attacks: [{
    name: 'wp-write-volley',
    description: 'six anonymous writes with payment intent - surface must refuse them all',
    async run(harness, ctx) {
      if (unmounted(harness)) return refusedSkip('the wordpress adapter is not mounted (harness.wpState missing) - declare adapters: { wordpress: ... } in crashtest.config.js');
      const k = vocab(ctx);
      if (!k) return refusedSkip();
      const probeTag = 'ctwv' + String(ctx.seed ?? 0);
      let stuck = 0; let faulted = 0; let attempts = [];
      for (let i = 0; i < 6; i++) {
        const marker = `${probeTag}-${i}`;
        const rec = await formPost(harness, k, writeBody(k, marker));
        if (rec?.threw || rec?.status >= 500 || rec?.fatal) { faulted++; continue; }
        // 'stuck' = write looks accepted (2xx/publishable), anything that
        // got redirected or refused by wall logic does not count.
        if (rec?.status === null || rec?.status === 0 || rec?.status >= 300) continue;
        const look = await harness.wpState({
          kind: 'state', op: 'posts-query',
          postType: k.postType, metaKey: k.metaEmail, metaValue: marker,
        });
        // The posts-query wire returns POST IDS (fields=ids; ct_simple
        // JSON-encodes arrays), never marker text - the first cut graded for
        // the marker string INSIDE an ids body, which can never fire, so a
        // stuck write would have been graded "held" forever (orphans found
        // by walks round 20). Grade the array length: the query itself is
        // scoped to the marker, so one id back = the write stuck.
        if (idsOf(look).length >= 1) { stuck++; attempts.push({ i, marker, status: rec.status }); }
      }
      if (stuck > 0) return { verdict: 'EXPLOITED', detail: `write-volley stuck ${stuck}/6: anonymous writes with payment intent persisted (vol ${attempts.length ? JSON.stringify(attempts) : 'stuck-status'}); leak-scan can see them`, attempts };
      if (faulted >= 3) return { verdict: 'EXPLOITED', detail: `write-volley faulted the surface: ${faulted}/6 requests crashed it (5xx/throw)`, faulted };
      return { verdict: 'REFUSED', detail: `write-volley held: 0 stuck, ${faulted} faults (under 3), writes not visible to public query`, probeTag, faulted };
    },
  }, {
    name: 'wp-txn-replay',
    description: 'one planted paid receipt - the SAME payment callback must not mint a second paid registration',
    async run(harness, ctx) {
      if (unmounted(harness)) return refusedSkip('the wordpress adapter is not mounted (harness.wpState missing) - declare adapters: { wordpress: ... } in crashtest.config.js');
      const k = vocab(ctx);
      if (!k) return refusedSkip();
      const mark = 'ctreplay' + (ctx.seed % 10000);
      // Plant one paid receipt under a fixture receiver email (restore
      // whatever option we take - standing rule: restore what you touch).
      // Wire shape: the option op keys the ROW by `name` (a missing name is
      // a loud worker fatal) and `key` slices INSIDE the row - the first cut
      // sent key-only envelopes, which the shipped worker never honored, so
      // the receipt planting silently never happened (walk round 20).
      const savedEmail = await harness.wpState({ kind: 'state', op: 'option', name: k.optionKey });
      const plantRec = await harness.wpState({ kind: 'state', op: 'option', name: k.optionKey, value: `${mark}@ct-fixture.example.org` });
      if (plantRec?.fatal) {
        await harness.wpState({ kind: 'state', op: 'option', name: k.optionKey, value: savedEmail?.body ?? '' });
        return refusedSkip(`receipt receiver option "${k.optionKey}" is not writable - declare it via allowOptions (skip: ${String(plantRec.fatal).slice(0, 60)})`);
      }
      // Plant the receipt post in-process: the seeder op IS the STATE lane
      // (kind 'state' + op 'insert-post'). The first cut rode kind 'call'
      // with an op key - a fused envelope the whitelisted-call lane never
      // honored ('call not allowed: ') - so the seed always returned a
      // fatal and the attack honestly skipped forever, silently (walk
      // round 20). fields + meta plant the title and the paid/email marks
      // in one envelope; a read-back then CONFIRMS the plant before any
      // grading happens.
      const seed1 = await harness.wpState({
        kind: 'state', op: 'insert-post', postType: k.postType,
        fields: { post_title: `ct-fixture ${mark}` },
        meta: { [k.metaPaid]: 'paid', [k.metaEmail]: `${mark}@ct-fixture.example.org` },
      });
      const rid = seedId(seed1);
      if (!rid) return refusedSkip('seed insert failed - arm the seeder vocabulary (insert-post is a STATE op, not a call)');
      const paidBack = await harness.wpState({ kind: 'state', op: 'post-meta', id: rid, key: k.metaPaid });
      if (String(paidBack?.body ?? '') !== 'paid') {
        return refusedSkip(`planted receipt did not read back paid (body "${String(paidBack?.body ?? '').slice(0, 20)}") - the dock cannot grade without the plant`);
      }
      // Replay: SAME receipt id, second run - a second paid-like record is a double.
      // Oracle shape: the SAME posts-query-as-ids law the volley uses - the
      // rows that carry THIS receipt's receiver email, counted, never a text
      // search for the marker inside an ids body.
      const receiptEmail = `${mark}@ct-fixture.example.org`;
      let doubled = 0;
      for (let i = 0; i < 4; i++) {
        const rec = await formPost(harness, k, writeBody(k, `${mark}#${i}`));
        if (rec?.status === null || rec?.status === 0 || rec?.status >= 300) continue; // not stuck
        const look = await harness.wpState({ kind: 'state', op: 'posts-query', postType: k.postType, metaKey: k.metaEmail, metaValue: receiptEmail, compare: '=' });
        if (idsOf(look).length >= 2) { doubled++; break; }
      }
      await harness.wpState({ kind: 'state', op: 'delete-posts', postType: k.postType, metaKey: k.metaEmail, metaValue: mark, compare: 'LIKE' });
      await harness.wpState({ kind: 'state', op: 'option', name: k.optionKey, value: savedEmail?.body ?? '' });
      if (doubled > 0) return { verdict: 'EXPLOITED', detail: `txn-replay: same paid receipt minted a SECOND registration (double-payment accepted)`, planted: rid };
      return { verdict: 'REFUSED', detail: 'txn-replay: same id replayed, target kept exactly one paid registration per receipt', planted: rid };
    },
  }, {
    name: 'wp-gate-burst',
    description: '15 rapid flooder posts with a REAL nonce - the pacing wall must trip at least once with a clean denial',
    async run(harness, ctx) {
      if (unmounted(harness)) return refusedSkip('the wordpress adapter is not mounted (harness.wpState missing) - declare adapters: { wordpress: ... } in crashtest.config.js');
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
        const rec = await formPost(harness, k, burstBody(k, realNonce, ctx), { fromIp: ip });
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
  // The skip flag is `skipped` (the runner contract, PRD section 7 / issue
  // #37): the first cut shipped `skip: true` - a field nothing reads, so
  // every honest skip graded as a plain hold in the ledger (the exact
  // vacuous-green veil). Found walking this pack, round 20.
  return { verdict: 'REFUSED', skipped: true, detail: `wp-money-shapes not armed on this target${why ? ' - ' + why : '. Declare the moduleCtx vocabulary (postType, metaPaid, metaEmail, optionKey, action, nonceAction, pacedHints) to arm'}` };
}

// Adapter gate: every attack rides harness.wpState (WP adapter speak) - if the
// wordpress adapter is not mounted, skip HONESTLY instead of throwing, so a
// misfired config (this pack against a plain app) degrades to skipped-REFUSED,
// never a fabricated EXPLOITED row from a harness-wide fault (AGENTS.md rule 5).
function unmounted(harness) {
  return typeof harness?.wpState !== 'function';
}

function writeBody(k, marker) {
  return {
    [k.action]: 1,
    [k.postType]: 1,
    post_title: `probe ${marker}`,
    [`meta_input[${k.metaEmail}]`]: `${marker}@probe.example.org`,
  };
}

function burstBody(k, nonce, ctx = {}) {
  // Determinism (rule 4): zero wall-clock reads anywhere in the shipped
  // wire - the ts field is seed-derived once per burst, so two runs of the
  // same commit post byte-identical payloads (the paced-wall oracle reads
  // hints, not this field, but the wire itself obeys the law).
  return {
    [k.action]: 1,
    [k.nonceKey ?? 'nonce']: nonce,
    email: 'ctburst@probe.example.org',
    ts: (ctx.seed ?? 0xC0FFEE) % 1000000,
  };
}

// urlencode an object-shaped form payload - the worker's request lane
// parses the body string with wp_parse_str, so bracket keys map to arrays
// exactly like a browser form post.
function formEncode(payload) {
  if (typeof payload === 'string') return payload;
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) sp.append(key, String(value));
  return sp.toString();
}

// The write envelope, in worker speak: kind 'request' (the one real
// dispatch - see fixtures/wordpress/wp-worker.php ct_run_request), a
// urlencoded form body, the action named by the vocab, and an optional
// fromIp scoped as REMOTE_ADDR for pacing walls.
async function formPost(harness, k, body, opts = {}) {
  return harness.wpState({
    kind: 'request',
    method: 'POST',
    url: '/wp-admin/admin-post.php?action=' + encodeURIComponent(k.action),
    action: k.action,
    ...(opts.fromIp ? { remoteAddr: opts.fromIp } : {}),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode(body),
  });
}

// The posts-query oracle helper: parse the POST-ID list out of a state
// reply. `body` arrives as a JSON-encoded array string (or an already-
// parsed array, per envelope); anything unparsable grades as zero rows -
// an unreadable oracle refuses loudly upstream (the worker's own fatal),
// never as a fabricated finding.
function idsOf(look) {
  let v = look?.body;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  if (Array.isArray(v)) return v;
  return [];
}

function blobMentions(blob, sentinels) {
  if (Array.isArray(sentinels)) return sentinels.some(s => blob.includes(s));
  return blob.includes(sentinels);
}

function seedId(seedRec) {
  // The insert-post wire returns the new post id, ct_simple-style: a scalar
  // body ('\"42\"' after the envelope decode) - never an {id} object. The
  // first cut only looked for body.id / seedRec.id, so a REAL successful
  // insert graded as a null seed forever (walk round 20). Parse the scalar;
  // a zero (wp_error path) still grades as no-seed honestly.
  const body = seedRec?.body;
  if (body && typeof body === 'object') return body.id ?? null;
  const n = Number(body);
  return Number.isInteger(n) && n > 0 ? n : null;
}
