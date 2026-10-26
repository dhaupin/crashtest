// S1.6 - snapshot-diff oracles (issue #13 crate-tooling blocker 2).
//
// Vant's conversion census measured at least four packs hand-rolling
// store-snapshot diffs for the row-aliasing / idempotency / lost-update
// rows. This is the uniform shape: take two snapshots (FakeD1.snapshot()
// or FakeKV.snapshot()), get back a DETERMINISTIC diff - same inputs
// twice, byte-identical output, so an attack can grade "what the storage
// discipline DID" without inventing its own comparator.
//
// Row identity: matched by the `id` column when BOTH sides carry it
// (crashtest's autoincrement convention); otherwise rows match structurally
// (full-row equality) and whatever remains is added/removed - sorted
// deterministically so the output is stable for ledger pinning. Tables that
// appear/disappear wholesale are recorded whole. KV diffs diff keys the
// same way.
//
// Pure module: no harness, no counter ticks, no I/O - diffing artifacts the
// attack captured itself, before/after a campaign's requests.

/**
 * Structural fingerprint - stable across runs for the same row content.
 * JSON.stringify's silent drops (house rule 6 / the hostileSerialize lesson)
 * do NOT apply here: stringify quietly loses __proto__ own-keys and
 * undefined-valued keys, so a row whose ONLY change was one of those
 * fingerprinted IDENTICAL and the diff oracle missed the change - exactly
 * the class the vars lane's sameShape comparator refuses. Own-key traversal
 * instead (prototype never climbed), keys sorted so rebuild-order variance
 * cannot fake a change, bounded depth failing loud on un-boundable shapes.
 */
