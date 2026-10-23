// S1.1 - in-memory D1 shim ("the proven path" from the gistory hardening
// passes). Mirrors the D1 API surface apps actually use:
//
//   db.prepare(sql).bind(...params).run() / .first(col) / .all()
//
// Supported SQL subset (v0.2 - grew from v0.1 once real-relay run roots hit
// the wall; grounded in issue #8's eight gistory relay statements):
//   SELECT [DISTINCT] *|<expr-list> FROM t [WHERE ...] [ORDER BY col [ASC|DESC],...] [LIMIT ?|n [OFFSET ?|m]]
//     expressions: `?` params (textual order), numbers, 'strings' ('' escapes),
//       true/false, NULL, arithmetic (+ - * / %), comparisons (= != <> < > <= >=),
//       AND / OR, IS [NOT] NULL, IN (?, ?, ...), CASE WHEN..THEN..[ELSE..]END,
//       COALESCE(...), bare column refs, `excluded.<col>` (upserts only)
//     aggregates (SELECT projections only, whole result set - no GROUP BY):
//       MAX(col) MIN(col) COUNT(*) COUNT(col) SUM(col) AVG(col); `AS alias`
//     (unaliased COUNT(*) keeps the v0.1 output key `count` - pinned contract)
//     an INSERT..SELECT may omit FROM: bare aggregates scope over the INSERT
//       target's own rows (the seq-allocator pattern; SQLite does the same)
//   INSERT [OR IGNORE|REPLACE] INTO t (col, ...) VALUES (?, ...), (...)
//     [ON CONFLICT(cols) DO NOTHING | DO UPDATE SET col = <expr>, ...]
//   INSERT INTO t (col, ...) SELECT <expr-list> ...   (the seq-allocator shape)
//   UPDATE t SET col = <expr>, col = <expr> WHERE ... (per-row exprs: CASE vs
//     stored cols; all SET expressions read the row's ORIGINAL values)
//   DELETE FROM t WHERE ...
//   RETURNING col[, ...] on INSERT/UPDATE/DELETE (write .run()/.first()/.all()
//     surface { results: [...], meta } when the statement has RETURNING)
//   LIMIT ? / OFFSET ? bound by parameter
//
// Upsert resolution (matches D1/SQLite): inside `ON CONFLICT(...) DO UPDATE
// SET ...`, each expression reads the STORED row for bare column refs (at
// eval time, pre-assignment - all expressions see the row's original values)
// and the CANDIDATE row for `excluded.<col>`. Params bind in textual order
// across the whole statement (source first, then the DO UPDATE SET exprs).
//
// NOT supported (throw with a listed gap message so gaps surface in DISCOVER,
// not mid-campaign): JOINs, subqueries (incl. WHERE x IN (SELECT ...)),
// GROUP BY/HAVING, window functions, bare columns mixed with aggregates in
// one projection, functions beyond COALESCE (unixepoch(), datetime(),
// julianday(), json_extract()), NOT, lists-of-columns-less INSERT, quoted
// identifiers, TRIGGERs, foreign keys, CREATE/ALTER TABLE, OR IGNORE|REPLACE
// combined with an ON CONFLICT clause.
//
// Behaviors that campaigns COUNT on (v0.1 contracts, unchanged):
//   - declared UNIQUE constraints throw `UNIQUE constraint failed: t.col` on
//     plain INSERT/UPDATE (row-move/aliasing + takeover checks depend on it)
//   - integer `id` autoincrement; seed rows keep explicit ids
//   - plain .run() resolves { meta: { changes, last_row_id } } (+ success)
//   - params bound by position `?`; objects/arrays stored as JSON strings
//   - batch() keeps D1's partial-apply honesty (earlier statements stay
//     applied when a later one fails)
//   - every statement ticks the counter's d1.query (+ d1.rows on materialize)

class D1Error extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'D1Error';
    this.code = options.code ?? 'SQL_ERROR';
    this.query = options.query;
  }
}

const truthy = (v) => Boolean(v);
const isNullVal = (v) => v === null || v === undefined;
const numVal = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0);

// ---------- tokenizer ----------

const WORD_RE = /[A-Za-z_][A-Za-z0-9_.]*/y;
const NUM_RE = /-?\d+(?:\.\d+)?/y;
const OPS2 = ['<=', '>=', '<>', '!='];

