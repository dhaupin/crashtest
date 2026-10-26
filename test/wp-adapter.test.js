// WP adapter unit tests - the pure envelope functions; no WP install needed
// (the subprocess path needs a real WordPress root, so the e2e split lives
// in the khf-wp run root).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ctRequestToEnvelope, ctReplyToResponse } from '../src/adapters/wordpress.js';

const req = (method, url, { headers = {}, body = '' } = {}) =>
  // WHATWG Requests: GET/HEAD may never carry a body - omit it entirely.
  method === 'GET' || method === 'HEAD'
    ? new Request(url, { method, headers })
    : new Request(url, { method, headers, body });

test('envelope: admin-post url infers admin_post dispatch + action', async () => {
  const e = await ctRequestToEnvelope(req('POST', 'https://t.local/wp-admin/admin-post.php?action=acme_buy&a=1'));
  assert.equal(e.dispatch, 'admin_post');
  assert.equal(e.action, 'acme_buy');
  assert.equal(e.method, 'POST');
  assert.ok(e.url.includes('acme_buy'));
});

test('envelope: non-admin url falls back to template_redirect', async () => {
  const e = await ctRequestToEnvelope(req('POST', 'https://t.local/?acme_ipn=1'));
  assert.equal(e.dispatch, 'template_redirect');
});

test('envelope: cookie header parses into the cookies map', async () => {
  const e = await ctRequestToEnvelope(req('GET', 'https://t.local/', { headers: { cookie: 'a=1; b=two%20bits' } }));
  assert.deepEqual(e.cookies, { a: '1', b: 'two bits' });
});

test('envelope: explicit x-ct-* escape hatches win', async () => {
  const e = await ctRequestToEnvelope(req('POST', 'https://t.local/?x=1', {
    headers: { 'x-ct-dispatch': 'template_redirect', 'x-ct-action': 'acme_thing', 'x-ct-remote-addr': '203.0.113.9' },
  }));
  assert.equal(e.dispatch, 'template_redirect');
  assert.equal(e.action, 'acme_thing');
  assert.equal(e.remoteAddr, '203.0.113.9');
});

test('reply: fatal becomes 500 with the detail surfaced', () => {
  const r = ctReplyToResponse({ id: 'x', status: null, headers: {}, body: '', redirect: null, wp_die: 0, fatal: 'TypeError: boom', ops: { queries: 3 } });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get('x-ct-fatal'), 'TypeError: boom');
  assert.ok(r.headers.get('x-ct-ops').includes('"queries":3'));
});

test('reply: redirect + wp_die map to honest statuses', () => {
  const r = ctReplyToResponse({ id: 'x', status: null, headers: {}, body: '', redirect: 'https://t.local/?ok=1', wp_die: 0, fatal: null, ops: { queries: 1 } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), 'https://t.local/?ok=1');
  const d = ctReplyToResponse({ id: 'x', status: 403, headers: {}, body: 'denied', redirect: null, wp_die: 1, fatal: null, ops: { queries: 1 } });
  assert.equal(d.status, 403);
  assert.equal(d.headers.get('x-ct-wp-die'), '1');
});

// edge-walk tooth (determinism, rule 4): the adapter is a shipped surface -
// the wire ids that ride every envelope must not come from unseeded
// randomness. Generator: process-monotonic counter (deterministic per run).
test('wp adapter src is FLAT: no Math.random / Date.now in the shipped adapter surface', async () => {
  const { readFileSync } = await import('node:fs');
  const { dirname, join: joinPath } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(joinPath(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'adapters', 'wordpress.js'), 'utf8');
  assert.doesNotMatch(src, /Math\.random\(/, 'unseeded randomness on a shipped surface breaks same-commit -> same-wire');
  assert.doesNotMatch(src, /Date\.now\(/, 'wall-clock reads on a shipped surface break determinism');
});
