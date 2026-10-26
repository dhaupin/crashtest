// wp-money-shapes teeth - the pack rode FIVE wire-shape mismatches against
// the shipped WP worker (all found walking the pack, round 20; every one
// graded quietly wrong on every root running the generic worker):
//
//   kind 'post'     - a kind the worker never had ('bad kind: post'): the
//                     volley graded 'held' on writes that never happened and
//                     gate-burst graded a stock target EXPLOITED off them
//   kind 'call' seed- fused call/state envelope: the call lane demands `fn`,
//                     so the insert-post seed was always a fatal (the
//                     attack "honestly" skipped forever, silently)
//   option key-only - the option op keys the ROW by `name`; key-only
//                     envelopes always fataled, so the receipt plant never
//                     happened
//   marker-in-ids   - posts-query returns POST IDS, never text rows; both
//                     volley oracles graded for marker text that can never
//                     appear in an ids body
//   seedId body.id  - insert-post returns a scalar id body, never {id}: a
//                     REAL successful insert graded as a null seed
//
// These teeth grade the pack through a WP-SPEAK fake harness that mimics
// the real wire contract (kind router, option `name` gate, scalar id
// bodies, ids-array posts-query with LIKE/compare semantics) - so the fixed
// oracles are exercised END to end at the same shape the host run roots
// labor under. The last test boots the real stub WP core (skips loudly on
// PHP-less hosts - never a fake pass).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/** url-decode a form body the way the worker's wp_parse_str sees it: brackets
 * ride the +/%5B encodings URLSearchParams applies, the worker decodes them
 * - the fake must too, or its key regexes cannot see the payload. */
const decodeForm = (s) => {
  const t = String(s).replace(/\+/g, ' ');
  try { return decodeURIComponent(t); } catch { return t; }
};

const pack = (await import('../packs/public/wp-money-shapes/index.js')).default;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const VOCAB = {
  postType: 'ct_reg',
  metaPaid: 'ct_paid',
  metaEmail: 'ct_email',
  optionKey: 'ct_receiver',
  action: 'ct_probe_action',
  nonceAction: 'ct_probe',
  pacedHints: ['rate limit', 'slowed'],
};
const ctxArmed = { seed: 1719, config: { 'wp-money-shapes': VOCAB } };

/** A WP-speak harness double: exactly the wire contract the shipped worker
 * enforces (state/call/request routing, option `name` gate, scalar id
 * bodies, ids-array posts-query with wp_parse_str-compare semantics).
 * `target` decides how the real request lane answers. Envelope law: kind
 * 'post' never existed on this wire - the fake throws on it so the
 * bad-kind class can never return. */
