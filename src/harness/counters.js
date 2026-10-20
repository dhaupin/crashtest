// S1.1 — op counters + cost meters.
// Every fake backend op (D1 query, KV read/write, route invocation) ticks a
// named counter. Campaigns read the per-request delta to compute cost
// accounting: "backend ops per admitted vs refused request" (PRD §1.3).

export class OpsCounter {
  constructor() {
    this.counts = new Map();   // name -> count
    this.opCost = new Map();   // name -> cost per op (default 1)
  }

  /** Register (or re-price) an op counter with an optional unit cost (default 1). */
  declare(name, costPerOp = 1) {
    if (!this.counts.has(name)) this.counts.set(name, 0);
    this.opCost.set(name, costPerOp);
  }

  increment(name, times = 1) {
    const cur = this.counts.get(name) ?? 0;
    this.counts.set(name, cur + times);
  }

  count(name) {
    return this.counts.get(name) ?? 0;
  }

  /** Total weighted cost across all counters. */
  cost() {
    let total = 0;
    for (const [name, c] of this.counts) {
      total += c * (this.opCost.get(name) ?? 1);
    }
    return total;
  }

  /** Plain-object snapshot {name: count} plus derived cost. */
  snapshot() {
    const out = { __cost__: 0 };
    for (const [name, c] of this.counts) {
      out[name] = c;
      out.__cost__ += c * (this.opCost.get(name) ?? 1);
    }
    return out;
  }

  /** Delta between this counter and a snapshot taken earlier. */
  deltaFrom(snapshot) {
    const out = { __cost__: 0 };
    for (const [name, c] of this.counts) {
      const prev = snapshot?.[name] ?? 0;
      out[name] = c - prev;
      out.__cost__ += (c - prev) * (this.opCost.get(name) ?? 1);
    }
    return out;
  }

  clone() {
    const c = new OpsCounter();
    for (const [n, v] of this.counts) c.counts.set(n, v);
    for (const [n, v] of this.opCost) c.opCost.set(n, v);
    return c;
  }
}

/** Counter that declares the standard fake-backend op set. */
export function newBackendCounter(extra = {}) {
  const c = new OpsCounter();
  c.declare('d1.query');       // one D1 statement (prepare+execute)
  c.declare('d1.rows');        // rows materialized (writes/reads) — granularity signal
  c.declare('kv.get');
  c.declare('kv.put');
  c.declare('kv.delete');
  c.declare('kv.list');
  c.declare('route.invoke');   // one handler call through the fake transport
  for (const [name, cost] of Object.entries(extra)) c.declare(name, cost);
  return c;
}
