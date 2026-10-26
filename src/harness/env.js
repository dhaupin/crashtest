// S1.1 - fake env factory. What a Pages Function reads from `ctx.env` -
// KV namespaces, D1 databases, secrets - gets a deterministic fake here.
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
    env[ns] = new FakeKV(ns, counter, def?.opts ?? {});
    // Convenience seeding for takeover/secret-variant campaigns.
    for (const [k, v] of Object.entries(def?.seed ?? {})) {
      env[ns]._store.set(k, {
        value: typeof v === 'string' ? v : JSON.stringify(v),
        metadata: null,
        expiresAt: null,
      });
    }
  }

  for (const [db, def] of Object.entries(spec.d1 ?? {})) {
    env[db] = new FakeD1({ tables: def.tables ?? {}, counter });
  }

  // var/secrets share one env object in the real runtime - a silent
  // overwrite between the two spec maps hides a config mistake (the run
  // root would never know which map it was reading). One name, one owner.
  const varNames = new Set(Object.keys(spec.var ?? {}));
  for (const k of Object.keys(spec.secrets ?? {})) {
    if (varNames.has(k)) {
      throw new TypeError(`buildEnv: "${k}" is declared BOTH as env var and as secret - one name, one owner; drop one of the two declarations`);
    }
  }
  for (const [k, v] of Object.entries(spec.var ?? {})) env[k] = v;
  for (const [k, v] of Object.entries(spec.secrets ?? {})) env[k] = v;

  return env;
}
