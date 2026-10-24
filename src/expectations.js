// Expectation tables as data (issue #13 crate-tooling blocker 4).
//
// Conversion wants pack rows to carry declarative expected-records (the
// EXPECTED-table shape the first converted bucket uses) so CI keeps the
// same "table is complete" property the native suites have today: every
// produced row matches exactly one table entry, every table entry is
// matched, and the verdicts agree - anything else fails LOUDLY naming
// the module/attack and both verdicts.
//
// Pure module: no counters, no IO, deterministic sorted output (byte-
// identical findings for the same inputs - the ledger pin rides on it).
//
//   rows:     the produced verdict records ({ module, attack, verdict, ... })
//   expected: the declarative table ({ module, attack, verdict } - extra
//             fields on either side are ignored, copies are returned)
//   Returns:  { pass, matched, mismatched, missing, extra }
//       matched:    one entry per agreement ({ module, attack, verdict })
//       mismatched: [{ module, attack, expected, actual, status }] -
//                   status 'verdict' = same identity, different verdict;
//                   status 'missing' = table entry no produced row covers
//       extra:      produced rows no table entry covers
//
// A pass with zero expected entries is allowed (a pack may legitimately
// produce zero rows - but then it must produce zero rows, and vice versa).

const identity = (r) => `${r.module ?? '#'}/${r.attack}`;
const rowCopy = (r) => ({ ...r });

export function evalExpectations(rows, expected, { scopeName = 'pack' } = {}) {
  if (!Array.isArray(rows) || !Array.isArray(expected)) {
    throw new TypeError(`evalExpectations: rows and expected must be arrays (grading ${scopeName})`);
  }
  const byKey = new Map();
  for (const r of rows) {
    if (r == null || typeof r !== 'object' || !r.attack) {
      throw new TypeError(`evalExpectations: produced row without an attack name (grading ${scopeName}: ${JSON.stringify(r)})`);
    }
    const key = identity(r);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r); // duplicate identities are legal in rows; the table must say so
  }
  const tableKey = new Map();
  for (const e of expected) {
    if (e == null || typeof e !== 'object' || !e.attack) {
      throw new TypeError(`evalExpectations: expectation-table entry without an attack name (grading ${scopeName}: ${JSON.stringify(e)})`);
    }
    const key = identity(e);
    if (tableKey.has(key)) {
      throw new TypeError(`evalExpectations: expectation table lists "${key}" twice - a table is complete only when each row is declared once; declare distinct attack names (grading ${scopeName})`);
    }
    tableKey.set(key, e);
  }

  const matched = [];
  const mismatched = [];
  for (const [key, tableEntry] of tableKey) {
    const produced = byKey.get(key);
    if (!produced) {
      mismatched.push({
        module: tableEntry.module ?? '#',
        attack: tableEntry.attack,
        status: 'missing',
        expected: tableEntry.verdict ?? null,
        actual: null,
      });
      continue;
    }
    for (const rec of produced) {
      if (rec.verdict === tableEntry.verdict) {
        matched.push({ module: rec.module ?? '#', attack: rec.attack, verdict: rec.verdict });
      } else {
        mismatched.push({
          module: rec.module ?? '#',
          attack: rec.attack,
          status: 'verdict',
          expected: tableEntry.verdict ?? null,
          actual: rec.verdict ?? null,
        });
      }
    }
  }
  const extra = [...byKey.keys()].filter((key) => !tableKey.has(key)).map((key) => {
    const rec = byKey.get(key)[0];
    return { module: rec.module ?? '#', attack: rec.attack, actual: rec.verdict ?? null };
  });
  const sorter = (arr, keyFn) => arr.sort((x, y) => String(keyFn(x)).localeCompare(String(keyFn(y))));
  sorter(mismatched, (m) => `${m.module}/${m.attack}/${m.status}`);
  sorter(matched, (m) => identity(m));
  sorter(extra, (m) => identity(m));
  return {
    pass: mismatched.length === 0 && extra.length === 0,
    matched: matched.map(rowCopy),
    mismatched: mismatched.map(rowCopy),
    extra: extra.map(rowCopy),
  };
}

/** The loud one-line summary a scenario or CLI can print/throw on. */
export function renderExpectationResult(result, { scopeName = 'pack' } = {}) {
  const lines = [`expectation table ${result.pass ? 'PASS' : 'FAIL'} (${scopeName}): ${result.matched.length} matched`];
  for (const m of result.mismatched) {
    lines.push(`  - ${m.module}/${m.attack}: expected ${m.expected}, got ${m.actual} (${m.status})`);
  }
  for (const e of result.extra) {
    lines.push(`  - ${e.module}/${e.attack}: produced but not in the table (got ${e.actual})`);
  }
  return lines.join('\n');
}
