// S1.1 - in-memory D1 shim ("the proven path" from the gistory hardening
// passes). Mirrors the D1 API surface apps actually use:
//
//   db.prepare(sql).bind(...params).run() / .first(col) / .all()
//
// Supported SQL subset (v0.1, deliberately small - covers what tapping route
// handlers needs for auth/input/state campaigns; document every gap):
//   SELECT [DISTINCT] *|cols|COUNT(*) FROM t [WHERE ...] [ORDER BY col [ASC|DESC],...] [LIMIT n [OFFSET m]]
//     WHERE: col = | != | <> | < | > | <= | >=  ?|literal   /  AND / OR (left-assoc, AND binds first)
//            col IS NULL / IS NOT NULL           /  col IN (?, ?, ...)
//     literals: 'singlequoted' (single quotes doubled to escape), bare numbers, true/false, NULL
//   INSERT INTO t (col, ...) VALUES (?, ...), (?, ...)
//   UPDATE t SET col = ?, col = ? WHERE ...
//   DELETE FROM t WHERE ...
//   BEGIN | COMMIT | ROLLBACK      (tx via db.batch semantics below)
//
// NOT supported (throw with a clear message so gaps surface in DISCOVER, not
// in a muffled campaign): JOINs, subqueries, aggregates other than COUNT(*),
// GROUP BY/HAVING, functions (unixepoch(), datetime(), json_extract, ...),
// TRIGGERs, foreign keys, ON CONFLICT clauses, CREATE/ALTER TABLE.
//
// Behaviors that campaigns COUNT on:
//   - declared UNIQUE constraints throw `UNIQUE constraint failed: t.col` on
//     INSERT/UPDATE (row-move/aliasing + takeover checks depend on this)
//   - numeric `id` integer autoincrement; seed rows keep explicit ids
//   - .run() resolves { meta: { changes, last_row_id } }
//   - params are bound by position `?`; JSON-ish objects/arrays stored as
//     serialized strings (D1 does the same via TEXT columns)
//   - every statement ticks the counter's d1.query (+ d1.rows on materialize)

import { randomUUID } from 'node:crypto';

class D1Error extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'D1Error';
    this.code = options.code ?? 'SQL_ERROR';
    this.query = options.query;
  }
}

// ---------- tokenizer / parser helpers ----------

function wordAt(sql, i, kw) {
  // Case-insensitive whole-word match at position i ('OR' must not fire
  // inside 'ORDER' or 'priority'; boundaries are SQL word chars A-z0-9_).
  const slice = sql.slice(i, i + kw.length);
  if (slice.toUpperCase() !== kw.toUpperCase()) return false;
  const before = i === 0 ? ' ' : sql[i - 1];
  const after = sql[i + kw.length] ?? ' ';
  return /[\W]/.test(before) && /[\W]/.test(after);
}

function splitTopLevel(sql, sep = ',') {
  // sep is a single char (',') or a keyword ('AND' / 'OR', word-boundary,
  // case-insensitive). Quoted strings and parenthesized groups are skipped.
  const parts = [];
  let depth = 0, quoted = null, start = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quoted) {
      if (ch === quoted) quoted = null;
      continue;
    }
    if (ch === `'` || ch === `"`) { quoted = ch; continue; }
    if (ch === `(`) { depth++; continue; }
    if (ch === `)`) { depth--; continue; }
    if (depth !== 0) continue;
    if (sep === ',') {
      if (ch === sep) { parts.push(sql.slice(start, i).trim()); start = i + 1; continue; }
    } else if (wordAt(sql, i, sep)) {
      parts.push(sql.slice(start, i).trim());
      i += sep.length - 1;
      start = i + 1;
      continue;
    }
  }
  const tail = sql.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseLiteral(token, params, consumed = { v: 0 }) {
  token = token.trim();
  if (token === '?') {
    return params[consumed.v++];
  }
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if (token === 'NULL') return null;
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/''/g, "'");
  }
  throw new D1Error(`crashtest-fake-d1: cannot parse literal "${token}" (unsupported expression)`,
    { code: 'PARSE' });
}

