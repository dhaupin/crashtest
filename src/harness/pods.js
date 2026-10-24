// Two-pod fixture broker (issue #13 crate-tooling blocker 1).
//
// The census measured the stateful ~20% bucket (sync/backup/federation
// conversations) needing run-root tooling that stages TWO OR MORE pods
// over declared env bindings, sharing one route table and the target's
// real handlers: an attack drives either pod's routes, stages data into
// each pod's own stores, and grades what the STORES did - deterministically,
// reusing the blocker 2 snapshot-diff oracle for cross-pod comparisons.
//
// Shares the crate no-socket law: pods are still in-process WHATWG Request
// handling via the plain Harness. A cross-talk seam is a SHARED fake binding
// instance (the same FakeKV/FakeD1 object attached to both pods' env), never
// a network hop.
//
//   const pods = buildPods({
//     routes: { sync: handler },          // ONE route table, every pod
//     pods: {                             //declarative per-pod env specs
//       home: { env: { d1: { DB: { tables: {...} } } } },
//       remote: { env: { d1: { DB: { tables: {...} } } } },
//     },
//     shared: ['SESSIONS'],               // cross-talk seam (declared)
//   });
//   pods.run('home', 'sync', reqInit);    // drive one pod's handler
//   pods.diff('home', 'remote');          // cross-pod store oracle
//
// Purely additive: a plain Harness (and the single-pod packs) are untouched.

import { Harness } from './harness.js';
import { diffStoreSnapshots } from './diff.js';

export function buildPods({ routes, pods, shared = [], cost, baseUrl } = {}) {
  const names = Object.keys(pods ?? {});
  if (names.length < 2) {
    throw new TypeError('buildPods: stage at least two pods (a pair is the smallest conversation; declared env bindings stage the fixtures)');
  }
  const built = new Map();
  for (const name of names) {
    const spec = pods[name];
    if (spec == null || typeof spec !== 'object') {
      throw new TypeError(`buildPods: pod "${name}" needs a declarative spec ({ env: ... })`);
    }
    const harness = new Harness({ env: spec.env ?? {}, cost, baseUrl });
    for (const [routeName, handler] of Object.entries(routes ?? {})) {
      harness.registerRoute(routeName, handler);
    }
    built.set(name, harness);
  }
  // shared seams: ONE fake binding instance, attached to every pod whose
  // spec declares it - cross-talk by construction, no sockets.
  for (const bindingName of shared) {
    const first = built.get(names[0])?.env[bindingName];
    if (first == null) {
      throw new TypeError(`buildPods: shared binding "${bindingName}" is not declared on pod "${names[0]}" - declare it in every pod's env or drop it from shared`);
    }
    for (const name of names) {
      const harness = built.get(name);
      if (harness.env[bindingName] == null) {
        throw new TypeError(`buildPods: shared binding "${bindingName}" is not declared on pod "${name}" - declare it in every pod's env or drop it from shared`);
      }
      harness.env[bindingName] = first;
    }
  }
  return {
    namesSnapshot: [...names],
    pod(name) {
      const h = built.get(name);
      if (!h) throw new TypeError(`buildPods: no pod named "${name}" (staged: ${names.join(', ')})`);
      return h;
    },
    /**
     * Drive one pod's handler: pods.run('home', 'sync', reqInit) bridges
     * to that pod's Harness.run (reqInit carries the request, exactly like
     * the single-pod harness) - the record shape is unchanged.
     */
    run(name, route, reqInit = {}) {
      return this.pod(name).run(route, reqInit);
    },
    /**
     * Cross-pod store oracle: snapshots BOTH pods (no counter ticks) and
     * diffs them binding-by-binding with the blocker 2 comparator.
     */
    diff(aName, bName) {
      const a = this.pod(aName).snapshotStore();
      const b = this.pod(bName).snapshotStore();
      const out = diffStoreSnapshots(a, b);
      return { podA: aName, podB: bName, ...out };
    },
    /**
     * A pod's own store snapshot (attack bookkeeping for before/after frames).
     */
    snapshot(name) {
      return this.pod(name).snapshotStore();
    },
  };
}
