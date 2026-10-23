// faked1 v0.2 - the relay-statement acceptance suite (issue #8).
//
// Grounded in the EIGHT statements gistory's relay actually runs. Each test
// names its statement; the point is that a run root carrying handlers that
// speak real SQL can swap its node:sqlite fixture for bare FakeD1 and get
// row-for-row the same results the real engine gives. The v0.1 contracts
// (UNIQUE message shape, {meta:{changes,last_row_id}}, counters, batch
// partial-apply) are re-pinned here so the growth cannot eat them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1 } from '../../src/harness/d1.js';
import { newBackendCounter } from '../../src/harness/counters.js';

// Declarative fixture shaped from gistory's schema.sql (four tables; the
// relay's own uniques: chains.id, devices(chain_id, id), rate_limits.key -
// see issue #8 for the pointers into functions/_shared).
function relayDb(counter = newBackendCounter()) {
  const db = new FakeD1({
    counter,
    tables: {
      chains: { rows: [{ id: 1, created_at: '2026-01-01T00:00:00Z', version: 1 }], uniques: { chains_id_unique: ['id'] } },
      devices: {
        rows: [{ id: 1, chain_id: 1, name: 'fuel-gauge', last_seen: '2026-01-02T00:00:00Z', last_ip: '10.0.0.9' }],
        uniques: { devices_unique: ['chain_id', 'id'] },
      },
      blobs: {
        rows: [{ id: 1, chain_id: 1, seq: 3, device_id: 1, data: 'seed-blob', created_at: '2026-01-01T01:00:00Z' }],
        uniques: { blobs_unique: ['chain_id', 'seq'] },
      },
      rate_limits: {
        rows: [{ id: 1, key: 'ip:10.0.0.9', count: 2, window_start: '2026-01-01T00:00:00Z' }],
        uniques: { rate_limits_key_unique: ['key'] },
      },
    },
  });
  return db;
}

// ---- statement 1: `INSERT OR IGNORE INTO chains (id, created_at, version) VALUES (?, ?, 1)` ----
test('v0.2 s1: INSERT OR IGNORE swallows the UNIQUE drop with meta.changes 0 (chains.id)', async () => {
  const db = relayDb();
  const res = await db.prepare('INSERT OR IGNORE INTO chains (id, created_at, version) VALUES (?, ?, 1)')
    .bind(1, '2026-10-01T00:00:00Z').run();
  assert.equal(res.meta.changes, 0, 'ignored conflict inserts nothing');
  assert.equal(res.meta.last_row_id, null);
  const count = await db.prepare('SELECT COUNT(*) FROM chains').first('count');
  assert.equal(count, 1, 'rows unchanged');
  // ...and a FRESH id still passes through (IGNORE only swallows conflicts)
  const fresh = await db.prepare('INSERT OR IGNORE INTO chains (id, created_at, version) VALUES (?, ?, 1)')
    .bind(2, '2026-10-01T00:00:01Z').run();
  assert.equal(fresh.meta.changes, 1);
  assert.equal(fresh.meta.last_row_id, 2);
});

// ---- statement 2: `SELECT COALESCE(MAX(seq), 0) AS seq FROM blobs WHERE chain_id = ?` ----
test('v0.2 s2: COALESCE(MAX(col), 0) aliased projection', async () => {
  const db = relayDb();
  const seq = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM blobs WHERE chain_id = ?')
    .bind(1).first('seq');
  assert.equal(seq, 3, 'MAX over stored rows');
  const empty = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM blobs WHERE chain_id = ?')
    .bind(999).first('seq');
  assert.equal(empty, 0, 'empty set -> COALESCE falls to 0 (MAX returns NULL)');
});