/** Turn an expression/statement fragment into flat tokens. */
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === `'`) {
      let j = i + 1, out = '';
      for (;;) {
        if (j >= src.length) throw new D1Error(`crashtest-fake-d1: unmatched quote in "${src}"`, { code: 'PARSE' });
        if (src[j] === `'`) {
          if (src[j + 1] === `'`) { out += `'`; j += 2; continue; }
          break;
        }
        out += src[j++];
      }
      toks.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      toks.push({ t: 'num', v: Number(m[0]) });
      i = NUM_RE.lastIndex;
      continue;
    }
    if (ch === '?') { toks.push({ t: 'param' }); i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      WORD_RE.lastIndex = i;
      const m = WORD_RE.exec(src);
      toks.push({ t: 'word', v: m[0] });
      i = WORD_RE.lastIndex;
      continue;
    }
    if (ch === `(`) { toks.push({ t: 'punc', v: '(' }); i++; continue; }
    if (ch === `)`) { toks.push({ t: 'punc', v: ')' }); i++; continue; }
    if (ch === `,`) { toks.push({ t: 'punc', v: ',' }); i++; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('=<>+-*/%'.includes(ch)) { toks.push({ t: 'op', v: ch }); i++; continue; }
    throw new D1Error(`crashtest-fake-d1: cannot parse token at "${src.slice(i, i + 12)}" (unsupported character)`, { code: 'PARSE' });
  }
  return toks;
}

// ---------- expression compiler ----------
//
// compileExpr(src, ctx) -> fn(evalCtx) => value. evalCtx is
//   { get(name), getExcluded?(name) }   per-row evaluation, or
//   { set: [...rows], aggCache: Map }   whole-set (aggregate) evaluation.

const AGG_RE = /\b(MAX|MIN|COUNT|SUM|AVG)\s*\(/i;
const AGGS = new Set(['MAX', 'MIN', 'COUNT', 'SUM', 'AVG']);
const CMP_FNS = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<>': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
};

