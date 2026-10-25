// WP hooks + WooCommerce-order vocabulary (issue #35) - the internal-hook
// surface plugin-side payment bridges complete money through. Teeth drive
// the real adapter (registerWordPress) against the STUB WP root, which
// carries the same wc-order + do-action vocabulary deterministically, so
// every checkout runs the whole thing with no live WooCommerce. Skips
// loudly when PHP is absent (never a fake pass).
//
// Wire under test:
//   cfg:        hookAllow { hook => max-args } rides the FIRST envelope
//   state op:   do-action (undeclared = LOUD fatal naming hookAllow)
//   state ops:  wc-create-order / wc-order-set-status / wc-order-get /
//               wc-order-get-meta / wc-order-delete (stub: HPOS-flavored
//               store + legacy CPT mirror so BOTH read paths grade)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHarness } from '../src/harness/harness.js';
import { registerAdapters } from '../src/adapters/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB_ROOT = join(REPO, 'fixtures', 'wordpress', 'stub-wp');

function phpAvailable() {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const php = phpAvailable();

function builtHarness() {
  const harness = buildHarness({}, { env: {} });
  registerAdapters(harness, {
    wordpress: {
      wpRoot: STUB_ROOT,
      phpBin: 'php',
      callAllow: { wp_create_nonce: 1 },
      allowOptions: ['ct_wc_money_funnel'],
      hookAllow: { woocommerce_order_status_processing: 2, woocommerce_payment_complete: 4 },
    },
  });
  return harness;
}

/** Harness.wpState replies carry { status, body, fatal, ops } - parse the body.
 Structured bodies (arrays/objects) parse; scalar bodies (meta strings, the
 do-action receipt) read as their raw value; empty body = null default. */
function parseReply(reply) {
  if (reply.fatal) return { fatal: reply.fatal };
  if (reply.body === '') return null;
  try { return JSON.parse(reply.body); } catch { return reply.body; }
}

test('wc-create-order seeds an order with fee total + binding meta, readable through BOTH store read paths (issue #35)', { skip: php ? false : 'PHP not available in this environment' }, async () => {
  const harness = builtHarness();
  const created = parseReply(await harness.wpState({
    kind: 'state', op: 'wc-create-order',
    fee: { name: 'processing fee', amount: '5.00' },
    meta: { _ct_binding: 'reg-42' },
  }));
  assert.ok(created.id > 0, 'the stub mints a deterministic order id');
  assert.equal(created.status, 'pending');

  // HPOS-flavored path: the WC meta API read (store-agnostic oracle).
  const viaApi = parseReply(await harness.wpState({ kind: 'state', op: 'wc-order-get-meta', id: created.id, key: '_ct_binding' }));
  assert.equal(viaApi, 'reg-42', 'the WC meta API read carries the binding meta');

  // Legacy CPT-store path: order id IS the post id; postmeta reads it.
  const viaPost = parseReply(await harness.wpState({ kind: 'state', op: 'post-meta', id: created.id, key: '_ct_binding' }));
  assert.equal(viaPost, 'reg-42', 'the cross-store replay surface resolves (get_meta == postmeta on legacy)');

  // The order oracle: getters stay store-agnostic.
  const got = parseReply(await harness.wpState({ kind: 'state', op: 'wc-order-get', id: created.id }));
  assert.equal(got.status, 'pending');
  assert.equal(got.total, '5', 'the fee line item rides the total');

  // Teardown symmetry (playbook rule 1: restore what you touch).
  const deleted = parseReply(await harness.wpState({ kind: 'state', op: 'wc-order-delete', id: created.id }));
  assert.equal(deleted, 1);
  const afterDelete = parseReply(await harness.wpState({ kind: 'state', op: 'wc-order-get-meta', id: created.id, key: '_ct_binding' }));
  assert.ok(
    afterDelete !== null && String(afterDelete.fatal ?? '').includes('no order at id'),
    'post-delete read refuses LOUDLY (no order at id) - never an empty-fake pass: ' + JSON.stringify(afterDelete),
  );
});

test('do-action is whitelist-gated exactly like callAllow: undeclared hook = loud fatal naming hookAllow (issue #35)', { skip: php ? false : 'PHP not available in this environment' }, async () => {
  const harness = builtHarness();
  const reply = await harness.wpState({ kind: 'state', op: 'do-action', hook: 'undeclared_completion_hook', args: [1] });
  assert.ok(
    (reply.fatal ?? '').includes('hook not allowed (declare it via hookAllow'),
    'no silent fire, no fake success: ' + (reply.fatal ?? '(no fatal)'),
  );
});

test('wc-order-set-status fires the REAL status hook; relayed events land in the funnel option (issue #35)', { skip: php ? false : 'PHP not available in this environment' }, async () => {
  const harness = builtHarness();
  const created = parseReply(await harness.wpState({
    kind: 'state', op: 'wc-create-order',
    fee: { name: 'fee', amount: '10.00' },
    meta: { _ct_binding: 'reg-7' },
  }));
  const started = parseReply(await harness.wpState({ kind: 'state', op: 'option', name: 'ct_wc_money_funnel' }));
  const startLen = Array.isArray(started) ? started.length : 0;

  const setStatus = parseReply(await harness.wpState({ kind: 'state', op: 'wc-order-set-status', id: created.id, status: 'processing' }));
  assert.equal(setStatus.status, 'processing');

  const funnel = parseReply(await harness.wpState({ kind: 'state', op: 'option', name: 'ct_wc_money_funnel' }));
  assert.ok(Array.isArray(funnel), 'the relay listener wrote the funnel row');
  assert.ok(funnel.length === startLen + 1, `exactly one relay on set-status (had ${startLen}, now ${funnel.length})`);
  const last = funnel[funnel.length - 1];
  assert.equal(last.event, 'status-processing');
  assert.equal(last.id, created.id, 'the order id rides the hook args');
});

test('do-action under hookAllow fires the declared completion relay with arg bounds (issue #35)', { skip: php ? false : 'PHP not available in this environment' }, async () => {
  const harness = builtHarness();
  const created = parseReply(await harness.wpState({
    kind: 'state', op: 'wc-create-order',
    fee: { name: 'fee', amount: '20.00' },
    meta: { _ct_binding: 'reg-9' },
  }));
  const before = parseReply(await harness.wpState({ kind: 'state', op: 'option', name: 'ct_wc_money_funnel' }));
  const beforeLen = Array.isArray(before) ? before.length : 0;
  const fired = parseReply(await harness.wpState({
    kind: 'state', op: 'do-action',
    hook: 'woocommerce_payment_complete',
    args: [created.id, 'extra', 'args', 'are', 'sliced'],
  }));
  assert.equal(fired, 'hook-fired');
  const funnel = parseReply(await harness.wpState({ kind: 'state', op: 'option', name: 'ct_wc_money_funnel' }));
  assert.equal(funnel.length, beforeLen + 1, 'one payment relay fired');
  assert.equal(funnel[funnel.length - 1].event, 'payment');
  assert.equal(funnel[funnel.length - 1].id, created.id);
});
