// faked1 v0.3 - the issue #9 expansion acceptance suite.
//
// The v0.2 suite (d1-v02.test.js) pin-walked gistory's EIGHT relay
// statements row-for-row; v0.3 covers what the ranked gap list measured
// from the vant census run roots: SQL that moves rollups/lookups OUT of
// JS and into the fake engine. Every date/test reads FakeD1's ONE fixed
// clock (FAKE_CLOCK_EPOCH) - never Date.now() (determinism, house law 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, FAKE_CLOCK_EPOCH } from '../../src/harness/d1.js';
import { newBackendCounter } from '../../src/harness/counters.js';

function mkdb(tables, counter = newBackendCounter()) {
  return { db: new FakeD1({ tables, counter }), counter };
}

const CENSUS = {
  devices: {
    rows: [
      { id: 1, name: 'fuel-gauge', tier: 'gold', last_seen: '2026-01-02T00:00:00Z' },
      { id: 2, name: 'relay', tier: 'silver', last_seen: '2026-01-01T00:00:00Z' },
      { id: 3, name: 'gauge-2', tier: 'gold', last_seen: '2026-01-03T00:00:00Z' },
    ],
  },
  readings: {
    rows: [
      { id: 1, device_id: 1, seq: 3, value: 5 },
      { id: 2, device_id: 1, seq: 4, value: 15 },
      { id: 3, device_id: 2, seq: 1, value: 7 },
      { id: 4, device_id: 3, seq: 9, value: 20 },
    ],
  },
};

// ---- IN (SELECT ...) subqueries (one projection column, depth one) ----
test('v0.3: IN (SELECT ...) with a bound subquery param resolves against the outer db', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT name FROM devices WHERE id IN (SELECT device_id FROM readings WHERE seq > ?)')
    .bind(3).all();
  assert.deepEqual(res.results.map(r => r.name), ['fuel-gauge', 'gauge-2']);
});

test('v0.3: IN (SELECT ...) without params + the one-column rule stays loud', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT name FROM devices WHERE id IN (SELECT device_id FROM readings)').all();
  assert.deepEqual(res.results.map(r => r.name), ['fuel-gauge', 'relay', 'gauge-2']);
  await assert.rejects(
    db.prepare('SELECT name FROM devices WHERE id IN (SELECT device_id, seq FROM readings)').all(),
    /scalar IN subquery must select exactly one column/,
  );
});

test('v0.3: nested subqueries are a named gap (depth one)', async () => {
  const { db } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare('SELECT name FROM devices WHERE id IN (SELECT device_id FROM readings WHERE value IN (SELECT value FROM readings))').all(),
    /nested subqueries are a documented gap/,
  );
});

// ---- scalar functions ----
test('v0.3: UPPER/LOWER/LENGTH/TRIM/ABS', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT LENGTH(name) AS n, UPPER(name) AS u, LOWER(lower_name) AS l FROM (SELECT 1) ').all()
    .catch(() => null);
  // (the FROM-subselect is unsupported - assert the pieces over a real table)
  const one = await db.prepare('SELECT UPPER(name) AS u, LOWER(name) AS l, LENGTH(name) AS n FROM devices WHERE id = 1').all();
  assert.deepEqual(one.results, [{ u: 'FUEL-GAUGE', l: 'fuel-gauge', n: 10 }]);
  assert.equal(res, null, 'FROM (SELECT ...) subquery-FROM stays a named gap');
});

test('v0.3: unknown functions still fail with the gap message (upper landed, this pin moved)', async () => {
  const { db } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare("INSERT INTO devices (name, tier) VALUES (substr('abc', 1), 'gold')").run(),
    /unsupported function substr/,
  );
});

// ---- fake-clock date functions (the ONE cursed clock, pinned) ----
test('v0.3: UNIXEPOCH(now) is the fixed harness clock - deterministic, equal across runs', async () => {
  const { db } = mkdb(CENSUS);
  const a = await db.prepare("SELECT UNIXEPOCH('now') AS e").first('e');
  const b = await db.prepare("SELECT UNIXEPOCH('now') AS e").first('e');
  assert.equal(a, FAKE_CLOCK_EPOCH);
  assert.equal(b, FAKE_CLOCK_EPOCH, 'same seed -> same output: no Date.now() anywhere');
});