function compileExpr(src, ctx) {
  const { params, consumed, allowAgg, hasExcluded } = ctx;
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  const wordIs = (tok, kw) => tok?.t === 'word' && tok.v.toUpperCase() === kw;
  const eatPunc = (v) => (peek()?.t === 'punc' && peek().v === v ? (next(), true) : false);
  const expectPunc = (v) => {
    if (!eatPunc(v)) throw new D1Error(`crashtest-fake-d1: cannot parse expression "${src}" (expected "${v}")`, { code: 'PARSE' });
  };
  const expectWord = (kw) => {
    if (!wordIs(peek(), kw)) {
      throw new D1Error(`crashtest-fake-d1: cannot parse expression "${src}" (expected ${kw})`, { code: 'PARSE' });
    }
    next();
  };

  function parseOr() {
    let fn = parseAnd();
    while (wordIs(peek(), 'OR')) {
      next();
      const l = fn, r = parseAnd();
      fn = (c) => truthy(l(c)) || truthy(r(c));
    }
    return fn;
  }
  function parseAnd() {
    let fn = parseCmp();
    while (wordIs(peek(), 'AND')) {
      next();
      const l = fn, r = parseCmp();
      fn = (c) => truthy(l(c)) && truthy(r(c));
    }
    return fn;
  }
  function parseCmp() {
    let l = parseAdd();
    for (;;) {
      const t = peek();
      if (wordIs(t, 'IS')) {
        next();
        const wantNull = !wordIs(peek(), 'NOT');
        if (!wantNull) next();
        expectWord('NULL');
        const l0 = l;
        l = (c) => isNullVal(l0(c)) === wantNull;
      } else if (wordIs(t, 'IN')) {
        next();
        expectPunc('(');
        const items = [];
        if (!(peek()?.t === 'punc' && peek().v === ')')) {
          items.push(parseAdd());
          while (eatPunc(',')) items.push(parseAdd());
        }
        expectPunc(')');
        const l0 = l;
        l = (c) => { const v = l0(c); return items.some(f => f(c) === v); };
      } else if (t?.t === 'op' && t.v in CMP_FNS) {
        next();
        const r = parseAdd();
        const cmpf = CMP_FNS[t.v], l0 = l;
        l = (c) => cmpf(l0(c), r(c));
      } else break;
    }
    return l;
  }
  function parseAdd() {
    let fn = parseMul();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const l = fn, r = parseMul();
      fn = op === '+' ? (c) => numVal(l(c)) + numVal(r(c)) : (c) => numVal(l(c)) - numVal(r(c));
    }
    return fn;
  }
  function parseMul() {
    let fn = parsePrimary();
    while (peek()?.t === 'op' && ['*', '/', '%'].includes(peek().v)) {
      const op = next().v;
      const l = fn, r = parsePrimary();
      fn = op === '*'
        ? (c) => numVal(l(c)) * numVal(r(c))
        : op === '/'
          ? (c) => (r(c) === 0 ? null : numVal(l(c)) / numVal(r(c)))
          : (c) => (r(c) === 0 ? null : numVal(l(c)) % numVal(r(c)));
    }
    return fn;
  }

  const aggFns = {
    MAX(rows, argFn) { const v = rows.map(r => argFn(ctxForRow(r))).filter(x => !isNullVal(x)); return v.length ? Math.max(...v) : null; },
    MIN(rows, argFn) { const v = rows.map(r => argFn(ctxForRow(r))).filter(x => !isNullVal(x)); return v.length ? Math.min(...v) : null; },
    SUM(rows, argFn) { const v = rows.map(r => argFn(ctxForRow(r))).filter(x => !isNullVal(x)); return v.length ? v.reduce((s, x) => s + numVal(x), 0) : null; },
    AVG(rows, argFn) { const v = rows.map(r => argFn(ctxForRow(r))).filter(x => !isNullVal(x)); return v.length ? v.reduce((s, x) => s + numVal(x), 0) / v.length : null; },
  };

  function parsePrimary() {
    const t = next();
    if (!t) throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (unexpected end)`, { code: 'PARSE' });

    if (t.t === 'param') {
      const idx = consumed.v++;
      if (!Array.isArray(params) || params[idx] === undefined) {
        throw new D1Error(`crashtest-fake-d1: missing bound parameter #${idx + 1} for "${src.slice(0, 40)}" (bind all ?s positionally)`, { code: 'NO_PARAM' });
      }
      const v = params[idx];
      return () => v;
    }
    if (t.t === 'str' || t.t === 'num') { const v = t.v; return () => v; }

    if (t.t === 'word') {
      const W = t.v.toUpperCase();
      if (W === 'NULL') return () => null;
      if (W === 'TRUE') return () => true;
      if (W === 'FALSE') return () => false;
      if (W === 'NOT') {
        throw new D1Error(`crashtest-fake-d1: unsupported predicate in "${src}" (subset: cmp/IS NULL/IN/AND/OR - no NOT)`, { code: 'UNSUPPORTED' });
      }
      if (W === 'CASE') {
        const clauses = [];
        while (wordIs(peek(), 'WHEN')) {
          next();
          const when = parseOr();
          expectWord('THEN');
          const then = parseOr();
          clauses.push([when, then]);
        }
        if (!clauses.length) {
          throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (CASE wants WHEN..THEN..[ELSE..]END)`, { code: 'PARSE' });
        }
        let elseFn = null;
        if (wordIs(peek(), 'ELSE')) { next(); elseFn = parseOr(); }
        expectWord('END');
        return (c) => {
          for (const [when, then] of clauses) {
            if (truthy(when(c))) return then(c);
          }
          return elseFn ? elseFn(c) : null;
        };
      }
      if (t.v.startsWith('excluded.')) {
        if (!hasExcluded) {
          throw new D1Error(`crashtest-fake-d1: unsupported reference "excluded." in "${src}" (only valid inside ON CONFLICT DO UPDATE)`, { code: 'UNSUPPORTED' });
        }
        const col = t.v.slice('excluded.'.length);
        return (c) => c.getExcluded(col);
      }

      // function call
      if (peek()?.t === 'punc' && peek().v === '(') {
        next();
        let isStar = false;
        const args = [];
        if (peek()?.t === 'op' && peek().v === '*') {
          next();
          isStar = true;
        } else if (!(peek()?.t === 'punc' && peek().v === ')')) {
          args.push(parseOr());
          while (eatPunc(',')) args.push(parseOr());
        }
        expectPunc(')');
        const fname = W;

        if (AGGS.has(fname)) {
          if (!allowAgg) {
            throw new D1Error(`crashtest-fake-d1: aggregate function ${fname} is only supported in SELECT projections (no GROUP BY subset)`, { code: 'UNSUPPORTED' });
          }
          if (isStar) {
            if (fname !== 'COUNT') {
              throw new D1Error(`crashtest-fake-d1: aggregate ${fname}(*) (only COUNT(*) is an aggregate)`, { code: 'PARSE' });
            }
            return (c) => {
              if (!c.set) throw new D1Error(`crashtest-fake-d1: aggregate COUNT(*) evaluated outside a result set (internal sink)`, { code: 'INTERNAL' });
              return c.set.length;
            };
          }
          if (args.length !== 1) {
            throw new D1Error(`crashtest-fake-d1: aggregate ${fname} takes one argument (got ${args.length})`, { code: 'PARSE' });
          }
          const arg = args[0];
          return (c) => {
            if (!c.set) throw new D1Error(`crashtest-fake-d1: aggregate ${fname} evaluated outside a result set (internal sink)`, { code: 'INTERNAL' });
            return aggFns[fname](c.set, arg);
          };
        }

        if (isStar) {
          throw new D1Error(`crashtest-fake-d1: cannot parse literal "${fname}(*)" (only COUNT(*) is a star call)`, { code: 'PARSE' });
        }
        if (fname === 'COALESCE') {
          if (!args.length) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (COALESCE needs arguments)`, { code: 'PARSE' });
          }
          return (c) => {
            for (const a of args) {
              const v = a(c);
              if (!isNullVal(v)) return v;
            }
            return null;
          };
        }

        // unknown function: keep the v0.1 gap message the pins rely on
        throw new D1Error(`crashtest-fake-d1: cannot parse literal "${t.v}(...)" (unsupported function ${t.v}; supported: COALESCE + aggregates in SELECT projections)`, { code: 'PARSE' });
      }

      // bare column ref
      const name = t.v;
      return (c) => (c.get ? c.get(name) : undefined);
    }

    if (t.t === 'punc' && t.v === '(') {
      const inner = parseOr();
      expectPunc(')');
      return inner;
    }

    throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (unsupported token ${JSON.stringify(t.v)})`, { code: 'PARSE' });
  }

  const fn = parseOr();
  if (pos < toks.length) {
    throw new D1Error(`crashtest-fake-d1: cannot parse expression "${src}" (trailing tokens from "${toks[pos].v ?? toks[pos].t}")`, { code: 'PARSE' });
  }
  return fn;
}

/** Per-row evaluation context: bare cols read the stored row; excluded. when the caller carries a candidate. */
function ctxForRow(row, excludedRow = null) {
  const ctx = { get: (name) => row[name] };
  if (excludedRow) ctx.getExcluded = (name) => excludedRow[name];
  return ctx;
}

// ---------- statement runtimes ----------

function splitProjection(src) {
  const out = [];
  let depth = 0, quoted = null, start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) { if (ch === quoted) quoted = null; continue; }
    if (ch === `'`) { quoted = ch; continue; }
    if (ch === `(`) { depth++; continue; }
    if (ch === `)`) { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === ',') { out.push(src.slice(start, i).trim()); start = i + 1; continue; }
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function splitAlias(item) {
  const m = item.match(/^([\s\S]+?)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (m) return { src: m[1].trim(), alias: m[2] };
  return { src: item, alias: null };
}

const COUNT_STAR_KEY = /^COUNT\s*\(\s*\*\s*\)$/i;

/**
 * Compile a SELECT projection list: items in order (INSERT..SELECT maps
 * positionally), each { key, fn }. Output key: alias ?? raw source text;
 * an unaliased COUNT(*) keeps the v0.1 contract key `count`.
 */
function compileProjection(src, params, consumed) {
  const rawItems = splitProjection(src).map(splitAlias);
  const isAggregate = rawItems.some(i => AGG_RE.test(i.src));
  const items = rawItems.map(i => {
    const fn = compileExpr(i.src, { params, consumed, allowAgg: isAggregate, hasExcluded: false });
    let key = i.alias ?? i.src;
    if (i.alias == null && COUNT_STAR_KEY.test(i.src.trim())) key = 'count';
    return { fn, key };
  });
  return { items, isAggregate };
}

function evalProjection(proj, rowOrSet) {
  // Positional values (INSERT..SELECT maps by item ORDER, not key - duplicate
  // unaliased keys like bare `?` params must not collapse). Non-enumerable:
  // invisible to JSON.stringify and Object.keys, so SELECT output shape is
  // byte-identical to a keyed row.
  const stamp = (out, vals) => {
    Object.defineProperty(out, '__vals', { value: vals, enumerable: false, configurable: true });
    return out;
  };
  if (proj.isAggregate) {
    const c = { set: rowOrSet };
    const out = {};
    for (const it of proj.items) out[it.key] = it.fn(c);
    return [stamp(out, proj.items.map((it) => it.fn(c)))]; // one row per aggregate query (D1 semantics)
  }
  const c = ctxForRow(rowOrSet);
  const out = {};
  for (const it of proj.items) out[it.key] = it.fn(c);
  return stamp(out, proj.items.map((it) => it.fn(c)));
}

const serialize = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : v);