// ---- statement 3: plain columns + ORDER BY DESC LIMIT (v0.1 control, kept parsing) ----
test('v0.2 s3: devices pull ORDER BY last_seen DESC LIMIT 50', async () => {
  const db = relayDb();
  await db.prepare('INSERT INTO devices (chain_id, id, name, last_seen, last_ip) VALUES (?, ?, ?, ?, ?)')
    .bind(1, 2, 'newer', '2026-02-01T00:00:00Z', '10.0.0.2').run();
  await db.prepare('INSERT INTO devices (chain_id, id, name, last_seen, last_ip) VALUES (?, ?, ?, ?, ?)')
    .bind(1, 3, 'oldest', '2025-12-01T00:00:00Z', '10.0.0.3').run();
  const res = await db.prepare(
    'SELECT id, name, last_seen, last_ip FROM devices WHERE chain_id = ? ORDER BY last_seen DESC LIMIT 50',
  ).bind(1).all();
  assert.deepEqual(res.results.map(r => r.name), ['newer', 'fuel-gauge', 'oldest']);
  assert.deepEqual(res.results.map(r => r.id), [2, 1, 3]);
});

// ---- statement 4: `UPDATE ... WHERE id = ? AND push_hash IS NULL` (v0.1 control) ----
test('v0.2 s4: UPDATE with IS NULL + AND predicate', async () => {
  const db = relayDb();
  const res = await db.prepare(
    "UPDATE devices SET name = ? WHERE id = ? AND last_seen IS NOT NULL AND name != 'ghost'",
  ).bind('renamed', 1).run();
  assert.equal(res.meta.changes, 1);
  assert.equal(await db.prepare('SELECT name FROM devices WHERE id = 1').first('name'), 'renamed');
});

// ---- statement 5: upsert with excluded.* + CASE over stored col ----
test('v0.2 s5: ON CONFLICT(chain_id,id) DO UPDATE with excluded.* + CASE reads stored value in ELSE', async () => {
  const db = relayDb();
  const sql = `INSERT INTO devices (chain_id, id, name, last_seen, last_ip) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chain_id, id) DO UPDATE SET name = ?, last_ip = CASE WHEN excluded.last_ip != '' THEN excluded.last_ip ELSE last_ip END`;
  // last_ip '' -> ELSE branch keeps the STORED last_ip
  const res = await db.prepare(sql).bind(1, 1, 'renamed-via-upsert', '2026-03-01T00:00:00Z', '',
    'renamed-via-upsert').run();
  assert.equal(res.meta.changes, 1);
  const row = await db.prepare('SELECT * FROM devices WHERE chain_id = 1 AND id = 1').all().then(r => r.results[0]);
  assert.equal(row.name, 'renamed-via-upsert', 'SET name = ? took the bound param');
  assert.equal(row.last_ip, '10.0.0.9', 'seen_at doc: ELSE branch reads the STORED last_ip at eval time');
  // fresh candidate last_ip -> excluded branch wins
  await db.prepare(sql).bind(1, 1, 'renamed-again', '2026-03-02T00:00:00Z', '10.0.0.77',
    'renamed-again').run();
  const row2 = await db.prepare('SELECT * FROM devices WHERE chain_id = 1 AND id = 1').all().then(r => r.results[0]);
  assert.equal(row2.last_ip, '10.0.0.77', 'excluded.last_ip branch wins on a real candidate value');
  // bare column in DO UPDATE reads the ORIGINAL value pre-assignment
  const db2 = relayDb();
  await db2.prepare('INSERT INTO devices (chain_id, id, name, last_seen, last_ip) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chain_id, id) DO UPDATE SET last_seen = ?, name = last_seen')
    .bind(1, 1, 'chain', '2026-03-03T00:00:00Z', '10.0.0.9', '2026-03-04T00:00:00Z').run();
  const row3 = await db2.prepare('SELECT * FROM devices WHERE chain_id = 1 AND id = 1').all().then(r => r.results[0]);
  assert.equal(row3.name, '2026-01-02T00:00:00Z', 'name = last_seen reads the row\'s PRE-assignment value');
  assert.equal(row3.last_seen, '2026-03-04T00:00:00Z', 'last_seen took the new value');
});