function wpSpeak(target) {
  const store = { options: {}, posts: [], nextId: 1, envelopes: [] };
  const matches = (actual, want, compare) => {
    const a = String(actual ?? ''); const w = String(want ?? '');
    return compare === '=' ? a === w : a.includes(w);
  };
  const harness = {
    listRoutes: () => ['app'],
    async wpState(req) {
      if (req.kind === 'post') {
        // THE root-cause pin: 'post' fatals on the real worker. Any pack
        // envelope here fails the tooth, never a silent oracle rewrite.
        throw new Error('wp-money-shapes tooth: envelope rode the nonexistent kind "post"');
      }
      store.envelopes.push(req);
      if (req.kind === 'call') {
        if (req.fn === 'wp_create_nonce') return { status: 200, headers: {}, body: 'ct-nonce-0001' };
        return { status: 200, headers: {}, body: '', fatal: 'call not allowed (declare it via callAllow in your run-root config): ' };
      }
      if (req.kind === 'state') {
        if (req.op === 'option') {
          if (!req.name || !(req.name === VOCAB.optionKey)) {
            // The worker's row gate: a non-declared name is a fatal, and a
            // fatal reply carries an EMPTY body (never a read result).
            return { status: 200, headers: {}, body: '', fatal: 'option not allowed (declare it via allowOptions in your run-root config): ' + req.name };
          }
          if (Object.hasOwn(req, 'value')) { store.options[req.name] = req.value; return { status: 200, headers: {}, body: String(req.value) }; }
          return { status: 200, headers: {}, body: String(store.options[req.name] ?? '') };
        }
        if (req.op === 'insert-post') {
          const id = store.nextId++;
          store.posts.push({ id, type: req.postType, title: req.fields?.post_title, meta: { ...(req.meta ?? {}) } });
          return { status: 200, headers: {}, body: String(id) };
        }
        if (req.op === 'post-meta') {
          const p = store.posts.find((x) => x.id === req.id);
          return { status: 200, headers: {}, body: String(p?.meta?.[req.key] ?? '') };
        }
        if (req.op === 'posts-query') {
          const hits = store.posts
            .filter((p) => p.type === req.postType && matches(p.meta?.[req.metaKey], req.metaValue, req.compare))
            .map((p) => p.id);
          return { status: 200, headers: {}, body: JSON.stringify(hits) };
        }
        if (req.op === 'delete-posts') {
          store.posts = store.posts.filter((p) => !matches(p.meta?.[req.metaKey], req.metaValue, req.compare));
          return { status: 200, headers: {}, body: '0' };
        }
      }
      if (req.kind === 'request') {
        // request-lane law: a real form POST, action named, urlencoded body.
        assert.ok(req.url.startsWith('/wp-admin/admin-post.php?action='), 'request envelopes ride the admin-post wire');
        assert.equal(req.method, 'POST', 'request envelopes carry the write method');
        assert.equal(typeof req.body, 'string', 'request envelopes carry a urlencoded body STRING');
        return target(req, store);
      }
      throw new Error('unknown envelope kind: ' + req.kind);
    },
  };
  harness._store = store;
  return harness;
}

test('wp-write-volley: quiet target holds, stuck target EXPLOITEDs on the ids oracle', async () => {
  const quiet = wpSpeak(() => ({ status: 400, headers: {}, body: 'no handler bound' }));
  const qv = await pack.attacks.find((a) => a.name === 'wp-write-volley').run(quiet, ctxArmed);
  assert.equal(qv.verdict, 'REFUSED', JSON.stringify(qv));
  assert.ok(qv.detail.includes('0 stuck'), JSON.stringify(qv));

  const stuck = wpSpeak((req, store) => {
    // A leaking surface: accepts the write and mints a post with the
    // submitted meta - the metaValue IS the receiver marker, so the
    // posts-query must see it through LIKE matching.
    const email = /meta_input\[ct_email\]=(ctwv\d+-\d)@/.exec(decodeForm(req.body))?.[1];
    if (!email) return { status: 400, headers: {}, body: 'no' };
    const id = store.nextId++;
    store.posts.push({ id, type: VOCAB.postType, title: 'leak', meta: { [VOCAB.metaEmail]: email } });
    return { status: 200, headers: {}, body: 'ok' };
  });
  const sv = await pack.attacks.find((a) => a.name === 'wp-write-volley').run(stuck, ctxArmed);
  assert.equal(sv.verdict, 'EXPLOITED', JSON.stringify(sv));
  assert.match(sv.detail, /write-volley stuck/);
});

test('wp-txn-replay: clean target keeps one receipt, double-mint target EXPLOITEDs', async () => {
  const clean = wpSpeak(() => ({ status: 403, headers: {}, body: 'denied' }));
  const cv = await pack.attacks.find((a) => a.name === 'wp-txn-replay').run(clean, ctxArmed);
  assert.equal(cv.verdict, 'REFUSED', JSON.stringify(cv));
  // The seed must GRADE, not skip: a real insert answers a scalar id body.
  assert.equal(typeof cv.planted, 'number', 'the scalar-id seedId contract must grade (never a null seed)');
  assert.ok(cv.planted > 0);

  const doubled = wpSpeak((req, store) => {
    // A double-minting callback: every accepted write POSTS a SECOND paid
    // registration against the RECEIVER email from the planted option - the
    // receiver-scoped ids count must reach two and grade the double.
    if (/meta_input\[ct_email\]=/.test(decodeForm(req.body))) {
      const id = store.nextId++;
      const receipt = store.options[VOCAB.optionKey];
      store.posts.push({ id, type: VOCAB.postType, title: 'dup', meta: { [VOCAB.metaPaid]: 'paid', [VOCAB.metaEmail]: receipt } });
      return { status: 200, headers: {}, body: 'ok' };
    }
    return { status: 403, headers: {}, body: 'denied' };
  });
  const dv = await pack.attacks.find((a) => a.name === 'wp-txn-replay').run(doubled, ctxArmed);
  assert.equal(dv.verdict, 'EXPLOITED', JSON.stringify(dv));
  assert.match(dv.detail, /SECOND registration/);
});