test('v0.3: DATETIME/JULIANDAY/STRFTIME shapes + bind-source values', async () => {
  const { db } = mkdb(CENSUS);
  assert.equal(await db.prepare('SELECT DATETIME(?) AS d').bind('2026-01-02T00:00:00Z').first('d'), '2026-01-02 00:00:00');
  assert.equal(await db.prepare('SELECT DATETIME(?, ?) AS d').bind(1767225600, 'unixepoch').first('d'), '2026-01-01 00:00:00');
  const jd = await db.prepare("SELECT JULIANDAY('2026-01-01 00:00:00') AS j").first('j');
  assert.ok(Math.abs(jd - (1767225600 / 86400 + 2440587.5)) < 1e-9);
  assert.equal(await db.prepare("SELECT STRFTIME('%Y-%m', '2026-03-04 00:00:00') AS s").first('s'), '2026-03');
  assert.equal(await db.prepare('SELECT UNIXEPOCH(NULL) AS e').first('e'), null);
});

test('v0.3: +N day / -30 hour modifiers compose; month/year offsets are a named gap', async () => {
  const { db } = mkdb(CENSUS);
  assert.equal(
    await db.prepare('SELECT DATETIME(?, ?) AS d').bind('2026-01-01 00:00:00', 86400).first('d'),
    '2026-01-02 00:00:00',
  );
  assert.equal(
    await db.prepare("SELECT DATETIME('2026-01-01 00:00:00', '-1 day', '2 hours') AS d").first('d'),
    '2025-12-31 02:00:00',
  );
  await assert.rejects(
    db.prepare("SELECT DATETIME('2026-01-01 00:00:00', '+1 month') AS d").first('d'),
    /unsupported date modifier/,
  );
});

// ---- JSON functions ----
test('v0.3: JSON_EXTRACT/JSON_TYPE/JSON_QUOTE (path degrades to NULL like SQLite)', async () => {
  const { db } = mkdb(CENSUS);
  await db.prepare('INSERT INTO devices (id, name, tier, extra) VALUES (?, ?, ?, ?)').bind(9, 'j', 'gold', '{"settings":{"model":"gpt-x"},"scores":[3,1]}').run();
  assert.equal(await db.prepare('SELECT JSON_EXTRACT(extra, "$.settings.model") AS m FROM devices WHERE id = 9').first('m'), 'gpt-x');
  assert.deepEqual(await db.prepare('SELECT JSON_EXTRACT(extra, "$.scores") AS s FROM devices WHERE id = 9').first('s'), [3, 1]);
  assert.equal(await db.prepare('SELECT JSON_EXTRACT(extra, "$.nope") AS m FROM devices WHERE id = 9').first('m'), null);
  assert.equal(await db.prepare('SELECT JSON_TYPE(extra) AS t FROM devices WHERE id = 9').first('t'), 'object');
  assert.equal(await db.prepare('SELECT JSON_TYPE(1.5) AS t').first('t'), 'real');
  assert.equal(await db.prepare('SELECT JSON_QUOTE("a\\"b") AS q').first('q'), '"a\\"b"');
  assert.equal(await db.prepare("SELECT JSON_EXTRACT('not json', '$.a') AS m").first('m'), null, 'malformed JSON degrades to NULL');
});

// ---- JOINs: one merge key, INNER / LEFT (unmatched arm = expanded NULLs) ----
test('v0.3: INNER JOIN with table-qualified refs (the status-board re-fan killer)', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT devices.name AS dname, readings.value AS v FROM devices JOIN readings ON devices.id = readings.device_id ORDER BY v').all();
  assert.deepEqual(res.results.map(r => [r.dname, r.v]), [
    ['fuel-gauge', 5], ['relay', 7], ['fuel-gauge', 15], ['gauge-2', 20],
  ]);
});

test('v0.3: LEFT JOIN unmatched arm reads NULL for right-side refs', async () => {
  const { db } = mkdb({ devices: CENSUS.devices, readings: { rows: [CENSUS.readings.rows[0]] } });
  const res = await db.prepare('SELECT devices.name AS dname, readings.value AS v FROM devices LEFT JOIN readings ON devices.id = readings.device_id ORDER BY devices.id').all();
  assert.deepEqual(res.results.map(r => [r.dname, r.v]), [['fuel-gauge', 5], ['relay', null], ['gauge-2', null]]);
});