/** WHERE grammar: AND binds tighter than OR (left-assoc). */
function parseConjunct(chunk, params, consumed) {
  // One OR-list of ANDs: a = ? OR b = ?
  const ors = splitTopLevel(chunk, 'OR').map(orChunk =>
    splitTopLevel(orChunk, 'AND').map(pred => parsePredicate(pred, params, consumed))
  );
  const evalRow = (row) => ors.some(andList => andList.every(pass => pass(row)));
  return evalRow;
}

const OPS = ['<=', '>=', '<>', '!=', '=', '<', '>'];

function parsePredicate(pred, params, consumed) {
  pred = pred.trim();

  const isNull = pred.match(/^(.+?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNull) {
    const col = isNull[1].trim();
    const wantNull = !isNull[2]; // IS NULL -> want null
    return row => (row[col] === null || row[col] === undefined) === wantNull;
  }

  const inList = pred.match(/^(.+?)\s+IN\s*\((.+)\)$/i);
  if (inList) {
    const col = inList[1].trim();
    const list = splitTopLevel(inList[2]).map(t => parseLiteral(t, params, consumed));
    return row => list.some(v => v === row[col]);
  }

  for (const op of OPS) {
    const idx = pred.indexOf(op);
    if (idx > -1) {
      const col = pred.slice(0, idx).trim();
      const rest = pred.slice(idx + op.length).trim();
      const val = parseLiteral(rest, params, consumed);
      switch (op) {
        case '=': return row => row[col] === val;
        case '!=':
        case '<>': return row => row[col] !== val;
        case '<': return row => row[col] < val;
        case '>': return row => row[col] > val;
        case '<=': return row => row[col] <= val;
        case '>=': return row => row[col] >= val;
      }
    }
  }
  throw new D1Error(`crashtest-fake-d1: unsupported predicate "${pred}" (subset: cmp/IS NULL/IN)`,
    { code: 'UNSUPPORTED' });
}

// ---------- statement runtimes ----------

function execSelect(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  const matches = ast.where
    ? (ast.where === 'ALL' ? () => true : parseConjunct(ast.where, params, consumed))
    : () => true;

  let rows = table.rows.filter(matches);

  if (ast.distinct) {
    const seen = new Set();
    rows = rows.filter(r => {
      const key = JSON.stringify(ast.columns === '*' ? r : Object.fromEntries(ast.columns.map(c => [c, r[c]])));
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }

  if (ast.orderBy?.length) {
    for (const { col, dir } of ast.orderBy.reverse()) {
      rows = [...rows].sort((a, b) => {
        const cmp = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
        return dir === 'DESC' ? -cmp : cmp;
      });
    }
  }

  if (ast.offset != null) rows = rows.slice(ast.offset);
  if (ast.limit != null) rows = rows.slice(0, ast.limit);

  db._counter?.increment('d1.rows', rows.length);

  if (ast.count) return rows.map(() => ({ count: rows.length }));
  if (ast.columns === '*') return rows;
  return rows.map(r => Object.fromEntries(ast.columns.map(c => {
    if (!(c in r)) throw new D1Error(`crashtest-fake-d1: no such column: ${c}`, { code: 'NO_COLUMN' });
    return [c, r[c]];
  })));
}

function checkUniques(db, table, candidateRow, excludeId = null) {
  for (const [group, uniqCols] of table.uniques) {
    const vals = uniqCols.map(c => candidateRow[c] ?? null);
    if (vals.every(v => v === undefined)) continue; // partial unique not modeled
    const key = JSON.stringify(vals);
    for (const row of table.rows) {
      if (excludeId != null && row.id === excludeId) continue;
      if (JSON.stringify(uniqCols.map(c => row[c] ?? null)) === key) {
        throw new D1Error(`UNIQUE constraint failed: ${table.name}.${uniqCols.join('.')}`,
          { code: 'UNIQUE' });
      }
    }
  }
}

function execInsert(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  const inserted = [];
  for (const valuesTuple of ast.rows) {
    const row = { id: (table.nextId ?? 1) };
    for (let i = 0; i < ast.columns.length; i++) {
      if (ast.columns[i] === 'id' && table.nextId != null) {
        row.id = parseLiteral(valuesTuple[i], params, consumed); // explicit id honored
      } else {
        row[ast.columns[i]] = parseLiteral(valuesTuple[i], params, consumed);
      }
    }
    if (row.id >= (table.nextId ?? 1)) table.nextId = row.id + 1;
    for (const k of Object.keys(row)) {
      if (typeof row[k] === 'object' && row[k] !== null) row[k] = JSON.stringify(row[k]);
    }
    checkUniques(db, table, row);
    table.rows.push(row);
    inserted.push(row);
  }
  db._counter?.increment('d1.rows', inserted.length);
  return { meta: { changes: inserted.length, last_row_id: inserted.at(-1)?.id ?? null } };
}

function execUpdate(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  // Bind SET params FIRST - D1 binds positionally in textual order, so
  // `UPDATE t SET a=? WHERE b=?` must read params[0] for a, params[1] for b.
  const setValues = ast.set.map(s => {
    let v = s.value.trim() === '?' ? params[consumed.v++] : parseLiteral(s.value, params, consumed);
    if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
    return v;
  });
  const matches = ast.where === 'ALL' ? () => true : parseConjunct(ast.where, params, consumed);
  const targets = table.rows.filter(matches);
  if (!targets.length) return { meta: { changes: 0, last_row_id: null } };

  let changes = 0;
  for (const row of targets) {
    const next = { ...row };
    ast.set.forEach((s, i) => { next[s.col] = setValues[i]; });
    checkUniques(db, table, next, row.id);
    Object.assign(row, next);
    changes++;
  }
  db._counter?.increment('d1.rows', changes);
  return { meta: { changes, last_row_id: null } };
}

function execDelete(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  const matches = ast.where === 'ALL' ? () => true : parseConjunct(ast.where, params, consumed);
  const before = table.rows.length;
  table.rows = table.rows.filter(r => !matches(r));
  const changes = before - table.rows.length;
  db._counter?.increment('d1.rows', changes);
  return { meta: { changes, last_row_id: null } };
}

// ---------- statement parser ----------

export function parseStatement(sql) {
  const s = sql.trim().replace(/;\s*$/, '');

  let m = s.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)\s+FROM\s+([.\w]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?)?$/i);
  if (m) {
    const [, distinctRaw, selector, table, where, orderBy, limit, offset] = m;
    let columns = '*';
    let count = false;
    if (/^COUNT\s*\(\s*\*\s*\)$/i.test(selector.trim())) {
      columns = '*'; count = true;
    } else if (selector.trim() !== '*') {
      columns = splitTopLevel(selector).map(c => c.trim());
    }
    const orderByList = orderBy
      ? splitTopLevel(orderBy).map(chunk => {
          const parts = chunk.trim().split(/\s+/);
          return { col: parts[0], dir: (parts[1] || 'ASC').toUpperCase() };
        })
      : null;
    return {
      verb: 'SELECT', distinct: !!distinctRaw, columns, count, table,
      where: where ? where.trim() : 'ALL',
      orderBy: orderByList,
      limit: limit != null ? Number(limit) : null,
      offset: offset != null ? Number(offset) : null,
    };
  }

  m = s.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s+([\s\S]+)$/i);
  if (m) {
    const [, table, cols, tuples] = m;
    const columns = splitTopLevel(cols);
    const rows = splitTopLevel(tuples).map(tuple =>
      splitTopLevel(tuple.replace(/^\(|\)$/g, '')));
    return { verb: 'INSERT', table, columns, rows };
  }

  m = s.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (m) {
    const [, table, setClause, where] = m;
    const set = splitTopLevel(setClause).map(pair => {
      const i = pair.indexOf('=');
      return { col: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() };
    });
    return { verb: 'UPDATE', table, set, where: where ? where.trim() : 'ALL' };
  }

  m = s.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (m) {
    const [, table, where] = m;
    return { verb: 'DELETE', table, where: where ? where.trim() : 'ALL' };
  }

  throw new D1Error(
    `crashtest-fake-d1: unsupported statement: ${s.slice(0, 60)}... (v0.1 subset: SELECT/INSERT/UPDATE/DELETE; no JOIN/agg/fn)`,
    { code: 'UNSUPPORTED' });
}