function mkRow(table, columns, vals, candidateIdFallback = true) {
  const row = { id: table.nextId ?? 1 };
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] === 'id' && table.nextId != null) row.id = vals[i];
    else row[columns[i]] = vals[i];
  }
  if (candidateIdFallback && Number.isInteger(row.id) && row.id >= (table.nextId ?? 1)) {
    table.nextId = row.id + 1;
  }
  return row;
}

/** The FIRST violated (group, cols, row) for a candidate, or null. */
function findUniqueViolation(table, candidate) {
  for (const uniqCols of table.uniques.values()) {
    const vals = uniqCols.map(c => candidate[c] ?? null);
    if (vals.every(v => v === undefined)) continue;
    const key = JSON.stringify(vals);
    for (const row of table.rows) {
      if (JSON.stringify(uniqCols.map(c => row[c] ?? null)) === key) {
        return { cols: uniqCols, row };
      }
    }
  }
  return null;
}

const uniqueMsg = (table, cols) => `UNIQUE constraint failed: ${table.name}.${cols.join('.')}`;

const sameCols = (a, b) => {
  const norm = (arr) => arr.map(c => String(c).toLowerCase());
  const A = norm(a), B = norm(b);
  return A.length === B.length && A.every((v, i) => v === B[i]);
};

function checkUniques(db, table, candidateRow, excludeId = null) {
  for (const uniqCols of table.uniques.values()) {
    const vals = uniqCols.map(c => candidateRow[c] ?? null);
    if (vals.every(v => v === undefined)) continue; // partial unique not modeled
    const key = JSON.stringify(vals);
    for (const row of table.rows) {
      if (excludeId != null && row.id === excludeId) continue;
      if (JSON.stringify(uniqCols.map(c => row[c] ?? null)) === key) {
        throw new D1Error(uniqueMsg(table, uniqCols), { code: 'UNIQUE' });
      }
    }
  }
}

