// faked1.kv v0.2 - the issue #9 FakeKV breadth acceptance suite.
//
// The v0.1 pin (`kv.get/put/delete/list` + counters + snapshot shape)
// carries over; v0.2 adds the four breadth items the census measured:
// deterministic fake-clock TTLs, get() metadata parity, honest pagination,
// and a loud per-value size cap. No Date.now() anywhere - the clock is the
// FAKE_CLOCK_EPOCH constant plus a per-namespace override for tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeKV } from '../../src/harness/kv.js';
import { FAKE_CLOCK_EPOCH } from '../../src/harness/d1.js';
import { newBackendCounter } from '../../src/harness/counters.js';

const clock = (epoch = FAKE_CLOCK_EPOCH) => ({ clock: epoch });

function mkkv(opts = {}, counter = newBackendCounter()) {
  return { kv: new FakeKV('ns', counter, opts), counter };
}

// ---- deterministic fake-clock TTLs ----
test('v0.2: TTL expiry reads against the FIXED clock (same seed -> same output)', async () => {
  const { kv } = mkkv(clock());
  await kv.put('ephemeral', 'gone-soon', { expirationTtl: 10 });
  assert.equal(await kv.get('ephemeral'), 'gone-soon', 'alive while clock < expiry (fixed clock = epoch + 10)');
  // hard absolute expiration BEHIND the namespace's clock: expired = gone
  await kv.put('stale', 'expired', { expiration: FAKE_CLOCK_EPOCH - 1 });
  assert.equal(await kv.get('stale'), null, 'expired = NOT PRESENT, deterministically');
  // a lapsed namespace (clock ahead of the epoch) sees the same stale key gone
  const lapsed = new FakeKV('ns2', null, { clock: FAKE_CLOCK_EPOCH + 60 });
  await lapsed.put('stale2', 'expired-early', { expiration: FAKE_CLOCK_EPOCH + 10 });
  assert.equal(await lapsed.get('stale2'), null);
  // the default clock itself: TTLs are relative to the namespace's clock
  assert.equal(await kv.get('ephemeral'), 'gone-soon');
});

test('v0.2: absolute expiration + getWithMetadata expose the record shape', async () => {
  const { kv } = mkkv(clock());
  await kv.put('row', '{"a":1}', { metadata: { owner: 'run-root' }, expiration: FAKE_CLOCK_EPOCH + 30 });
  const wm = await kv.getWithMetadata('row', { type: 'json' });
  assert.deepEqual(wm, { value: { a: 1 }, metadata: { owner: 'run-root' }, expiration: FAKE_CLOCK_EPOCH + 30 });
  const missing = await kv.getWithMetadata('nope');
  assert.deepEqual(missing, { value: null, metadata: null }, 'missing keys read as null/null (parity with get()');
  assert.equal(await kv.get('row', 'json').then((v) => v && v.a), 1);
});

test('v0.2: expired keys vanish from listings (and the fake scrubs them out)', async () => {
  const lapsed = new FakeKV('ns3', null, { clock: FAKE_CLOCK_EPOCH + 60 });
  await lapsed.put('live', '1');
  await lapsed.put('dead', '2', { expiration: FAKE_CLOCK_EPOCH + 10 });
  const listed = await lapsed.list({ prefix: '' });
  assert.deepEqual(listed.keys.map(k => k.name), ['live']);
  assert.equal(await lapsed.get('dead'), null);
});

// ---- honest pagination (a real cursor; never a fake list_complete) ----
test('v0.2: list paginates with a REAL cursor and honest list_complete', async () => {
  const { kv } = mkkv();
  for (const k of ['a1', 'a2', 'a3', 'b1']) await kv.put(k, k);
  const first = await kv.list({ prefix: '', limit: 2 });
  assert.deepEqual(first.keys.map(k => k.name), ['a1', 'a2']);
  assert.equal(first.list_complete, false);
  assert.ok(first.cursor);
  const second = await kv.list({ prefix: '', limit: 2, cursor: first.cursor });
  assert.deepEqual(second.keys.map(k => k.name), ['a3', 'b1']);
  assert.equal(second.list_complete, true, 'the tail page completes honestly');
  assert.equal(second.cursor, undefined);
});

test('v0.2: list can carry metadata/expiration per key (include: metadata)', async () => {
  const { kv } = mkkv(clock());
  await kv.put('m1', 'v', { metadata: { tag: 'x' }, expirationTtl: 5 });
  await kv.put('m2', 'v');
  const listed = await kv.list({ prefix: 'm', include: 'metadata' });
  assert.deepEqual(listed.keys, [
    { name: 'm1', metadata: { tag: 'x' }, expiration: FAKE_CLOCK_EPOCH + 5 },
    { name: 'm2' },
  ]);
});

// ---- loud value-size cap ----
test('v0.2: oversized values fail LOUDLY at cause (the real KV would refuse them)', async () => {
  const { kv } = mkkv({ maxBytes: 16 });
  await assert.rejects(
    kv.put('big', 'x'.repeat(17)),
    /value for "big" is 17 bytes \(cap: 16/,
  );
  await kv.put('ok', 'x'.repeat(16));
  await kv.put('json', { n: 1 }); // non-strings still cap via JSON length
  const listed = await kv.list();
  assert.deepEqual(listed.keys.map(k => k.name), ['json', 'ok']);
});

// ---- v0.1 contracts never regressed ----
test('v0.1: get/put/delete/json + counters + snapshot shape carry over', async () => {
  const { kv, counter } = mkkv();
  await kv.put('k', 'plain');
  assert.equal(await kv.get('k'), 'plain');
  await kv.put('j', { a: 1 });
  assert.deepEqual(await kv.get('j', 'json'), { a: 1 });
  assert.equal(await kv.get('missing'), null);
  await kv.delete('k');
  assert.equal(await kv.get('k'), null);
  assert.equal(counter.count('kv.get'), 4, 'get + get(json) + missing + post-delete read');
  assert.equal(counter.count('kv.put'), 2);
  assert.equal(counter.count('kv.delete'), 1);
  assert.deepEqual(kv.snapshot(), { j: '{"a":1}' }, 'snapshot keeps the string-only v0.1 shape');
  const listed = await kv.list({ prefix: 'j' });
  assert.deepEqual(listed.keys.map(k => k.name), ['j']);
  assert.equal(listed.list_complete, true);
});