// ---- statement 6: UPDATE with CASE in SET (bound params on condition + bare col in ELSE) ----
test('v0.2 s6: UPDATE SET CASE WHEN ? != \'\' THEN ? ELSE last_col END (original values)', async () => {
  const db = relayDb();
  const res = await db.prepare(
    "UPDATE devices SET last_ip = CASE WHEN ? != '' THEN ? ELSE last_ip END, name = ? WHERE chain_id = 1 AND id = 1",
  ).bind('', 'ignored', 'crafted', 1).run();
  assert.equal(res.meta.changes, 1);
  const row = await db.prepare('SELECT * FROM devices WHERE chain_id = 1 AND id = 1').all().then(r => r.results[0]);
  assert.equal(row.last_ip, '10.0.0.9', 'empty param -> ELSE keeps the stored col value');
  assert.equal(row.name, 'crafted');
  // textual param order: SET params before WHERE params (pinned in v0.1, kept)
  const db2 = relayDb();
  await db2.prepare('UPDATE devices SET last_ip = CASE WHEN ? != \'\' THEN ? ELSE last_ip END WHERE id = ? AND name = ?')
    .bind('x', '10.9.9.9', 1, 'fuel-gauge').run();
  const row2 = await db2.prepare('SELECT * FROM devices WHERE id = 1').all().then(r => r.results[0]);
  assert.equal(row2.last_ip, '10.9.9.9');
});

// ---- statement 7: throttle upsert - arithmetic on the existing col in CASE pivot ----
test('v0.2 s7: rate_limits upsert with count + 1 arithmetic and window reset CASE', async () => {
  const db = relayDb();
  const sql = `INSERT INTO rate_limits (id, key, count, window_start) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN window_start = ? THEN count + 1 ELSE 1 END,
      window_start = CASE WHEN window_start != ? THEN ? ELSE window_start END`;
  // same window -> count grows
  await db.prepare(sql).bind(1, 'ip:10.0.0.9', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'x').run();
  let row = await db.prepare('SELECT * FROM rate_limits WHERE key = ?').bind('ip:10.0.0.9').all().then(r => r.results[0]);
  assert.equal(row.count, 3, 'same window: count + 1 (arith on the existing col)');
  assert.equal(row.window_start, '2026-01-01T00:00:00Z', 'window unchanged');
  // new window -> reset to 1 (the CASE pivot param is the caller's CURRENT
  // window: the stored window_start differs from it, so the ELSE arm wins)
  await db.prepare(sql).bind(1, 'ip:10.0.0.9', 1, '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z').run();
  row = await db.prepare('SELECT * FROM rate_limits WHERE key = ?').bind('ip:10.0.0.9').all().then(r => r.results[0]);
  assert.equal(row.count, 1, 'new window: reset to 1');
  assert.equal(row.window_start, '2026-06-01T00:00:00Z', 'window moved');
});

// ---- statement 8: the atomic seq allocator ----
// Real-SQLite ground truth (verified against node:sqlite): a FROM-less
// SELECT with bare column refs errors `no such column` - so the relay's
// real clause scopes MAX over its own table: `FROM blobs WHERE chain_id = ?`.
test('v0.2 s8: INSERT INTO blobs (...) SELECT ?, COALESCE(MAX(seq), 0) + 1, ... FROM blobs WHERE chain_id = ? RETURNING seq', async () => {
  const db = relayDb();
  const sql = 'INSERT INTO blobs (chain_id, seq, device_id, data, created_at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM blobs WHERE chain_id = ? RETURNING seq';
  const res = await db.prepare(sql).bind(1, 1, 'next-blob', '2026-04-01T00:00:00Z', 1).run();
  // an INSERT..RETURNING run surfaces { results: [...], meta }
  assert.deepEqual(res.results, [{ seq: 4 }], 'RETURNING seq = stored MAX + 1');
  assert.equal(res.meta.changes, 1);
  assert.equal(res.meta.last_row_id, 2, 'autoincrement id of the inserted blob row');
  // a run on an EMPTY chain still allocates 1 (MAX over nothing -> COALESCE 0)
  const empty = await db.prepare(sql)
    .bind(77, 55, 'orphan-blob', '2026-04-01T00:00:00Z', 77).run();
  assert.deepEqual(empty.results, [{ seq: 1 }], 'empty chain starts at 1');

  // .all()/.first() on a RETURNING write work like they do on a SELECT
  const viaAll = await db.prepare(sql).bind(1, 2, 'third-blob', '2026-04-02T00:00:00Z', 1).all();
  assert.deepEqual(viaAll.results.map(r => r.seq), [5]);
  const viaFirst = await db.prepare(
    'INSERT INTO blobs (chain_id, seq, device_id, data, created_at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM blobs WHERE chain_id = ? RETURNING seq, device_id')
    .bind(1, 3, 'fourth-blob-1', '2026-04-03T00:00:00Z', 1).first('device_id');
  assert.equal(viaFirst, 3, 'RETURNING exposes multiple columns');

  // ...and a write WITHOUT returning still refuses .all() (v0.1 contract)
  await assert.rejects(
    db.prepare('INSERT INTO chains (id, created_at, version) VALUES (9, \'t\', 1)').all(),
    /\.all\(\) on a write statement/,
  );
  // FROM-less SELECT with a bare column ref errors exactly like real SQLite
  await assert.rejects(
    db.prepare('INSERT INTO blobs (chain_id, seq) SELECT ?, COALESCE(MAX(seq), 0) + 1').bind(2).run(),
    /no such column: seq/,
  );
});