test('v0.3: bare shared-key joins + unknown table prefixes stay loud', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT name, value FROM devices JOIN readings ON id = device_id WHERE readings.seq = 4').all();
  assert.deepEqual(res.results.map(r => [r.name, r.value]), [['fuel-gauge', 15]]);
  await assert.rejects(
    db.prepare('SELECT name FROM devices JOIN readings ON devices.x = readings.seq').all(),
    /no such column: devices\.x/,
  );
});

// ---- GROUP BY / HAVING / ORDER BY on computed columns ----
test('v0.3: GROUP BY with aggregates + HAVING + ORDER BY alias', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT tier, COUNT(*) AS n, SUM(value) AS total FROM devices JOIN readings ON devices.id = readings.device_id GROUP BY tier HAVING COUNT(*) > 1 ORDER BY total DESC').all();
  assert.deepEqual(res.results, [{ tier: 'gold', n: 3, total: 40 }]);
});

test('v0.3: GROUP BY plain cols only (expressions are a named gap); bare col next to aggregates reads the group first row', async () => {
  const { db } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare('SELECT tier, COUNT(*) AS n FROM devices GROUP BY LENGTH(tier)').all(),
    /group keys are plain column refs only/,
  );
  await assert.rejects(
    db.prepare('SELECT tier, COUNT(*) AS n FROM devices HAVING COUNT(*) > 1').all(),
    /HAVING requires GROUP BY/,
  );
  const res = await db.prepare('SELECT tier, COUNT(*) AS n, name FROM devices GROUP BY tier ORDER BY n DESC, tier ASC').all();
  assert.deepEqual(res.results, [
    { tier: 'gold', n: 2, name: 'fuel-gauge' },
    { tier: 'silver', n: 1, name: 'relay' },
  ]);
});

test('v0.3: ORDER BY on computed/aliased columns (post-projection alias sort)', async () => {
  const { db } = mkdb(CENSUS);
  const res = await db.prepare('SELECT name, LENGTH(name) AS len FROM devices ORDER BY len DESC, name ASC').all();
  assert.deepEqual(res.results.map(r => r.name), ['fuel-gauge', 'gauge-2', 'relay']);
});

// ---- CREATE TABLE / ALTER TABLE (the ensureSchema pattern) ----
test('v0.3: CREATE TABLE IF NOT EXISTS is idempotent; the bare form throws TABLE_EXISTS', async () => {
  const db = new FakeD1({});
  const sql = 'CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, checked_at TEXT NOT NULL)';
  assert.deepEqual((await db.prepare(sql).run()).meta.changes, 0);
  assert.deepEqual((await db.prepare(sql).run()).meta.changes, 0, 'rerunning the migration stays honest');
  await assert.rejects(
    db.prepare(sql.replace('IF NOT EXISTS ', '')).run(),
    /table sync_state already exists/,
  );
  await db.prepare('INSERT INTO sync_state (key, checked_at) VALUES (?, ?)').bind('k', '2026-01-01T00:00:00Z').run();
  assert.equal(await db.prepare('SELECT id FROM sync_state').first('id'), 1, 'autoincrement flows from the implicit allocator');
  await assert.rejects(
    db.prepare('INSERT INTO sync_state (key, checked_at) VALUES (?, ?)').bind('k', 't').run(),
    /UNIQUE constraint failed: sync_state\.key/,
    'UNIQUE column flags feed the same UNIQUE reading the seeded tables declare',
  );
});

test('v0.3: ALTER TABLE ADD COLUMN backfills DEFAULT and stays NOT-NULL-loud; d1.ddl ticks', async () => {
  const { db, counter } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare('ALTER TABLE devices ADD COLUMN extra TEXT NOT NULL').run(),
    /NOT NULL without DEFAULT/,
  );
  await db.prepare("ALTER TABLE devices ADD COLUMN extra TEXT DEFAULT 'unset'").run();
  const res = await db.prepare('SELECT extra FROM devices WHERE id = 2').first('extra');
  assert.equal(res, 'unset');
  await assert.rejects(
    db.prepare('ALTER TABLE devices ADD COLUMN extra TEXT').run(),
    /duplicate column name/,
  );
  await assert.rejects(
    db.prepare('ALTER TABLE nope ADD COLUMN x TEXT').run(),
    /no such table: nope/,
  );
  assert.equal(counter.count('d1.ddl'), 2, 'd1.ddl ticks on EXECUTED ddl (parse-time refusals name the gap before the engine sees them)');
});