function execSelectRows(db, ast, params, fallbackTable = null) {
  const table = db._table(ast.table ?? fallbackTable);
  const consumed = { v: 0 };
  // Compile in TEXTUAL param order: the SELECT projection's ?s bind first,
  // then the WHERE's, then LIMIT/OFFSET (D1 binds positionally by text).
  let proj = null;
  if (ast.projection !== '*') {
    proj = compileProjection(ast.projection, params, consumed);
  }
  const whereFn = ast.where && ast.where !== 'ALL'
    ? compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false })
    : () => true;

  let matched = table.rows.filter(row => truthy(whereFn(ctxForRow(row))));

  // ORDER BY on the raw matched rows (v0.1 parity: pre-projection), stable
  // enough for the relay class; ORDER BY <expr> stays a documented gap.
  if (ast.orderBy?.length) {
    for (const { col, dir } of ast.orderBy.reverse()) {
      matched = [...matched].sort((a, b) => {
        const cmp = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
        return dir === 'DESC' ? -cmp : cmp;
      });
    }
  }

  let outRows;
  if (!proj) {
    outRows = matched.map(r => ({ ...r }));
  } else {
    outRows = proj.isAggregate
      ? evalProjection(proj, matched)
      : matched.map(row => evalProjection(proj, row));
    if (ast.distinct) {
      const seen = new Set();
      outRows = outRows.filter(r => {
        const key = JSON.stringify(r);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    }
  }

  // LIMIT / OFFSET - bound by parameter allowed ('?' consumed in TEXTUAL
  // order: LIMIT's param is read before OFFSET's, matching the SQL text)
  if (ast.limitRaw === '?') ast.limit = params[consumed.v++];
  if (ast.offsetRaw === '?') ast.offset = params[consumed.v++];
  if (ast.offset != null) outRows = outRows.slice(ast.offset);
  if (ast.limit != null) outRows = outRows.slice(0, ast.limit);

  db._counter?.increment('d1.rows', outRows.length);
  return outRows;
}

function execSelect(db, ast, params) {
  return execSelectRows(db, ast, params, null);
}

/** The INSERT..SELECT source path: SELECT over a real table (WHERE/order/limit apply). */
function candidatesFromSelect(db, ast, params) {
  const table = db._table(ast.table);
  const sourceRows = execSelectRows(db, ast.source.select, params);
  if (ast.columns.length !== ast.source.projSize) {
    throw new D1Error(`crashtest-fake-d1: INSERT..SELECT column mismatch (${ast.columns.length} columns, ${ast.source.projSize} projections)`, { code: 'PARSE' });
  }
  const candidates = [];
  for (const r of sourceRows) {
    // Positional mapping: the compiled projector stamps each returned row
    // with its per-item values (__vals) - duplicate unaliased projection
    // keys (bare `?` params) must NOT collapse into one column.
    const vals = r.__vals ?? Object.values(r);
    if (vals.length !== ast.source.projSize) {
      throw new D1Error(`crashtest-fake-d1: INSERT..SELECT projection lost positional values (got ${vals.length}, want ${ast.source.projSize})`, { code: 'INTERNAL' });
    }
    candidates.push(mkRow(table, ast.columns, vals.map(serialize), false));
  }
  return candidates;
}

function execInsert(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };

  // 1) Source rows (VALUES tuples or INSERT..SELECT), params bound textually.
  const candidates = [];
  if (ast.source.kind === 'values') {
    const compiled = ast.source.tuples.map(tuple =>
      tuple.map(src => compileExpr(src, { params, consumed, allowAgg: false, hasExcluded: false })));
    for (const cells of compiled) {
      const vals = cells.map(fn => fn({ get: () => undefined }));
      candidates.push(mkRow(table, ast.columns, vals.map(serialize)));
    }
  } else {
    const sel = ast.source.select;
    if (sel.fromLess) {
      // FROM-less INSERT..SELECT (pure constants): exactly one source row,
      // params bound textually before the target columns consume any.
      if (ast.columns.length !== ast.source.projSize) {
        throw new D1Error(`crashtest-fake-d1: INSERT..SELECT column mismatch (${ast.columns.length} columns, ${ast.source.projSize} projections)`, { code: 'PARSE' });
      }
      const compiled = splitProjection(sel.projection).map(src =>
        compileExpr(src, { params, consumed, allowAgg: false, hasExcluded: false }));
      const vals = compiled.map(fn => serialize(fn({ get: () => undefined })));
      candidates.push(mkRow(table, ast.columns, vals, false));
    } else {
      candidates.push(...candidatesFromSelect(db, ast, params));
    }
  }

  // 2) DO UPDATE assignments compile ONCE (textual params after the source).
  const setFns = ast.conflict?.action === 'UPDATE'
    ? ast.conflict.sets.map(s => ({
        col: s.col,
        fn: compileExpr(s.src, { params, consumed, allowAgg: false, hasExcluded: true }),
      }))
    : null;

  const inserted = [];
  const updated = [];
  let changes = 0;

  for (const candidate of candidates) {
    let viol = findUniqueViolation(table, candidate);
    if (viol) {
      if (ast.orMode === 'IGNORE') {
        continue; // swallowed: meta.changes stays honest
      }
      if (ast.orMode === 'REPLACE') {
        // SQLite REPLACE removes conflicting rows on EVERY unique index, then
        // inserts - keep deleting until this candidate has no conflict left.
        while (viol) {
          table.rows = table.rows.filter(r => r !== viol.row);
          viol = findUniqueViolation(table, candidate);
        }
      } else if (ast.conflict?.action === 'NOTHING' && sameCols(ast.conflict.cols, viol.cols)) {
        continue; // swallowed: meta.changes stays honest
      } else if (ast.conflict?.action === 'UPDATE' && sameCols(ast.conflict.cols, viol.cols)) {
        // row-vs-excluded resolution: bare col -> the stored row AT EVAL TIME
        // (pre-assignment), excluded.<col> -> the candidate value.
        const c = ctxForRow(viol.row, candidate);
        const next = { ...viol.row };
        for (const { col, fn } of setFns) next[col] = serialize(fn(c));
        checkUniques(db, table, next, viol.row.id);
        Object.assign(viol.row, next);
        changes++;
        updated.push(viol.row);
        continue;
      } else {
        throw new D1Error(uniqueMsg(table, viol.cols), { code: 'UNIQUE' });
      }
    }
    checkUniques(db, table, candidate);
    table.rows.push(candidate);
    changes++;
    inserted.push(candidate);
  }

  if (changes) db._counter?.increment('d1.rows', changes);
  return {
    meta: { changes, last_row_id: inserted.at(-1)?.id ?? null },
    returnRows: [...inserted, ...updated],
  };
}