test('wp-gate-burst: paced wall REFUSEDs, unpaced surface EXPLOITEDs, nonce rides the real mint', async () => {
  let burst = 0;
  const paced = wpSpeak(() => {
    burst++;
    return burst <= 3
      ? { status: 403, headers: {}, body: 'probe=1 denied' }
      : { status: 429, headers: {}, body: 'rate limit hit - slowed' };
  });
  const pv = await pack.attacks.find((a) => a.name === 'wp-gate-burst').run(paced, ctxArmed);
  assert.equal(pv.verdict, 'REFUSED', JSON.stringify(pv));
  assert.match(pv.detail, /gate-burst held/);
  // The nonce must have been minted through the allowlisted seeder, never
  // fabricated on the JS side.
  assert.ok(paced._store.envelopes.some((e) => e.kind === 'call' && e.fn === 'wp_create_nonce'));

  const unpaced = wpSpeak(() => ({ status: 200, headers: {}, body: 'accepted' }));
  const uv = await pack.attacks.find((a) => a.name === 'wp-gate-burst').run(unpaced, ctxArmed);
  assert.equal(uv.verdict, 'EXPLOITED', JSON.stringify(uv));
  assert.match(uv.detail, /wall never tripped/);
});

test('wp-money-shapes: missing vocabulary degrades to the SKIPPED-REFUSED flag (issue #37 contract)', async () => {
  const quiet = wpSpeak(() => ({ status: 400, headers: {}, body: 'nothing' }));
  for (const name of ['wp-write-volley', 'wp-txn-replay', 'wp-gate-burst']) {
    const verdict = await pack.attacks.find((a) => a.name === name).run(quiet, { seed: 5, config: {} });
    assert.equal(verdict.verdict, 'REFUSED', `${name} on an unarmed root must be REFUSED`);
    assert.equal(verdict.skipped, true, `${name} must carry skipped: true - a bare "skip" key grades as a plain hold (the vacuous-green veil)`);
  }
});

test('wp-money-shapes armed e2e: the oracle wire grades on the real stub WP core', { skip: phpAvailable() ? false : 'PHP not available in this environment' }, async () => {
  const { buildHarness } = await import('../src/harness/harness.js');
  const { registerWordPress } = await import('../src/adapters/wordpress.js');
  const harness = buildHarness({}, {});
  registerWordPress(harness, {
    app: {
      wpRoot: join(REPO, 'fixtures', 'wordpress', 'stub-wp'),
      phpBin: 'php',
      callAllow: { wp_create_nonce: 1 },
      allowOptions: [VOCAB.optionKey],
    },
  });
  // txn-replay must GRADE on the real wire now: the state-lane plant mints
  // a real post id and reads back paid; the stock stub has no payment
  // callback registered, so the honest verdict is REFUSED with the planted
  // receipt - and NOT the old silent seed-skip.
  const replay = await pack.attacks.find((a) => a.name === 'wp-txn-replay').run(harness, ctxArmed);
  assert.equal(replay.verdict, 'REFUSED', JSON.stringify(replay));
  assert.ok(!replay.skipped, 'the armed replay must grade, never skip (the seed wire works)');
  assert.equal(typeof replay.planted, 'number', 'a real post id came back through the scalar-id seed');
  assert.ok(replay.planted > 0);

  // The volley on the stub's unregistered action dies the honest die shape
  // for every write - held, zero stuck.
  const volley = await pack.attacks.find((a) => a.name === 'wp-write-volley').run(harness, ctxArmed);
  assert.equal(volley.verdict, 'REFUSED', JSON.stringify(volley));
  assert.ok(!volley.skipped, 'the armed volley must grade, never skip');
});

function phpAvailable() {
  try {
    execFileSync('php', ['-v'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