// ---- plain upserts: DO NOTHING swallows matching conflicts only ----
test('v0.2 upsert: ON CONFLICT(cols) DO NOTHING swallows only matching-unique conflicts', async () => {
  const db = relayDb();
  const res = await db.prepare(
    'INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
  ).bind(1, 'x', 1).run();
  assert.equal(res.meta.changes, 0);
  const fresh = await db.prepare(
    'INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
  ).bind(5, 'x', 1).run();
  assert.equal(fresh.meta.changes, 1);
  // a conflict on a NON-declared conflict target still throws (D1 honesty):
  // this candidate DOES violate the devices(chain_id,id) unique, but the
  // clause declares `name` - which is not a unique column here - so the
  // guard must not swallow the collision silently.
  await assert.rejects(
    db.prepare('INSERT INTO devices (chain_id, id, name, last_seen, last_ip) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING')
      .bind(1, 1, 'fuel-gauge', '2026-01-02T00:00:00Z', '10.0.0.9').run(),
    /UNIQUE constraint failed: devices\.(chain_id|id)/,
    'DO NOTHING protects only its declared target cols',
  );
});

// ---- OR REPLACE deletes conflicting rows on EVERY unique index, then inserts ----
test('v0.2 upsert: OR REPLACE removes conflicts then inserts (every unique group)', async () => {
  const db = relayDb();
  const res = await db.prepare('INSERT OR REPLACE INTO chains (id, created_at, version) VALUES (?, ?, ?)')
    .bind(1, '2026-10-02T00:00:00Z', 9).run();
  assert.equal(res.meta.changes, 1);
  const row = await db.prepare('SELECT * FROM chains WHERE id = 1').all().then(r => r.results[0]);
  assert.equal(row.version, 9);
  assert.equal(row.created_at, '2026-10-02T00:00:00Z');
});

// ---- plain unique constraint message shape unchanged (v0.1 contract) ----
test('v0.2 contract: plain INSERT conflict still throws the exact UNIQUE message', async () => {
  const db = relayDb();
  await assert.rejects(
    db.prepare('INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?)').bind(1, 't', 1).run(),
    /UNIQUE constraint failed: chains\.id/,
  );
});

// ---- upsert .first()/.all() on a RETURNING write; write without RETURNING refuses ----
test('v0.2 contract: UPDATE..RETURNING surfaces rows; plain write .all() still refuses', async () => {
  const db = relayDb();
  const res = await db.prepare('UPDATE devices SET name = ? WHERE id = ? RETURNING name')
    .bind('relabeled', 1).run();
  assert.deepEqual(res.results, [{ name: 'relabel' === 'relabeled' ? 'relabeled' : 'relabeled' }]);
  assert.equal(res.meta.changes, 1);
  await assert.rejects(
    db.prepare('UPDATE devices SET name = ? WHERE id = ?').bind('x', 1).all(),
    /\.all\(\) on a write statement/,
  );
  // the seed blob is chains-linked id 1 - DELETE it back out with RETURNING
  const del = await db.prepare('DELETE FROM blobs WHERE chain_id = 1 RETURNING id').run();
  assert.deepEqual(del.results, [{ id: 1 }], 'DELETE..RETURNING surfaces the removed row');
});

