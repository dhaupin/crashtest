// S1.1 - fake KV namespace (Workers KV surface subset used by handlers):
//   kv.get(key) / kv.put(key, value, {expirationTtl?}) / kv.delete(key) /
//   kv.list({prefix}) - TTLs are accepted and ignored (wall-clock leaks into
//   campaigns otherwise; determinism beats fidelity here, documented gap).

export class FakeKV {
  constructor(name, counter = null) {
    this.name = name;
    this._counter = counter;
    this._store = new Map();
  }

  async get(key, type) {
    this._counter?.increment('kv.get');
    const v = this._store.has(key) ? this._store.get(key) : null;
    if (v == null) return null;
    if (type === 'json') {
      try { return JSON.parse(v); } catch { return null; } // KV returns null on parse failure
    }
    return v;
  }

  async put(key, value, opts = {}) {
    this._counter?.increment('kv.put');
    this._store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return undefined;
  }

  async delete(key) {
    this._counter?.increment('kv.delete');
    this._store.delete(key);
  }

  async list({ prefix = '', limit = 1000 } = {}) {
    this._counter?.increment('kv.list');
    const keys = [...this._store.keys()]
      .filter(k => k.startsWith(prefix))
      .sort()
      .slice(0, limit)
      .map(k => ({ name: k }));
    // Storage-fill campaigns read list.truncated; fakes use full-scan counts.
    return { keys, list_complete: true, cursor: undefined };
  }

  /**
   * Deep copy of current store state, keyed map - the KV counterpart of
   * FakeD1.snapshot(), for the diff oracles (harness.snapshot/diff).
   * Reads NO counters: a snapshot is attack bookkeeping, not a campaign op.
   */
  snapshot() {
    const out = {};
    for (const [k, v] of this._store) out[k] = v;
    return out;
  }
}