function applyReturning(ast, returnRows, base) {
  if (!ast.returning) return base;
  const proj = compileProjection(ast.returning, [], { v: 0 });
  const rows = returnRows.map(r => evalProjection(proj, r));
  return { results: rows, meta: base.meta };
}

function execUpdate(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  // Bind SET params FIRST - D1 binds positionally in textual order, so
  // `UPDATE t SET a=? WHERE b=?` must read params[0] for a, params[1] for b.
  const setFns = ast.set.map(s => ({
    col: s.col,
    fn: compileExpr(s.src, { params, consumed, allowAgg: false, hasExcluded: false }),
  }));
  const whereFn = ast.where === 'ALL'
    ? () => true
    : compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false });
  const targets = table.rows.filter(row => truthy(whereFn(ctxForRow(row))));
  if (!targets.length) return { meta: { changes: 0, last_row_id: null }, returnRows: [] };

  const returnRows = [];
  let changes = 0;
  for (const row of targets) {
    // All SET expressions read the row's ORIGINAL values (SQLite semantics),
    // then apply together - CASE vs stored cols and arithmetic compose.
    const c = ctxForRow(row);
    const next = { ...row };
    for (const { col, fn } of setFns) next[col] = serialize(fn(c));
    checkUniques(db, table, next, row.id);
    Object.assign(row, next);
    changes++;
    returnRows.push(row);
  }
  db._counter?.increment('d1.rows', changes);
  return { meta: { changes, last_row_id: null }, returnRows };
}

function execDelete(db, ast, params) {
  const table = db._table(ast.table);
  const consumed = { v: 0 };
  const whereFn = ast.where === 'ALL'
    ? () => true
    : compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false });
  const affected = table.rows.filter(r => truthy(whereFn(ctxForRow(r))));
  const affectedSet = new Set(affected);
  table.rows = table.rows.filter(r => !affectedSet.has(r));
  db._counter?.increment('d1.rows', affected.length);
  return { meta: { changes: affected.length, last_row_id: null }, returnRows: affected };
}

// ---------- statement parser ----------

/** Locate a keyword outside quotes + parens; returns its index or -1. */
function findTopWord(sql, kw) {
  let depth = 0, quoted = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quoted) { if (ch === quoted) quoted = null; continue; }
    if (ch === `'`) { quoted = ch; continue; }
    if (ch === `(`) { depth++; continue; }
    if (ch === `)`) { depth--; continue; }
    if (depth === 0 && wordAt(sql, i, kw)) return i;
  }
  return -1;
}