// ---- LIMIT ? / OFFSET ? bound by parameter (textual order after WHERE) ----
test('v0.2 contract: LIMIT ? / OFFSET ? bound by parameter', async () => {
  const db = relayDb();
  await db.prepare('INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?)').bind(2, 't1', 1).run();
  await db.prepare('INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?)').bind(3, 't2', 1).run();
  const page = await db.prepare('SELECT id FROM chains ORDER BY id LIMIT ? OFFSET ?')
    .bind(2, 1).all();
  assert.deepEqual(page.results.map(r => r.id), [2, 3]);
  const page2 = await db.prepare('SELECT id FROM chains WHERE id > ? ORDER BY id LIMIT ?')
    .bind(1, 1).all();
  assert.deepEqual(page2.results.map(r => r.id), [2], 'WHERE param first, LIMIT param second (textual)');
});

// ---- COUNT(*) alias/keys + plain aggregates keep v0.1 keys ----
test('v0.2 contract: unaliased COUNT(*) keeps the key `count`; MIN/SUM/AVG land', async () => {
  const db = relayDb();
  assert.equal(await db.prepare('SELECT COUNT(*) FROM blobs').first('count'), 1);
  const seqs = await db.prepare('SELECT MAX(seq) AS hi, MIN(seq) AS lo, SUM(seq) AS total, AVG(seq) AS mean FROM blobs WHERE chain_id = 1').all();
  const row = seqs.results[0];
  assert.equal(row.hi, 3);
  assert.equal(row.lo, 3);
  assert.equal(row.total, 3);
  assert.equal(row.mean, 3);
});

// ---- unsupported SQL STILL throws with a listed gap (DISCOVER, not mid-campaign) ----
test('v0.2 contract: unsupported SQL stays loud naming the gap', async () => {
  const db = relayDb();
  await assert.rejects(db.prepare('SELECT * FROM chains c JOIN devices d ON 1=1').all(), /unsupported statement/);
  await assert.rejects(db.prepare('INSERT INTO chains (name) VALUES (upper(id)) WHERE id > 1').run(), /cannot parse literal|unsupported/);
  await assert.rejects(db.prepare('SELECT MAX(seq) OVER (ORDER BY id) FROM blobs').all(), /unsupported statement|cannot parse/);
  await assert.rejects(
    db.prepare('UPDATE blobs SET seq = MAX(seq) WHERE id = 1').run(),
    /aggregate function MAX is only supported in SELECT projections/,
    'aggregates outside SELECT stay a named gap',
  );
});

// ---- batch() partial apply honesty on new statement shapes (v0.1 contract) ----
test('v0.2 contract: batch rejects at the failing statement, earlier STAY applied, later do NOT run', async () => {
  const db = relayDb();
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO chains (id, created_at, version) VALUES (?, ?, 1)').bind(7, 't', 1),
    db.prepare('INSERT INTO chains (id, created_at, version) VALUES (?, ?, ?)').bind(1, 'collides', 1), // UNIQUE drop - batch REJECTS here
    db.prepare('INSERT INTO blobs (chain_id, seq, device_id, data, created_at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? RETURNING seq').bind(7, 1, 'b', '2026'),
  ];
  await assert.rejects(db.batch(stmts), /UNIQUE constraint failed: chains\.id/);
  // earlier statement STAYED applied (D1 partial-apply honesty)...  
  const chainsNow = await db.prepare('SELECT id FROM chains ORDER BY id').all();
  assert.deepEqual(chainsNow.results.map(r => r.id), [1, 7]);
  // ...and the statement AFTER the failure never ran (no blob for chain 7)
  const blobOk = await db.prepare('SELECT COUNT(*) AS n FROM blobs WHERE chain_id = 7').first('n');
  assert.equal(blobOk, 0);
  // the RETURNING statement itself, in a clean batch, still works
  const okBatch = await db.batch([
    db.prepare('INSERT INTO blobs (chain_id, seq, device_id, data, created_at) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ? FROM blobs WHERE chain_id = ? RETURNING seq').bind(7, 1, 'later-b', '2026', 7),
  ]);
  assert.equal(okBatch[0].results?.[0]?.seq, 1);
});
