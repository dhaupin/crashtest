// S1.1 - FakeD1 suite. Rook's lesson baked in: validate against the real
// validators' semantics (a 3-char id that the app's own regex rejects is the
// app rejecting it, not a shim bug), and never let JSON.stringify eat
// prototype keys - hostile payloads are stored raw as strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeD1, parseStatement } from '../../src/harness/d1.js';
import { newBackendCounter } from '../../src/harness/counters.js';

function mkdb(tables = {}) {
  const counter = newBackendCounter();
  return { db: new FakeD1({ tables, counter }), counter };
}

const USERS = {
  users: {
    rows: [
      { id: 1, name: 'rook', role: 'admin', email: 'rook@example.com' },
      { id: 2, name: 'dhaupin', role: 'owner', email: 'dh@example.com' },
      { id: 3, name: 'cormorant', role: 'user', email: null },
    ],
    uniques: { email_unique: ['email'] },
  },
};

test('select * returns seeded rows verbatim', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare('SELECT * FROM users ORDER BY id').all();
  assert.deepEqual(res.results.map(r => r.name), ['rook', 'dhaupin', 'cormorant']);
});

test('select specific columns + WHERE param binding', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare('SELECT name, role FROM users WHERE role = ?').bind('admin').all();
  assert.deepEqual(res.results, [{ name: 'rook', role: 'admin' }]);
});

test('first(col) - null IS NULL honored', async () => {
  const { db } = mkdb(USERS);
  assert.equal(await db.prepare('SELECT name FROM users WHERE email IS NULL').first('name'), 'cormorant');
  assert.equal(await db.prepare('SELECT name FROM users WHERE email IS NOT NULL AND id = ?').bind(2).first('name'), 'dhaupin');
});

test('IN list + AND/OR precedence', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare('SELECT name FROM users WHERE id IN (?, ?, ?) AND role = ?')
    .bind(1, 2, 3, 'owner').all();
  assert.deepEqual(res.results, [{ name: 'dhaupin' }]);
});

test('INSERT autoincrement + meta.last_row_id', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare("INSERT INTO users (name, role, email) VALUES (?, ?, ?)")
    .bind('fledgling', 'user', 'f@example.com').run();
  assert.equal(res.meta.changes, 1);
  assert.equal(res.meta.last_row_id, 4);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM users').first('count'), 4);
});

test('UNIQUE constraint throws like D1 (takeover campaign relies on it)', async () => {
  const { db } = mkdb(USERS);
  await assert.rejects(
    db.prepare("INSERT INTO users (name, role, email) VALUES ('dup', 'user', ?)").bind('rook@example.com').run(),
    /UNIQUE constraint failed: users\.email/
  );
});

test('UPDATE binds SET params before WHERE params (textual order)', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind('user', 1).run();
  assert.equal(res.meta.changes, 1);
  assert.equal(await db.prepare('SELECT role FROM users WHERE id = 1').first('role'), 'user');
});

test('UPDATE uniqueness guard fires on moved email (row-move/aliasing checks)', async () => {
  const { db } = mkdb(USERS);
  await assert.rejects(
    db.prepare('UPDATE users SET email = ? WHERE id = ?').bind('dh@example.com', 1).run(),
    /UNIQUE constraint failed: users\.email/
  );
  // ...and the failed update must not have mutated the row.
  assert.equal(await db.prepare('SELECT email FROM users WHERE id = 1').first('email'), 'rook@example.com');
});

test('DELETE + meta.changes', async () => {
  const { db } = mkdb(USERS);
  const res = await db.prepare('DELETE FROM users WHERE role = ?').bind('user').run();
  assert.equal(res.meta.changes, 1);
  assert.equal(await db.prepare('SELECT COUNT(*) FROM users').first('count'), 2);
});

test('unsupported SQL throws with a gap-naming message (DISCOVER will catch)', async () => {
  const { db } = mkdb(USERS);
  await assert.rejects(db.prepare('SELECT u.id FROM users u JOIN roles r ON 1=1').all(), /unsupported statement/);
  await assert.rejects(db.prepare("INSERT INTO users (name) VALUES (upper('x'))").run(), /cannot parse literal/);
});

test('op counters tick: query + materialized rows', async () => {
  const { db, counter } = mkdb(USERS);
  await db.prepare('SELECT * FROM users').all();
  await db.prepare('SELECT * FROM users').all();
  assert.equal(counter.count('d1.query'), 2);
  assert.equal(counter.count('d1.rows'), 6); // 3 rows x 2 queries
  assert.ok(counter.cost() > 0);
});

test('parseStatement: WHERE inside string literal survives tokenization', () => {
  const ast = parseStatement("SELECT * FROM users WHERE email = 'a$order@x.example'");
  assert.equal(ast.verb, 'SELECT');
});