function fingerprint(value, depth = 0) {
  if (depth > 64) throw new TypeError('diff fingerprint: value nesting exceeds 64 levels - snapshots hold JSON-shaped rows');
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`; // "boolean:true" != "string:1"
  if (Array.isArray(value)) return `[${value.map((v) => fingerprint(v, depth + 1)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${fingerprint(value[k], depth + 1)}`).join(',')}}`;
}

/** The same rule-6-safe identity, shared: the fake D1's DISTINCT/GROUP BY/
 * unique keying used bare JSON.stringify, which drops undefined keys and
 * __proto__ own-keys - collapsing truly-distinct rows and groups. */
export const stableFingerprint = fingerprint;

/** Field names that differ between two row objects (sorted). Presence is
 * part of the answer: a key appearing/disappearing IS a change even when the
 * value is undefined (undefined fingerprints the same as absent by value -
 * only the key-set knows). */
function changedFields(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((k) => {
    const inBefore = before ? k in before : false;
    const inAfter = after ? k in after : false;
    if (inBefore !== inAfter) return true;
    return fingerprint(before?.[k]) !== fingerprint(after?.[k]);
  }).sort();
}

/**
 * Diff two D1 snapshot shapes: { tableName: [{ ...row }, ...] }.
 * Returns:
 *   { changed: boolean,
 *     tables: { [name]: { status: 'added'|'removed'|'changed'|'same',
 *                         added: rows, removed: rows,
 *                         changed: [{ before, after, fields }] } } }
 * added/removed/changed are sorted deterministically (by id when present,
 * else fingerprint). Every returned row is a copy - mutating a diff never
 * reaches the snapshots.
 */
export function diffD1Snapshots(before, after) {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const tables = {};
  let changed = false;
  for (const name of names) {
    const beforeRows = before?.[name] ?? null;
    const afterRows = after?.[name] ?? null;
    if (beforeRows === null) {
      tables[name] = { status: 'added', added: afterRows.map((r) => structuredClone(r)), removed: [], changed: [] };
      changed = true;
      continue;
    }
    if (afterRows === null) {
      tables[name] = { status: 'removed', added: [], removed: beforeRows.map((r) => structuredClone(r)), changed: [] };
      changed = true;
      continue;
    }
    const keyed = beforeRows.every((r) => r && typeof r === 'object' && 'id' in r)
      && afterRows.every((r) => r && typeof r === 'object' && 'id' in r);
    const added = [];
    const removed = [];
    const changedRows = [];
    if (keyed) {
      const beforeById = new Map(beforeRows.map((r) => [r.id, r]));
      const afterById = new Map(afterRows.map((r) => [r.id, r]));
      for (const [id, row] of afterById) {
        if (!beforeById.has(id)) added.push(structuredClone(row));
        else if (fingerprint(beforeById.get(id)) !== fingerprint(row)) {
          changedRows.push({ before: structuredClone(beforeById.get(id)), after: structuredClone(row), fields: changedFields(beforeById.get(id), row) });
        }
      }
      for (const [id, row] of beforeById) {
        if (!afterById.has(id)) removed.push(structuredClone(row));
      }
    } else {
      // structural matching: equal rows cancel, the residue is added/removed.
      // The residue carries ROW REFERENCES (the fingerprint string form is
      // not JSON-invertible now that it records undefined - building removed
      // rows by re-parsing it would have fabricated rows).
      const residue = [...beforeRows];
      for (const row of afterRows) {
        const fp = fingerprint(row);
        const at = residue.findIndex((r) => fingerprint(r) === fp);
        if (at > -1) residue.splice(at, 1);
        else added.push(structuredClone(row));
      }
      for (const row of residue) removed.push(structuredClone(row));
    }
    const byKey = (a, b) => fingerprint(a.id !== undefined ? { id: a.id } : a).localeCompare(fingerprint(b.id !== undefined ? { id: b.id } : b));
    added.sort(byKey);
    removed.sort(byKey);
    changedRows.sort((a, b) => fingerprint(a.before).localeCompare(fingerprint(b.before)));
    const status = added.length || removed.length || changedRows.length ? 'changed' : 'same';
    if (status === 'changed') changed = true;
    tables[name] = { status, added, removed, changed: changedRows };
  }
  return { changed, tables };
}

/**
 * Diff two KV snapshot shapes: { key: value }. Same contract as the D1
 * diff, keyed by name; values compare structurally (KV strings verbatim,
 * stored JSON re-parsed for comparison through fingerprints).
 */
export function diffKvSnapshots(before, after) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const added = [];
  const removed = [];
  const changed = [];
  for (const key of keys) {
    const had = before && key in before;
    const has = after && key in after;
    if (!had) added.push({ key, value: structuredClone(after[key]) });
    else if (!has) removed.push({ key, value: structuredClone(before[key]) });
    else if (fingerprint(before[key]) !== fingerprint(after[key])) {
      changed.push({ key, before: structuredClone(before[key]), after: structuredClone(after[key]) });
    }
  }
  return { changed: added.length + removed.length + changed.length > 0, keys: { added, removed, changed } };
}

/**
 * Dispatch on shape. Single-shape callers use diffD1Snapshots /
 * diffKvSnapshots directly; the MIXED store map that harness.snapshotStore()
 * returns (a D1 binding here, a KV binding there) diffs per binding and
 * merges: { changed, bindings: { [name]: { kind, ...shapeDiff } } }.
 */
export function diffSnapshots(before, after) {
  // Shape default: an ALL-EMPTY map is an empty D1 store (FakeD1.snapshot()
  // of a fresh db returns {}) - the first-value check fell through to 'kv',
  // and a D1 store emptied mid-campaign diffed through the KV shape where
  // whole tables submit as opaque values (still caught, named wrong).
  const first = Object.values(before ?? {})[0] ?? Object.values(after ?? {})[0];
  if (Array.isArray(first) || (first === undefined && Object.keys(before ?? {}).length === 0)) {
    return { ...diffD1Snapshots(before, after), kind: 'd1' };
  }
  return { ...diffKvSnapshots(before, after), kind: 'kv' };
}

const isD1Shape = (binding) => {
  const vals = Object.values(binding ?? {});
  return vals.length === 0 || vals.every((v) => Array.isArray(v));
};

export function diffStoreSnapshots(before, after) {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  const bindings = {};
  let changed = false;
  for (const name of names) {
    const b = before?.[name];
    const a = after?.[name];
    if (b === undefined || a === undefined) {
      // a binding appearing/disappearing: diff the SINGLE side's own shape
      // (the binding value IS the table map / kv map - no wrapper)
      const only = b === undefined ? a : b;
      const kind = isD1Shape(only) ? 'd1' : 'kv';
      const diff = kind === 'd1' ? diffD1Snapshots({}, only) : diffKvSnapshots({}, only);
      bindings[name] = { kind, ...diff, status: b === undefined ? 'added' : 'removed' };
      changed = true;
      continue;
    }
    // Shape disagreement between two NON-empty sides stays the loud oracle
    // bug throw; shape ambiguity only exists for an EMPTY side ({}) - a KV
    // binding that legitimately emptied itself (every key deleted) is
    // isD1Shape-true and used to grade 'mixed' into that throw on a real
    // deletion. One empty side adopts the other's shape; both-empty is an
    // unobservable no-diff (d1).
    const knowsShape = (v) => Object.keys(v ?? {}).length > 0;
    const bKnows = knowsShape(b);
    const aKnows = knowsShape(a);
    let kind;
    if (bKnows && aKnows) {
      const bd = isD1Shape(b);
      const ad = isD1Shape(a);
      kind = bd !== ad ? 'mixed' : bd ? 'd1' : 'kv';
    } else if (bKnows) {
      kind = isD1Shape(b) ? 'd1' : 'kv';
    } else if (aKnows) {
      kind = isD1Shape(a) ? 'd1' : 'kv';
    } else {
      kind = 'd1';
    }
    if (kind === 'd1') bindings[name] = { kind, ...diffD1Snapshots(b, a) };
    else if (kind === 'kv') bindings[name] = { kind, ...diffKvSnapshots(b, a) };
    else {
      throw new TypeError(`diffSnapshots: binding "${name}" changed shape between snapshots (d1<->kv) - snapshots come from the same store, so this is an oracle bug, not a finding`);
    }
    if (bindings[name].changed) changed = true;
  }
  return { changed, bindings };
}