function wordAt(sql, i, kw) {
  // Case-insensitive whole-word match at position i ('OR' must not fire
  // inside 'ORDER'; boundaries are non-word chars A-z0-9_).
  const slice = sql.slice(i, i + kw.length);
  if (slice.toUpperCase() !== kw.toUpperCase()) return false;
  const before = i === 0 ? ' ' : sql[i - 1];
  const after = sql[i + kw.length] ?? ' ';
  return /[\W]/.test(before) && /[\W]/.test(after);
}

/**
 * Parse a SELECT clause. `fallbackTable` lets an INSERT..SELECT omit FROM:
 * its bare aggregates scope over the INSERT target's own rows (the seq
 * allocator pattern - SQLite does the same). A standalone FROM-less SELECT
 * (outside INSERT..SELECT) stays an unsupported gap.
 */
export function parseSelectClause(s, fallbackTable = null) {
  s = s.trim();
  const m = s.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)(?:\s+FROM\s+([.\w]+))?(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\?|\d+)(?:\s+OFFSET\s+(\?|\d+))?)?$/i);
  if (!m) {
    throw new D1Error(
      `crashtest-fake-d1: unsupported statement: ${s.slice(0, 60)}... (v0.2 subset: SELECT/INSERT/UPDATE/DELETE; no JOIN/subquery/GROUP BY/trigger/CREATE-ALTER)`,
      { code: 'UNSUPPORTED' });
  }
  const [, distinctRaw, selector, table, where, orderBy, limit, offset] = m;
  if (!table) {
    // A top-level FROM that did not parse into the FROM-group means trailing
    // grammar the subset does not accept (table aliases, JOINs, ...).
    if (findTopWord(s, 'FROM') > -1) {
      throw new D1Error(
        `crashtest-fake-d1: unsupported statement: ${s.slice(0, 60)}... (v0.2 subset: SELECT/INSERT/UPDATE/DELETE; no JOIN/subquery/GROUP BY/trigger/CREATE-ALTER)`,
        { code: 'UNSUPPORTED' });
    }
    // Real SQLite semantics (verified against node:sqlite): a FROM-less
    // SELECT with bare column refs errors `no such column: seq`. Pure
    // param/literal projections (`SELECT ?, ?` inside INSERT..SELECT) are
    // legal - exactly one row.
    const refWord = tokenize(selector.trim()).find(t =>
      t.t === 'word'
      && !['NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COALESCE', 'MAX', 'MIN', 'COUNT', 'SUM', 'AVG'].includes(t.v.toUpperCase())
      && !t.v.includes('.'));
    if (refWord) {
      throw new D1Error(`crashtest-fake-d1: no such column: ${refWord.v} (FROM-less SELECT has no column scope; SQLite errors the same way)`, { code: 'NO_COLUMN' });
    }
  }
  const orderByList = orderBy
    ? splitProjection(orderBy).map(chunk => {
        const parts = chunk.trim().split(/\s+/);
        return { col: parts[0], dir: (parts[1] || 'ASC').toUpperCase() };
      })
    : null;
  return {
    verb: 'SELECT',
    distinct: !!distinctRaw,
    projection: selector.trim(),
    table: table ?? fallbackTable,
    fromLess: !table,
    where: where ? where.trim() : 'ALL',
    orderBy: orderByList,
    limit: limit != null && limit !== '?' ? Number(limit) : null,
    limitRaw: limit ?? null,
    offset: offset != null && offset !== '?' ? Number(offset) : null,
    offsetRaw: offset ?? null,
  };
}