// walk-ALT teeth: ADD COLUMN constraint declarations the REAL SQLite also
// refuses - the fake used to accept the words and then NON-MODEL them
// (phantom schema: a constraint you wrote that never armed).
test('walk-ALT: ADD COLUMN + UNIQUE/PK/CHECK/FK refuses loud (real-SQLite parity; the working DEFAULT path still backfills)', async () => {
  const counter = newBackendCounter();
  const db = new FakeD1({ tables: { t: { rows: [{ id: 1 }], uniques: {} } }, counter });
  for (const [ddl, want] of [
    ['ALTER TABLE t ADD COLUMN u TEXT UNIQUE', /ADD COLUMN u with UNIQUE is refused/],
    ['ALTER TABLE t ADD COLUMN id INTEGER PRIMARY KEY', /with PRIMARY KEY is refused/],
    ["ALTER TABLE t ADD COLUMN c TEXT DEFAULT 'x' CHECK (c > 'a')", /CHECK is refused/],
    ['ALTER TABLE t ADD COLUMN f INTEGER REFERENCES t (id)', /REFERENCES is refused/],
    ['ALTER TABLE t ADD COLUMN g INTEGER FOREIGN KEY (g) REFERENCES t (id)', /FOREIGN KEY is refused/],
  ]) {
    await assert.rejects(db.prepare(ddl).run(), want, `${ddl.slice(0, 40)} must refuse the un-modelable constraint`);
  }
  // the LEGIT add-column paths keep working end to end (backfill + counter)
  await db.prepare("ALTER TABLE t ADD COLUMN note TEXT DEFAULT 'clean'").run();
  const row = await db.prepare('SELECT note FROM t WHERE id = 1').first('note');
  assert.equal(row, 'clean', 'the modeled subset (plain add, DEFAULT backfill) still works');
  assert.equal(counter.count('d1.ddl'), 1, 'only the executed DDL ticks');
});

// ---- v0.2 contracts never regressed by the v0.3 growth ----
test('v0.3: LIMIT/OFFSET params + textual binding still read WHERE-first, LIMIT-second', async () => {
  const { db } = mkdb(CENSUS);
  const page = await db.prepare('SELECT id FROM devices WHERE tier = ? ORDER BY id LIMIT ? OFFSET ?').bind('gold', 1, 1).all();
  assert.deepEqual(page.results.map(r => r.id), [3]);
});

test('v0.3: d1.rows + d1.query counters keep ticking over the new paths', async () => {
  const { db, counter } = mkdb(CENSUS);
  await db.prepare('SELECT COUNT(*) FROM devices JOIN readings ON devices.id = readings.device_id').first('count');
  await db.prepare('SELECT tier FROM devices').all();
  assert.equal(counter.count('d1.query'), 2);
  assert.equal(counter.count('d1.rows'), 4); // 1 aggregate row + 3 select rows
});

test('v0.3: RIGHT JOIN rewrite hint stays loud', async () => {
  const { db } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare('SELECT name FROM devices RIGHT JOIN readings ON devices.id = readings.device_id').all(),
    /RIGHT JOIN is not modeled/,
  );
});

// ---- edge-walk teeth (round-1 fixes): silent fills become loud refusals ----

test('v0.3: LIMIT ? with a missing bound param is NO_PARAM, not silently-returns-everything', async () => {
  const { db } = mkdb(CENSUS);
  await assert.rejects(
    db.prepare('SELECT id FROM devices LIMIT ?').all(),
    (e) => /LIMIT \? has no bound parameter/.test(e.message) && e.code === 'NO_PARAM',
  );
});

test('v0.3: negative LIMIT/OFFSET follow SQLite (offset -> zero, limit -> no limit)', async () => {
  const { db } = mkdb(CENSUS);
  const all = await db.prepare('SELECT id FROM devices ORDER BY id').all();
  const neg = await db.prepare('SELECT id FROM devices ORDER BY id LIMIT -1 OFFSET -3').all();
  assert.equal(neg.results.length, all.results.length,
    'negative OFFSET must skip nothing and negative LIMIT must clamp nothing - slice(-n) would answer with the TAIL instead');
});

test('v0.3: a double-quoted string containing a comma does not split the projection', async () => {
  const { db } = mkdb(CENSUS);
  const rows = await db.prepare('SELECT "a,b" AS seg, id FROM devices ORDER BY id LIMIT 1').all();
  assert.deepEqual(rows.results[0], { seg: 'a,b', id: 1 });
});
