// S1.1 — fake env factory. What a Pages Function reads from `ctx.env` —
// KV namespaces, D1 databases, secrets — gets a deterministic fake here.
// Secrets are fake-but-typed: the real values must never be needed, since
// the harness never leaves the process.

import { FakeD1 } from './d1.js';
import { FakeKV } from './kv.js';

/**
 * @param {object} spec  { kv: {NAMESPACE: {rows?}}, d1: {DB: {tables}}, secrets: {KEY: 'x'} , vars: {} }
 * @param {OpsCounter} counter
 */
export function buildEnv(spec, counter) {
  const env = {};

  for (const [ns, def] of Object.entries(spec.kv ?? {})) {
    env[ns] = new FakeKV(ns, counter);
    // Convenience seeding for takeover/secret-variant campaigns.
    for (const [k, v] of Object.entries(def?.seed ?? {})) {
      env[ns]._store.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  for (const [db, def] of Object.entries(spec.d1 ?? {})) {
    env[db] = new FakeD1({ tables: def.tables ?? {}, counter });
  }

  for (const [k, v] of Object.entries(spec.var ?? {})) env[k] = v;
  for (const [k, v] of Object.entries(spec.secrets ?? {})) env[k] = v;

  return env;
}