export function parseStatement(sql) {
  const s = sql.trim().replace(/;\s*$/, '');

  if (/^SELECT\s+/i.test(s)) return parseSelectClause(s);

  // strip a top-level RETURNING clause first (INSERT/UPDATE/DELETE may carry it)
  let returning = null;
  let body = s;
  const retIdx = findTopWord(s, 'RETURNING');
  if (retIdx > -1) {
    returning = s.slice(retIdx + 'RETURNING'.length).trim();
    body = s.slice(0, retIdx).trim();
  }

  let m = body.match(/^INSERT\s+(OR\s+(IGNORE|REPLACE)\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*([\s\S]+)$/i);
  if (m) {
    const [, , orMode, table, cols, rest] = m;

    // ON CONFLICT clause (top-level, after the tuples)
    let conflict = null;
    let valuesPart = rest;
    const ocIdx = findTopWord(rest, 'CONFLICT');
    if (ocIdx > -1) {
      const before = rest.slice(0, ocIdx);
      if (!/\bON\s*$/i.test(before)) {
        throw new D1Error(`crashtest-fake-d1: cannot parse literal "${rest.slice(ocIdx - 3, ocIdx + 40)}" (bare CONFLICT, expected ON CONFLICT)`, { code: 'PARSE' });
      }
      valuesPart = before.replace(/\bON\s*$/i, '').trim();
      const ocRest = rest.slice(ocIdx + 'CONFLICT'.length).trim();
      const oc = ocRest.match(/^\(([^)]+)\)\s*(?:DO\s+NOTHING|DO\s+UPDATE\s+SET\s+([\s\S]+))$/i);
      if (!oc) {
        throw new D1Error(`crashtest-fake-d1: cannot parse literal "ON CONFLICT ..." (wants: ON CONFLICT (cols) DO NOTHING | DO UPDATE SET a = <expr>)`, { code: 'PARSE' });
      }
      conflict = {
        cols: splitProjection(oc[1]),
        action: oc[0].toUpperCase().includes('DO NOTHING') ? 'NOTHING' : 'UPDATE',
        sets: oc[0].toUpperCase().includes('DO NOTHING') ? null : splitProjection(oc[2]).map(pair => {
          const eq = pair.indexOf('=');
          return { col: pair.slice(0, eq).trim(), src: pair.slice(eq + 1).trim() };
        }),
      };
    }

    const columns = splitProjection(cols);
    const source = valuesPart.match(/^VALUES\s+([\s\S]+)$/i)
      ? {
          kind: 'values',
          tuples: splitProjection(valuesPart.replace(/^VALUES\s+/i, '')).map(tuple =>
            splitProjection(tuple.replace(/^\(|\)$/g, ''))),
        }
      : (() => {
          if (!/^SELECT\s+/i.test(valuesPart)) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${valuesPart.slice(0, 40)}" (VALUES tuples or INSERT..SELECT)`, { code: 'PARSE' });
          }
          const sel = parseSelectClause(valuesPart, table);
          return { kind: 'select', select: sel, projSize: splitProjection(sel.projection).length };
        })();

    if (orMode && conflict) {
      throw new D1Error(`crashtest-fake-d1: cannot combine OR ${orMode} with an ON CONFLICT clause`, { code: 'PARSE' });
    }

    return { verb: 'INSERT', table, columns, source, orMode: orMode ?? null, conflict, returning };
  }

  m = body.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (m) {
    const [, table, setClause, where] = m;
    const set = splitProjection(setClause).map(pair => {
      const i = pair.indexOf('=');
      return { col: pair.slice(0, i).trim(), src: pair.slice(i + 1).trim() };
    });
    return { verb: 'UPDATE', table, set, where: where ? where.trim() : 'ALL', returning };
  }

  m = body.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (m) {
    const [, table, where] = m;
    return { verb: 'DELETE', table, where: where ? where.trim() : 'ALL', returning };
  }

  throw new D1Error(
    `crashtest-fake-d1: unsupported statement: ${s.slice(0, 60)}... (v0.2 subset: SELECT/INSERT/UPDATE/DELETE; no JOIN/subquery/GROUP BY/trigger/CREATE-ALTER)`,
    { code: 'UNSUPPORTED' });
}

// ---------- the fake D1 ----------

export class FakeD1 {
  /**
   * @param {object} opts
   * @param {object} [opts.tables]  { name: { rows:[...], uniques?: { name: [col,...] } } }
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
      case 'SELECT':
        return { results: execSelect(this.db, ast, this._params), meta: { changes: 0, last_row_id: null } };
      case 'INSERT': {
        const res = execInsert(this.db, ast, this._params);
        return ast.returning ? applyReturning(ast, res.returnRows, res) : { meta: res.meta };
      }
      case 'UPDATE': {
        const res = execUpdate(this.db, ast, this._params);
        return ast.returning ? applyReturning(ast, res.returnRows, res) : { meta: res.meta };
      }
      case 'DELETE': {
        const res = execDelete(this.db, ast, this._params);
        return ast.returning ? applyReturning(ast, res.returnRows, res) : { meta: res.meta };
      }
      default: throw new D1Error(`unhandled verb ${ast.verb}`, { code: 'INTERNAL' });
    }
  }

  async run() {
    const res = await this._exec();
    if (Array.isArray(res.results)) return { results: res.results, meta: res.meta, success: true };
    return { meta: res.meta, success: true };
  }

  async all() {
    const res = await this._exec();
    if (!Array.isArray(res.results)) {
      throw new D1Error(`crashtest-fake-d1: .all() on a write statement: ${this.sql.slice(0, 40)}`,
        { code: 'WRITE_ALL' });
    }
    return { results: res.results, meta: res.meta, success: true };
  }

  async first(col) {
    const res = await this._exec();
    if (!Array.isArray(res.results)) {
      throw new D1Error(`crashtest-fake-d1: .first() on a write statement: ${this.sql.slice(0, 40)}`,
        { code: 'WRITE_FIRST' });
    }
    const row = res.results[0] ?? null;
    if (row == null || col == null) return row;
    if (!(col in row)) throw new D1Error(`crashtest-fake-d1: no such column: ${col}`, { code: 'NO_COLUMN' });
    return row[col];
  }
}
