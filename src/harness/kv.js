// S1.1 - fake KV namespace (Workers KV surface subset used by handlers).
//
// v0.1 surface (unchanged, campaign pins):
//   kv.get(key) / kv.get(key, 'json') / kv.put(key, value) / kv.delete(key) /
//   kv.list({ prefix }) - TTLs accepted, deterministic by design.
//
// v0.2 breadth (issue #9, measured from the vant census shapes):
//   - deterministic fake-clock TTLs: put({ expirationTtl | expiration }) +
//     get() past expiry reads as NOT PRESENT (Workers KV behavior); `now` is
//     FAKE_CLOCK_EPOCH by default (same seed -> same output; a campaign can
//     scrub an expired key exactly like a non-existent one, deterministically).
//   - get() metadata parity: kv.put(key, value, { metadata }) +
//     kv.getWithMetadata(key, { type }) -> { value, metadata, expiration } -
//     run-roots that branch on metadata stop silently mis-branching.
//   - honest pagination: kv.list({ prefix, limit, cursor }) returns
//     { keys: [{ name, expiration?, metadata? }], list_complete, cursor? }
//     with a REAL cursor (name-position), never a fake list_complete: true.
//   - value-size cap: put() throws a LOUD named error past maxBytes
//     (fails at cause; 25 MiB default mirrors the KV limit), instead of
//     silently storing a payload the real KV would refuse.
import { FAKE_CLOCK_EPOCH } from './d1.js';

const MAX_VALUE_BYTES = 25 * 1024 * 1024; // Workers KV per-value cap

export class FakeKV {
  /**
   * @param {string} name
   * @param {import('./counters.js').OpsCounter} [counter]
   * @param {object} [opts]
   * @param {number} [opts.maxBytes] per-value cap (default: the KV 25 MiB cap)
   * @param {number} [opts.clock] fixed epoch seconds for TTL math (default FAKE_CLOCK_EPOCH)
   */
  constructor(name, counter = null, opts = {}) {
    this.name = name;
    this._counter = counter;
    this._store = new Map(); // key -> { value: string, metadata: any|null, expiresAt: number|null }
    this._maxBytes = opts.maxBytes ?? MAX_VALUE_BYTES;
    this._clock = opts.clock ?? FAKE_CLOCK_EPOCH;
  }

  _sanitize(key, value, opts) {
    if (typeof value === 'string') {
      const bytes = Buffer.byteLength(value);
      if (bytes > this._maxBytes) {
        throw new Error(`crashtest-fake-kv[${this.name}]: value for "${key}" is ${bytes} bytes (cap: ${this._maxBytes} - the real Workers KV would refuse it; trim the payload or raise opts.maxBytes for the fake)`);
      }
    }
    const expiresAt = opts.expiration != null
      ? Number(opts.expiration)
      : (opts.expirationTtl != null ? this._clock + Number(opts.expirationTtl) : null);
    return {
      value: typeof value === 'string' ? value : JSON.stringify(value),
      metadata: opts.metadata ?? null,
      expiresAt,
    };
  }

  _valueOf(key) {
    const rec = this._store.get(key);
    if (!rec) return null;
    if (rec.expiresAt != null && rec.expiresAt <= this._clock) {
      // expired: behaves as not-present; the fake scrubs it out as well
      this._store.delete(key);
      return null;
    }
    return rec.value;
  }

  async get(key, typeOrOpts = undefined) {
    this._counter?.increment('kv.get');
    const opts = typeof typeOrOpts === 'object' && typeOrOpts !== null ? typeOrOpts : {};
    const type = (typeof typeOrOpts === 'string' ? typeOrOpts : opts.type) ?? undefined;
    const v = this._valueOf(key);
    if (v === null) return null;
    if (type === 'json') {
      try { return JSON.parse(v); } catch { return null; } // KV returns null on parse failure
    }
    return v;
  }

  async getWithMetadata(key, opts = {}) {
    this._counter?.increment('kv.get');
    const rec = this._store.get(key);
    if (!rec) return { value: null, metadata: null };
    const v = this._valueOf(key);
    if (v === null) return { value: null, metadata: null }; // expired or scrubbed
    let value = v;
    if (opts.type === 'json') {
      try { value = JSON.parse(v); } catch { value = null; }
    }
    const out = { value, metadata: rec.metadata ?? null };
    if (rec.expiresAt != null) out.expiration = rec.expiresAt;
    return out;
  }

  async put(key, value, opts = {}) {
    this._counter?.increment('kv.put');
    this._store.set(key, this._sanitize(key, value, opts));
    return undefined;
  }

  async delete(key) {
    this._counter?.increment('kv.delete');
    this._store.delete(key);
  }

  async list({ prefix = '', limit = 1000, cursor, include } = {}) {
    this._counter?.increment('kv.list');
    const keys = [...this._store.keys()]
      .filter(k => k.startsWith(prefix))
      .sort();

    // expired keys do not appear in listings (Workers KV semantics)
    const live = keys.filter(k => this._valueOf(k) != null || this._store.has(k)).filter((k) => {
      const rec = this._store.get(k);
      return rec == null ? false : (rec.expiresAt == null || rec.expiresAt > this._clock);
    });

    let start = 0;
    if (cursor != null) {
      start = live.findIndex(k => k > String(cursor));
      if (start === -1) start = live.length;
    }
    const page = live.slice(start, start + limit);
    let nextCursor;
    let list_complete = live.length <= start + limit;
    if (!list_complete) nextCursor = page.length ? page[page.length - 1] : undefined;
    return {
      keys: page.map(k => this._keyInfo(k, include)),
      list_complete,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
  }

  _keyInfo(k, include) {
    const rec = this._store.get(k);
    const info = { name: k };
    if (include === 'metadata' && rec?.metadata != null) info.metadata = rec.metadata; // absent stays absent (deep-equal shape)
    if (rec?.expiresAt != null) info.expiration = rec.expiresAt;
    return info;
  }

  /**
   * Deep copy of current store state, keyed map - the KV counterpart of
   * FakeD1.snapshot(), for the diff oracles (harness.snapshot/diff).
   * Reads NO counters: a snapshot is attack bookkeeping, not a campaign op.
   */
  snapshot() {
    const out = {};
    for (const [k, rec] of this._store) out[k] = rec.value;
    return out;
  }
}