// ---------- the fake D1 ----------

export class FakeD1 {
  /**
   * @param {object} opts
   * @param {object} [opts.tables]  { name: { rows:[...], uniques?: [[name,[col,...]]] } }
   *   Rows are plain objects; keep `id` as a number for autoincrement.
   * @param {import('./counters.js').OpsCounter} [opts.counter]
   */
  constructor({ tables = {}, counter = null } = {}) {
    this._t = new Map();
    for (const [name, def] of Object.entries(tables)) {
      const rows = (def.rows ?? []).map(r => ({ ...r }));
      const nextId = rows.reduce((max, r) => Math.max(max, typeof r.id === 'number' ? r.id : 0), 0) + 1;
      this._t.set(name, {
        name,
        rows,
        nextId,
        uniques: new Map(Object.entries(def.uniques ?? {}).map(([k, cols]) => [k, cols])),
      });
    }
    this._counter = counter;
    this._drained = false;
  }

  _table(name) {
    const t = this._t.get(name);
    if (!t) throw new D1Error(`crashtest-fake-d1: no such table: ${name} (declare it in tables)`,
      { code: 'NO_TABLE' });
    return t;
  }

  /** Deep clone of current table state - used for deterministic snapshots. */
  snapshot() {
    const out = {};
    for (const [name, t] of this._t) {
      out[name] = t.rows.map(r => ({ ...r }));
    }
    return out;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  /** D1 batch: sequential execution; on failure, earlier statements stay applied (D1 behavior). */
  async batch(stmts) {
    const out = [];
    for (const st of stmts) {
      out.push(await st.run());
    }
    return out;
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this._params = [];
  }

  bind(...params) {
    this._params = params;
    return this; // D1 allows re-bind chaining; last bind wins
  }

  async _exec() {
    const ast = parseStatement(this.sql);
    this.db._counter?.increment('d1.query');
    switch (ast.verb) {
      case 'SELECT': return execSelect(this.db, ast, this._params);
      case 'INSERT': return execInsert(this.db, ast, this._params);
      case 'UPDATE': return execUpdate(this.db, ast, this._params);
      case 'DELETE': return execDelete(this.db, ast, this._params);
      default: throw new D1Error(`unhandled verb ${ast.verb}`, { code: 'INTERNAL' });
    }
  }

  async run() {
    const res = await this._exec();
    if (Array.isArray(res)) return { results: res, meta: { changes: 0, last_row_id: null }, success: true };
    return { ...res, success: true };
  }

  async all() {
    const results = await this._exec();
    if (!Array.isArray(results)) {
      throw new D1Error(`crashtest-fake-d1: .all() on a write statement: ${this.sql.slice(0, 40)}`,
        { code: 'WRITE_ALL' });
    }
    return { results, meta: { changes: 0, last_row_id: null }, success: true };
  }

  async first(col) {
    const results = await this._exec();
    if (!Array.isArray(results)) {
      throw new D1Error(`crashtest-fake-d1: .first() on a write statement: ${this.sql.slice(0, 40)}`,
        { code: 'WRITE_FIRST' });
    }
    const row = results[0] ?? null;
    if (row == null || col == null) return row;
    if (!(col in row)) throw new D1Error(`crashtest-fake-d1: no such column: ${col}`, { code: 'NO_COLUMN' });
    return row[col];
  }
}
