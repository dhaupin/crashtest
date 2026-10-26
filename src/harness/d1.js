// S1.1 - in-memory D1 shim ("the proven path" from the gistory hardening
// passes). Mirrors the D1 API surface apps actually use:
//
//   db.prepare(sql).bind(...params).run() / .first(col) / .all()
//
// Supported SQL subset (v0.3 - grew from v0.2 for the issue #9 expansion):
//   SELECT [DISTINCT] *|<expr-list> FROM t [JOIN t2 ON <cond>] [WHERE ...]
//     [GROUP BY col, ... [HAVING <expr>]] [ORDER BY col|alias [ASC|DESC],...]
//     [LIMIT ?|n [OFFSET ?|m]]
//     expressions: `?` params (textual order), numbers, 'strings' ('' escapes),
//       true/false, NULL, arithmetic (+ - * / %), comparisons (= != <> < > <= >=),
//       AND / OR, IS [NOT] NULL, IN (?, ?, ...) and IN (SELECT ...) (depth-one,
//       exactly one projection column), CASE WHEN..THEN..[ELSE..]END,
//       COALESCE(...), bare + table-qualified (t.col) column refs,
//       `excluded.<col>` (upserts only)
//     scalar fns: UPPER LOWER LENGTH TRIM ABS
//     aggregates (SELECT projections only): MAX MIN COUNT SUM AVG; `AS alias`
//     (unaliased COUNT(*) keeps the v0.1 output key `count` - pinned contract)
//     deterministic fake-clock date fns (harness has ONE clock - every 'now'
//       and default reads FAKE_CLOCK_EPOCH; same seed -> same output):
//       UNIXEPOCH(v) DATETIME(v[,fmt]) JULIANDAY(v) STRFTIME(fmt,v)
//     JSON fns: JSON_EXTRACT(js, path) JSON_TYPE(js) JSON_QUOTE(js)
//     JOIN = one merge condition (t.col pairs or one bare shared key),
//       INNER|LEFT|CROSS (RIGHT -> rewrite as LEFT; doc gap)
//     GROUP BY takes plain column refs; ORDER BY may use projection ALIASES
//     so the daily-rollup + status-board queries stop re-fanning in JS
//   CREATE TABLE [IF NOT EXISTS] t (col TYPE [constraints], ...) and
//   ALTER TABLE t ADD COLUMN name TYPE [NOT NULL] [DEFAULT <expr>]
//     so the ensureSchema pattern runs pre-campaign like it does on real D1
//   INSERT/UPDATE/DELETE/RETURNING/LIMIT ?/OFFSET ? (v0.2 semantics, unchanged)
//
// Upsert resolution (matches D1/SQLite): inside `ON CONFLICT(...) DO UPDATE
// SET ...`, each expression reads the STORED row for bare column refs (at
// eval time, pre-assignment - all expressions see the row's original values)
// and the CANDIDATE row for `excluded.<col>`. Params bind in textual order
// across the whole statement (source first, then the DO UPDATE SET exprs).
//
// NOT supported (throw with a listed gap message so gaps surface in DISCOVER,
// not mid-campaign): window functions, bare columns mixed with whole-set
// aggregates in one projection, expressions in GROUP BY (plain cols only),
// bare-aggregate HAVING, NOT, nested subqueries, month/year date modifiers,
// quoted identifiers, TRIGGERs, foreign keys, DROP/RENAME (beyond ADD
// COLUMN), lists-of-columns-less INSERT, RIGHT JOIN, JOIN-ON with params,
// OR IGNORE|REPLACE combined with an ON CONFLICT clause.
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

// The rule-6-safe row identity lives in diff.js (the harness has ONE
// definition of "these two rows are the same"); DISTINCT/GROUP BY key on it.
import { stableFingerprint } from './diff.js';

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
    if (ch === `'` || ch === `"`) {
      // single-quoted strings ('' escapes) + double-quoted strings (SQLite
      // accepts both in expressions; JSON path literals arrive quoted)
      let j = i + 1, out = '';
      for (;;) {
        if (j >= src.length) throw new D1Error(`crashtest-fake-d1: unmatched quote in "${src}"`, { code: 'PARSE' });
        // doubled-quote + backslash escapes are checked BEFORE the closer -
        // they live on characters the closer test would otherwise swallow
        if (ch === `"` && src[j] === '\\' && (src[j + 1] === `"` || src[j + 1] === '\\')) {
          out += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          if (ch === `'` && src[j + 1] === `'`) { out += `'`; j += 2; continue; }
          if (ch === `"` && src[j + 1] === `"`) { out += `"`; j += 2; continue; }
          break;
        }
        out += src[j++];
      }
      toks.push({ t: 'str', v: out, a: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      toks.push({ t: 'num', v: Number(m[0]), a: i });
      i = NUM_RE.lastIndex;
      continue;
    }
    if (ch === '?') { toks.push({ t: 'param', a: i }); i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      WORD_RE.lastIndex = i;
      const m = WORD_RE.exec(src);
      toks.push({ t: 'word', v: m[0], a: i });
      i = WORD_RE.lastIndex;
      continue;
    }
    if (ch === `(`) { toks.push({ t: 'punc', v: '(', a: i }); i++; continue; }
    if (ch === `)`) { toks.push({ t: 'punc', v: ')', a: i }); i++; continue; }
    if (ch === `,`) { toks.push({ t: 'punc', v: ',', a: i }); i++; continue; }
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

// ---------- fake-clock date/JSON helpers (issue #9) ----------
// (comment preserved; imports live at the top)
// The harness has ONE clock: FAKE_CLOCK_EPOCH. Date functions never touch
// Date.now(); 'now' evaluates to that constant, so the same seed gives the
// same output no matter when the campaign runs (determinism, house law 4).
export const FAKE_CLOCK_EPOCH = 1770000000; // 2026-02-02T02:40:00Z

function dateParts(epochSec) {
  const d = new Date(epochSec * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    YYYY: String(d.getUTCFullYear()),
    MM: p(d.getUTCMonth() + 1),
    DD: p(d.getUTCDate()),
    HH: p(d.getUTCHours()),
    MI: p(d.getUTCMinutes()),
    SS: p(d.getUTCSeconds()),
    s: String(epochSec),
    w: String(d.getUTCDay()),
  };
}

function parseDateArg(raw) {
  if (isNullVal(raw)) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'now') return FAKE_CLOCK_EPOCH;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2}))?)?[Zz]?$/);
  if (m) {
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)) / 1000;
  }
  throw new D1Error(`crashtest-fake-d1: cannot parse date value "${String(raw).slice(0, 40)}" (fake engine reads ISO strings, unix seconds, or 'now' = the fixed harness clock)`, { code: 'PARSE' });
}

const MOD_SECONDS = { day: 86400, days: 86400, hour: 3600, hours: 3600, minute: 60, minutes: 60, second: 1, seconds: 1, week: 604800, weeks: 604800 };
function applyDateMods(mods) {
  if (mods == null) return 0;
  const list = Array.isArray(mods) ? mods : [mods];
  let total = 0;
  for (const m of list) {
    if (typeof m === 'number') { total += m; continue; }
    const hit = String(m).trim().toLowerCase().match(/^([+-]?\d+(?:\.\d+)?)\s+([a-z]+)$/);
    if (!hit) continue; // unknown modifier kinds are skipped (SQLite-lenient; documented)
    if (hit[2].startsWith('month') || hit[2].startsWith('year')) {
      throw new D1Error(`crashtest-fake-d1: unsupported date modifier "${m}" (month/year offsets need calendar arithmetic the fake engine does not model - use day/hour/minute/second)`, { code: 'UNSUPPORTED' });
    }
    total += Number(hit[1]) * (MOD_SECONDS[hit[2]] ?? 0);
  }
  return total;
}

/** STRFTIME-style output for DATETIME(v, fmt) / STRFTIME(fmt, v). Unknown %-codes pass through. */
function fmtDatetime(fmt, epochSec) {
  const p = dateParts(epochSec);
  return String(fmt).replace(/%(.)/g, (_, c) =>
    ({ Y: p.YYYY, m: p.MM, d: p.DD, H: p.HH, M: p.MI, S: p.SS, s: p.s, w: p.w, e: p.DD })[c] ?? `%${c}`);
}

const dateIso = (e) => { const p = dateParts(e); return `${p.YYYY}-${p.MM}-${p.DD} ${p.HH}:${p.MI}:${p.SS}`; };
const isDateTimeFn = (n) => ['UNIXEPOCH', 'DATETIME', 'JULIANDAY', 'STRFTIME'].includes(n);

/** JSON_EXTRACT path lookup ('$.a.b', '$[0]', bare 'a.b'); missing -> null. */
function jsonPathGet(data, path) {
  let cur = data;
  const s = String(path ?? '').trim();
  if (s !== '$') {
    const raw = s.startsWith('$.') ? s.slice(2) : s.replace(/^\$/, '');
    for (const part of raw.split(/[.\[\]]+/).filter(Boolean)) {
      if (cur == null || typeof cur !== 'object') return null;
      const key = /^-?\d+$/.test(part) ? Number(part) : part;
      if (!(key in cur)) return null;
      cur = cur[key];
    }
  }
  return cur;
}

function jsonTypeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'boolean') return 'true/false';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'real';
  return 'text';
}

function compileExpr(src, ctx) {
  const { params, consumed, allowAgg, hasExcluded, deferred, binding = { depth: 0, db: null } } = ctx;
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
        if (peek()?.t === 'word' && peek().v.toUpperCase() === 'SELECT') {
          // scalar IN (SELECT ...) subquery (issue #9): exactly one projection
          // column, nesting depth 1, ?s rebind against the surrounding
          // statement's textual order when the evaluator first runs it.
          if (binding.depth >= 1) {
            throw new D1Error(`crashtest-fake-d1: unsupported predicate in "${src}" (nested subqueries are a documented gap - flatten the two WHEREs into one)`, { code: 'UNSUPPORTED' });
          }
          const start = peek().a;
          let opened = 1, endIdx = null;
          for (let k = pos; k < toks.length; k++) {
            if (toks[k].t === 'punc' && toks[k].v === '(') opened++;
            else if (toks[k].t === 'punc' && toks[k].v === ')') {
              opened--;
              if (opened === 0) { endIdx = k; break; }
            }
          }
          if (endIdx == null) {
            throw new D1Error(`crashtest-fake-d1: cannot parse expression "${src}" (unterminated subquery - wants IN (SELECT ...))`, { code: 'PARSE' });
          }
          const subSrc = src.slice(start, toks[endIdx].a);
          pos = endIdx + 1;
          const preCount = consumed.v;
          const subAst = parseStatement(subSrc);
          subAst.__subDepth = binding.depth + 1; // the sub runs nested: its own IN(SELECT) must refuse
          const boundArr = [];          const subBinding = { depth: 1, get db() { return binding.db; } };
          // Count the subquery's own ?s (positional rebinding) and bump the
          // outer consumption - the ast re-executes at eval time; no probe
          // compile is needed (a SELECT is not an expression).
          const subConsumed = { v: tokenize(subSrc).filter((tk) => tk.t === 'param').length };
          consumed.v = preCount + subConsumed.v;
          const l0 = l;
          let primed = false;
          l = (c) => {
            const db = subBinding.db;
            if (db == null) {
              throw new D1Error(`crashtest-fake-d1: subquery in "${src.slice(0, 40)}" evaluated without a database scope (internal sink)`, { code: 'INTERNAL' });
            }
            if (preCount + subConsumed.v > params.length) {
              throw new D1Error(`crashtest-fake-d1: subquery needs ${subConsumed.v} bound parameter(s) from position ${preCount + 1} but only ${params.length - preCount} were bound (${subSrc.slice(0, 40)})`, { code: 'NO_PARAM' });
            }
            if (!primed) {
              for (let i = 0; i < subConsumed.v; i++) boundArr[i] = params[preCount + i];
              primed = true;
            }
            const sub = execSelectRows(db, subAst, boundArr, null);
            const vals = sub.map((row) => {
              if (isNullVal(row)) return null;
              if (Object.keys(row).length !== 1) {
                throw new D1Error(`crashtest-fake-d1: scalar IN subquery must select exactly one column (got ${Object.keys(row).length}: ${subSrc.slice(0, 30)})`, { code: 'PARSE' });
              }
              return Object.values(row)[0];
            });
            const v = l0(c);
            return vals.some((sv) => sv === v);
          };
        } else {
          const items = [];
          if (!(peek()?.t === 'punc' && peek().v === ')')) {
            items.push(parseAdd());
            while (eatPunc(',')) items.push(parseAdd());
          }
          expectPunc(')');
          const l0 = l;
          l = (c) => { const v = l0(c); return items.some(f => f(c) === v); };
        }
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
    MAX(rows, argFn) { const v = rows.map((r) => argFn(r)).filter((x) => !isNullVal(x)); return v.length ? Math.max(...v) : null; },
    MIN(rows, argFn) { const v = rows.map((r) => argFn(r)).filter((x) => !isNullVal(x)); return v.length ? Math.min(...v) : null; },
    SUM(rows, argFn) { const v = rows.map((r) => argFn(r)).filter((x) => !isNullVal(x)); return v.length ? v.reduce((s, x) => s + numVal(x), 0) : null; },
    AVG(rows, argFn) { const v = rows.map((r) => argFn(r)).filter((x) => !isNullVal(x)); return v.length ? v.reduce((s, x) => s + numVal(x), 0) / v.length : null; },
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

        // scalar string/math functions (issue #9)
        const SIMPLE_FNS = {
          UPPER: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
          LOWER: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
          LENGTH: (v) => (typeof v === 'string' ? v.length : null),
          TRIM: (v) => (typeof v === 'string' ? v.trim() : v),
          ABS: (v) => (typeof v === 'number' ? Math.abs(v) : null),
        };
        if (SIMPLE_FNS[fname]) {
          if (args.length !== 1) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (${fname} takes one argument - got ${args.length})`, { code: 'PARSE' });
          }
          const f = SIMPLE_FNS[fname], a = args[0];
          return (c) => {
            const v = a(c);
            return isNullVal(v) ? null : f(v);
          };
        }
        // deterministic fake-clock date functions (issue #9): 'now' and
        // defaults evaluate against FAKE_CLOCK_EPOCH - never Date.now()
        if (isDateTimeFn(fname)) {
          // SQLite allows ANY number of trailing modifier args:
          //   DATETIME(v, '-1 day', '2 hours'...) / STRFTIME(fmt, v, mods...)
          if (fname === 'STRFTIME' && args.length < 2) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (STRFTIME wants STRFTIME(fmt, value [, modifier, ...]))`, { code: 'PARSE' });
          }
          if (fname !== 'STRFTIME' && args.length < 1) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (${fname} wants ${fname}(value [, modifier, ...]))`, { code: 'PARSE' });
          }
          const fmtA = fname === 'STRFTIME' ? args[0] : null;
          const valA = fname === 'STRFTIME' ? args[1] : args[0];
          const modsA = fname === 'STRFTIME' ? args.slice(2) : args.slice(1);
          return (c) => {
            const fmt = fmtA ? fmtA(c) : null;
            const base = parseDateArg(valA(c));
            if (base == null) return null;
            const epochSec = base + applyDateMods(modsA.map((m) => m(c)));
            if (fname === 'UNIXEPOCH') return Math.floor(epochSec);
            if (fname === 'JULIANDAY') return epochSec / 86400 + 2440587.5;
            if (fname === 'DATETIME') return fmt ? fmtDatetime(fmt, epochSec) : dateIso(epochSec);
            return fmtDatetime(fmt, epochSec); // STRFTIME
          };
        }
        // JSON functions (issue #9): paths degrades to NULL per SQLite
        if (fname === 'JSON_EXTRACT' || fname === 'JSON_TYPE' || fname === 'JSON_QUOTE') {
          const need = fname === 'JSON_EXTRACT' ? 2 : 1;
          if (args.length !== need) {
            throw new D1Error(`crashtest-fake-d1: cannot parse literal "${src}" (${fname} takes ${need} argument${need === 1 ? '' : 's'})`, { code: 'PARSE' });
          }
          const arg0 = args[0];
          const pathA = fname === 'JSON_EXTRACT' ? args[1] : null;
          return (c) => {
            const raw = arg0(c);
            if (isNullVal(raw)) return null;
            let data = raw;
            if (fname !== 'JSON_QUOTE' && typeof data === 'string') {
              try { data = JSON.parse(data); } catch { return null; }
            }
            if (pathA != null) data = jsonPathGet(data, pathA(c));
            if (fname === 'JSON_TYPE') return jsonTypeOf(data);
            if (fname === 'JSON_QUOTE') return JSON.stringify(data);
            return data;
          };
        }

        // unknown function: keep the v0.1 gap message the pins rely on
        throw new D1Error(`crashtest-fake-d1: cannot parse literal "${t.v}(...)" (unsupported function ${t.v}; supported: COALESCE, UPPER, LOWER, LENGTH, TRIM, ABS, UNIXEPOCH, DATETIME, JULIANDAY, STRFTIME, JSON_EXTRACT, JSON_TYPE, JSON_QUOTE + aggregates in SELECT projections)`, { code: 'PARSE' });
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
    // BOTH quote shapes split-protect: the tokenizer accepts double-quoted
    // strings (JSON path literals arrive quoted), so a ',' inside "a,b"
    // must not split the projection list.
    if (ch === `'` || ch === `"`) { quoted = ch; continue; }
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
    return { fn, key, isAgg: AGG_RE.test(i.src) };
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
  const consumed = { v: 0 };
  const binding = { depth: ast.__subDepth ?? 0, db: null };

  // ---- reference rows: a single table or a one-key JOIN pair (issue #9) ----
  // FROM-less standalone SELECT (scalar/param projections only, SQLite
  // compatible) evaluates against one empty row - v0.3 hosts it now that
  // scalar date/JSON fns exist (bare column refs still parse-reject).
  const fromLess = !ast.table && !fallbackTable;
  const tableA = fromLess ? null : db._table(ast.table ?? fallbackTable);
  const tableB = ast.join ? db._table(ast.join.table) : null;
  const onFn = ast.join
    ? compileExpr(ast.join.on, { params, consumed, allowAgg: false, hasExcluded: false, binding })
    : null;

  // Compile in TEXTUAL param order: the ON/projection/WHERE ?s bind first,
  // then LIMIT/OFFSET (D1 binds positionally by text).
  let proj = null;
  if (ast.projection !== '*') {
    proj = compileProjection(ast.projection, params, consumed);
  }
  const hasAgg = proj ? proj.isAggregate : false;
  const groupKeyCols = Array.isArray(ast.groupBy) && ast.groupBy.length > 0
    ? ast.groupBy.map((src) => {
        const s2 = String(src).trim();
        if (!/^[\w.]+$/.test(s2)) {
          throw new D1Error(`crashtest-fake-d1: GROUP BY "${s2.slice(0, 30)}" (group keys are plain column refs only; arbitrary expressions are a documented gap)`, { code: 'PARSE' });
        }
        return s2;
      })
    : null;
  if (ast.having && !groupKeyCols) {
    throw new D1Error(`crashtest-fake-d1: HAVING requires GROUP BY (bare-aggregate HAVING is a documented gap)`, { code: 'PARSE' });
  }
  const whereFn = ast.where && ast.where !== 'ALL'
    ? compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false, binding })
    : () => true;
  const havingFn = ast.having
    ? compileExpr(ast.having, { params, consumed, allowAgg: true, hasExcluded: false, binding })
    : null;
  binding.db = db; // IN (SELECT ...) subqueries resolve against the outer db

  // joined rows are [{ a: leftRow, b: rightRow|null }] pairs (b = null for
  // the LEFT-join no-match arm); contexts qualify tA./tB. refs and probe
  // own-table-first for bare names (documented ambiguity fallback).
  const matched = [];
  if (ast.join?.kind === 'CROSS') {
    for (const a of tableA.rows) {
      for (const b of tableB.rows) {
        const rc = rowCtx(a, b, tableA, tableB);
        if (truthy(whereFn(rc))) matched.push({ p: { a, b }, rc });
      }
    }
  } else if (tableB) {
    for (const a of tableA.rows) {
      let hit = false;
      for (const b of tableB.rows) {
        const rc = rowCtx(a, b, tableA, tableB);
        if (truthy(onFn(rc)) && truthy(whereFn(rc))) {
          matched.push({ p: { a, b }, rc });
          hit = true;
        }
      }
      if (ast.join.kind === 'LEFT' && !hit) {
        const rc = rowCtx(a, null, tableA, tableB);
        if (truthy(whereFn(rc))) matched.push({ p: { a, b: null }, rc });
      }
    }
  } else if (!tableA) {
    matched.push({ p: { a: null, b: null }, rc: rowCtx(null, null, null, null) }); // the one FROM-less row
  } else {
    for (const a of tableA.rows) {
      const rc = rowCtx(a, null, tableA, null);
      if (truthy(whereFn(rc))) matched.push({ p: { a, b: null }, rc });
    }
  }

  // Emit the keyed output AND the positional __vals in one pass - the old
  // v0.2 double-call re-evaluated every item fn, which would re-fire
  // aggregate (row-pair) emitters per row and double-count SETs. Values are
  // non-enumerable: invisible to JSON.stringify and Object.keys, so SELECT
  // output shape stays byte-identical to a keyed row.
  const emitRow = (rc, c) => {
    const obj = {};
    const vals = [];
    for (const it of proj.items) {
      const v = it.fn(it.isAgg && c ? c : rc);
      obj[it.key] = v;
      vals.push(v);
    }
    Object.defineProperty(obj, '__vals', { value: vals, enumerable: false, configurable: true });
    return obj;
  };

  let orderItems = [];
  if (groupKeyCols) {
    // GROUP BY (issue #9): per-group rollup. Aggregation items scope over
    // the group's rows; plain items read the group's FIRST row (SQLite
    // semantics for bare columns next to aggregates).
    const groups = new Map();
    for (const { p, rc } of matched) {
      const keyVals = groupKeyCols.map((c) => rc.get(c));
      // stableFingerprint, not stringify: a group key [a, undefined]
      // stringified to just ["a"] and collapsed into the missing-key group
      // (the rule-6 drop, once per key element).
      const key = stableFingerprint(keyVals);
      if (!groups.has(key)) groups.set(key, { keyVals, members: [] });
      groups.get(key).members.push({ p, rc });
    }
    const entries = [...groups.values()];
    for (const g of havingFn
      ? entries.filter((g2) => {
          // HAVING ctx merges both evaluation modes: aggregate terms read
          // c.set (scoped to THIS group), plain terms read the first row.
          const hctx = { set: g2.members.map((m) => m.rc), get: g2.members[0].rc.get };
          return truthy(havingFn(hctx));
        })
      : entries) {
      let obj;
      const firstRc = g.members[0].rc;
      if (!proj) {
        // SELECT * ... GROUP BY col: one row per key (first row's values)
        const first = g.members[0].p;
        obj = { ...(first.a ?? {}), ...(first.b ?? {}) };
        orderItems.push({ out: obj, gKeyVals: g.keyVals });
      } else if (hasAgg) {
        const c = { set: g.members.map((m) => m.rc) };
        obj = emitRow(firstRc, c);
        orderItems.push({ out: obj, gKeyVals: g.keyVals });
      } else {
        obj = emitRow(firstRc, null);
        orderItems.push({ out: obj, gKeyVals: g.keyVals });
      }
    }
  } else if (hasAgg) {
    const c = { set: matched.map((m) => m.rc) };
    const obj = emitRow(null, c);
    orderItems.push({ out: obj });
  } else {
    for (const { p, rc } of matched) {
      if (!proj) {
        const obj = {};
        Object.assign(obj, p.a ?? {}, p.b ?? {}); // SELECT * on a JOIN: right table wins duplicate names
        orderItems.push({ out: obj, rc });
      } else {
        orderItems.push({ out: emitRow(rc, null), rc });
      }
    }
  }

  let outRows = orderItems.map((e) => e.out);
  if (ast.distinct) {
    // Rule-6 identity, not JSON.stringify: stringify silently drops
    // undefined-valued keys and __proto__ own-keys, so two DISTINCT rows
    // differing only in one of those collapsed into one row (a silent
    // repeating-count lie in aggregate surfaces).
    const seen = new Set();
    orderItems = orderItems.filter((e) => {
      const key = stableFingerprint(e.out);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    outRows = orderItems.map((e) => e.out);
  }

  // ORDER BY (v0.3): multi-key, projection ALIASES, GROUP-BY key columns,
  // and raw columns resolvable on the joined row - stable reproduction of
  // the one-key v0.1 sort semantics.
  if (ast.orderBy?.length) {
    for (const { col, dir, src } of [...ast.orderBy].reverse()) {
      const isPlain = src === col;
      const srcFn = isPlain ? null : compileExpr(src, { params: [], consumed: { v: 0 }, allowAgg: false, hasExcluded: false });
      orderItems.sort((x, y) => {
        const keyOf = (e) => {
          if (Object.prototype.hasOwnProperty.call(e.out, col)) return e.out[col];
          if (e.gKeyVals && groupKeyCols.includes(col)) return e.gKeyVals[groupKeyCols.indexOf(col)];
          if (srcFn) return srcFn({ get: (n) => (e.rc ? e.rc.get(n) : null) });
          if (e.rc) return e.rc.get(col);
          return null;
        };
        const a = keyOf(x), b = keyOf(y);
        const cmp = a < b ? -1 : a > b ? 1 : 0;
        return dir === 'DESC' ? -cmp : cmp;
      });
      outRows = orderItems.map((e) => e.out);
    }
  }

  // LIMIT / OFFSET - bound by parameter allowed ('?' consumed in TEXTUAL
  // order: LIMIT's param is read before OFFSET's, matching the SQL text).
  // A bound-but-missing LIMIT param must fail loudly: falling through as
  // `undefined` silently drops the LIMIT and returns every row (a silent
  // row-flood, the misfire class that finds nothing by finding too much).
  if (ast.limitRaw === '?') {
    if (params[consumed.v] === undefined) {
      throw new D1Error(`crashtest-fake-d1: LIMIT ? has no bound parameter at position ${consumed.v + 1} (bind all ?s positionally)`, { code: 'NO_PARAM' });
    }
    ast.limit = params[consumed.v++];
  }
  if (ast.offsetRaw === '?') ast.offset = params[consumed.v++];
  // SQLite semantics: a negative OFFSET evaluates to zero (no skip) -
  // slice(-n) would instead keep the LAST n rows, which is a different
  // (wrong) answer on the same query.
  if (ast.offset != null) outRows = outRows.slice(Math.max(0, ast.offset));
  // SQLite semantics: a negative LIMIT means NO limit (not slice(0, -n)'s
  // "everything except the tail").
  if (ast.limit != null && ast.limit >= 0) outRows = outRows.slice(0, ast.limit);

  db._counter?.increment('d1.rows', outRows.length);
  return outRows;
}

function execSelect(db, ast, params) {
  return execSelectRows(db, ast, params, null);
}

// ---------- CREATE TABLE / ALTER TABLE (issue #9: the ensureSchema pattern) ----------

function execCreate(db, ast) {
  const EMPTY = { meta: { changes: 0, last_row_id: null } };
  db._counter?.increment('d1.ddl');
  if (db._t.has(ast.table)) {
    // re-running a migration stays honest: the flag that skipped it shows
    if (ast.ifNotExists) return EMPTY;
    throw new D1Error(`crashtest-fake-d1: table ${ast.table} already exists`, { code: 'TABLE_EXISTS' });
  }
  const uniques = new Map();
  const declaredId = ast.columns.some((c) => c.name.toLowerCase() === 'id' && c.constraints.includes('PRIMARY KEY'));
  for (const col of ast.columns) {
    if (declaredId && col.name.toLowerCase() === 'id') continue; // the allocator is implicit
    if (col.constraints.includes('UNIQUE')) uniques.set(`${ast.table}_${col.name}_unique`, [col.name]);
  }
  db._t.set(ast.table, {
    name: ast.table,
    rows: [],
    nextId: 1,
    uniques,
    pureId: declaredId || undefined,
    pureIdAgg: !declaredId || undefined,
  });
  return EMPTY;
}

function execAlter(db, ast) {
  const table = db._table(ast.table);
  db._counter?.increment('d1.ddl');
  if (table.rows.some((r) => ast.column.name in r)) {
    throw new D1Error(`crashtest-fake-d1: duplicate column name: ${ast.column.name}`, { code: 'PARSE' });
  }
  let backfill = null;
  if (ast.column.defaultSrc != null) {
    const fn = compileExpr(ast.column.defaultSrc, { params: [], consumed: { v: 0 }, allowAgg: false, hasExcluded: false });
    backfill = serialize(fn({ get: () => undefined }));
  }
  for (const row of table.rows) row[ast.column.name] = backfill; // NOT NULL without DEFAULT backfills NULL (row-local dummy, like SQLite's admin path)
  return { meta: { changes: table.rows.length, last_row_id: null } };
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
  const binding = { depth: 0, db: null };

  // 1) Source rows (VALUES tuples or INSERT..SELECT), params bound textually.
  const candidates = [];
  if (ast.source.kind === 'values') {
    const compiled = ast.source.tuples.map(tuple =>
      tuple.map(src => compileExpr(src, { params, consumed, allowAgg: false, hasExcluded: false, binding })));
    for (const cells of compiled) {
      // Tuple arity is a REAL SQLite error ("N values for M columns") that
      // the fake silently accepted: extra values became rogue row keys, a
      // short tuple left missing columns to read as nulls. Fail loud.
      if (cells.length !== ast.columns.length) {
        throw new D1Error(`crashtest-fake-d1: INSERT INTO ${ast.table} has ${ast.columns.length} columns but a VALUES tuple carries ${cells.length} values (${cells.length} values for ${ast.columns.length} columns)`, { code: 'PARSE' });
      }
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
        compileExpr(src, { params, consumed, allowAgg: false, hasExcluded: false, binding }));
      const vals = compiled.map(fn => serialize(fn({ get: () => undefined })));
      candidates.push(mkRow(table, ast.columns, vals, false));      } else {
      candidates.push(...candidatesFromSelect(db, ast, params));
    }
  }
  binding.db = db; // value IN (SELECT ...) subqueries resolve against the outer db

  // 2) DO UPDATE assignments compile ONCE (textual params after the source).
  const setFns = ast.conflict?.action === 'UPDATE'
    ? ast.conflict.sets.map(s => ({
        col: s.col,
        fn: compileExpr(s.src, { params, consumed, allowAgg: false, hasExcluded: true, binding }),
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
  const binding = { depth: 0, db: null };
  // Bind SET params FIRST - D1 binds positionally in textual order, so
  // `UPDATE t SET a=? WHERE b=?` must read params[0] for a, params[1] for b.
  const setFns = ast.set.map(s => ({
    col: s.col,
    fn: compileExpr(s.src, { params, consumed, allowAgg: false, hasExcluded: false, binding }),
  }));
  const whereFn = ast.where === 'ALL'
    ? () => true
    : compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false, binding });
  binding.db = db; // IN (SELECT ...) subqueries in SET/WHERE resolve here
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
  const binding = { depth: 0, db: null };
  const whereFn = ast.where === 'ALL'
    ? () => true
    : compileExpr(ast.where, { params, consumed, allowAgg: false, hasExcluded: false, binding });
  binding.db = db; // WHERE uid IN (SELECT ...) resolves against the outer db
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

/** Row-pair context: qualified tA./tB. refs hit their own table (the NULL
 * side of a LEFT join reads NULL); bare refs resolve own-table-first then
 * the other. When both tables share a bare name the LEFT (first) table
 * wins silently - SQLite would error "ambiguous column name"; the fake
 * resolves deterministically instead (documented gap). */
function rowCtx(a, b, tableA, tableB) {
  const get = (name) => {
    if (name.includes('.')) {
      const dot = name.indexOf('.');
      const prefix = name.slice(0, dot).toLowerCase();
      const col = name.slice(dot + 1);
      if (tableB && prefix === tableB.name.toLowerCase()) {
        if (b == null) return null; // the LEFT-join unmatched arm reads NULL
        if (!(col in b)) throw new D1Error(`crashtest-fake-d1: no such column: ${name} (columns of ${tableB.name}: ${Object.keys(b).join(', ')})`, { code: 'NO_COLUMN' });
        return b[col];
      }
      if (tableA && prefix === tableA.name.toLowerCase()) {
        if (a == null || !(col in a)) throw new D1Error(`crashtest-fake-d1: no such column: ${name} (columns of ${tableA.name}: ${tableA ? Object.keys(a ?? {}).join(', ') : ''})`, { code: 'NO_COLUMN' });
        return a[col];
      }
      throw new D1Error(`crashtest-fake-d1: no such table prefix "${prefix}." in "${name}" (joined tables: ${tableA?.name ?? '?'}${tableB ? ` / ${tableB.name}` : ''})`, { code: 'NO_COLUMN' });
    }
    if (a && name in a) return a[name];
    if (b && name in b) return b[name];
    return null;
  };
  return { get };
}

/** The gap message for statement bodies the v0.3 subset does not parse. */
function unsupportedSubset(s, why = 'v0.3 subset: SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER - no window-funcs/NOT/nested-subquery/trigger/DROP-RENAME/quoted-identifiers') {
  return new D1Error(`crashtest-fake-d1: unsupported statement: ${s.slice(0, 60)}... (${why})`, { code: 'UNSUPPORTED' });
}

/**
 * CREATE TABLE [IF NOT EXISTS] / ALTER TABLE .. ADD COLUMN (issue #9): the
 * ensureSchema pattern a run root speaks before the campaign queries run.
 * A declared `id INTEGER PRIMARY KEY` becomes the seeded autoincrement
 * allocator (FakeD1 seeds it implicitly, so an INSERT without the id
 * column still gets a fresh id); UNIQUE column flags feed the same
 * UNIQUE-constraint reading the seeded tables declare.
 */
export function parseDdl(sql) {
  let m = sql.match(/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]+)\)$/i);
  if (m) {
    const [, ineRaw, table, colText] = m;
    // A TABLE-LEVEL constraint line (UNIQUE(a, b), CHECK(...), FOREIGN KEY
    // ..., PRIMARY KEY(a, b), CONSTRAINT name ...) used to map into the
    // column list as a PHANTOM column named after the keyword - the declared
    // compound unique simply did not exist, and every silent-misfire class
    // the crates dies by lands there. Fail loud naming the unsupported
    // declaration instead.
    for (const line of splitProjection(colText)) {
      const trimmed = line.trim();
      if (/^(UNIQUE\s*\(|CHECK\s*\(|FOREIGN\s+KEY\b|CONSTRAINT\b|PRIMARY\s+KEY\b)/i.test(trimmed)) {
        throw new D1Error(`crashtest-fake-d1: table-level constraint "${trimmed.slice(0, 30)}" is unsupported (column-level UNIQUE flags and config-seeded uniques are the modeled subset)`, { code: 'UNSUPPORTED' });
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed.split(/\s+/)[0])) {
        throw new D1Error(`crashtest-fake-d1: cannot parse column definition "${trimmed.slice(0, 30)}" (column names are bare identifiers; quoted/odd names are a documented gap)`, { code: 'PARSE' });
      }
    }
    const columns = splitProjection(colText).map((c) => {
      const parts = c.trim().split(/\s+/);
      const name = parts[0];
      const type = (parts[1] && /^[A-Za-z]+$/.test(parts[1]) ? parts[1] : '').toUpperCase();
      const rest = (type ? parts.slice(2) : parts.slice(1)).join(' ').toUpperCase();
      const constraints = [];
      if (rest.includes('PRIMARY KEY')) constraints.push('PRIMARY KEY');
      if (rest.includes('NOT NULL')) constraints.push('NOT NULL');
      if (/\bUNIQUE\b/.test(rest)) constraints.push('UNIQUE');
      return { name, type, constraints };
    });
    return { verb: 'CREATE_TABLE', table, columns, ifNotExists: !!ineRaw };
  }
  m = sql.match(/^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)\s*([\s\S]*)$/i);
  if (m) {
    const rawTail = (m[3] ?? '').trim();
    const restParts = rawTail.split(/\s+/);
    const rest = restParts.join(' ').toUpperCase();
    if (rest.includes('NOT NULL') && !rest.includes('DEFAULT')) {
      throw new D1Error(`crashtest-fake-d1: ALTER TABLE ${m[1]} ADD COLUMN ${m[2]} NOT NULL without DEFAULT (SQLite refuses it on a non-empty table)`, { code: 'PARSE' });
    }
    const dm = rawTail.match(/DEFAULT\s+([\s\S]+)$/i);
    return {
      verb: 'ALTER_TABLE',
      table: m[1],
      column: {
        name: m[2],
        type: (restParts[0] && /^[A-Za-z]+$/.test(restParts[0] ?? '') ? restParts[0] : '').toUpperCase(),
        nullable: !rest.includes('NOT NULL'),
        // keep the RAW literal: `'unset'` compiles as a string, `0` as a
        // number - quote-stripping here would turn strings into bare
        // column refs that eval to undefined
        defaultSrc: dm ? dm[1].trim() : null,
      },
    };
  }
  return null;
}

/**
 * Parse a SELECT clause (incl. GROUP BY/HAVING, one-key JOINs, multi-key
 * ORDER BY - issue #9). `fallbackTable` lets an INSERT..SELECT omit FROM:
 * its bare aggregates scope over the INSERT target's own rows (the seq
 * allocator pattern - SQLite does the same). A standalone FROM-less SELECT
 * (outside INSERT..SELECT) stays an unsupported gap.
 */
export function parseSelectClause(s, fallbackTable = null) {
  s = s.trim();

  // peel the top-level clauses from the REAR LIMIT-first (LIMIT, then
  // ORDER BY, then HAVING, then GROUP BY, then JOIN), so the base regex
  // stays v0.2-simple over the head
  let groupBy = null, having = null, orderBy = null, join = null;
  let limitRaw = null, offsetRaw = null;
  const limIdx = findTopWord(s, 'LIMIT');
  if (limIdx > -1) {
    const lim = s.slice(limIdx + 5).trim();
    s = s.slice(0, limIdx).trim();
    // Negative literals ride along (SQLite: LIMIT -1 = no limit, OFFSET n<0
    // = zero skip); the runtime clamps below give them those exact semantics.
    const m2 = lim.match(/^(\?|-?\d+)(?:\s+OFFSET\s+(\?|-?\d+))?$/i);
    if (!m2) {
      throw new D1Error(`crashtest-fake-d1: cannot parse literal "LIMIT ${lim.slice(0, 30)}" (wants LIMIT ?|n [OFFSET ?|m])`, { code: 'PARSE' });
    }
    limitRaw = m2[1];
    offsetRaw = m2[2] ?? null;
  }
  const obIdx = findTopWord(s, 'ORDER');
  if (obIdx > -1) {
    const after = s.slice(obIdx + 5);
    if (!/^\s+BY/i.test(after)) {
      throw new D1Error(`crashtest-fake-d1: cannot parse literal "${s.slice(0, 40)}" (bare ORDER, expected ORDER BY)`, { code: 'PARSE' });
    }
    orderBy = after.replace(/^\s+BY\s+/i, '').trim();
    s = s.slice(0, obIdx).trim();
  }
  const hIdx = findTopWord(s, 'HAVING');
  if (hIdx > -1) {
    having = s.slice(hIdx + 6).trim();
    s = s.slice(0, hIdx).trim();
  }
  const gbIdx = findTopWord(s, 'GROUP');
  if (gbIdx > -1) {
    const after = s.slice(gbIdx + 5);
    if (!/^\s+BY/i.test(after)) {
      throw new D1Error(`crashtest-fake-d1: cannot parse literal "${s.slice(0, 40)}" (bare GROUP, expected GROUP BY)`, { code: 'PARSE' });
    }
    const tail = after.replace(/^\s+BY\s+/i, '').trim();
    groupBy = splitProjection(tail);
    s = s.slice(0, gbIdx).trim();
  }
  if (having != null && !groupBy) {
    throw new D1Error(`crashtest-fake-d1: HAVING requires GROUP BY (bare-aggregate HAVING is a documented gap)`, { code: 'UNSUPPORTED' });
  }
  const jIdx = findTopWord(s, 'JOIN');    if (jIdx > -1) {
    const kindM = /\b(LEFT\s+(?:OUTER\s+)?|RIGHT\s+(?:OUTER\s+)?|INNER\s+|CROSS\s+)$/i.exec(s.slice(0, jIdx));
    const kind = kindM ? kindM[1].replace(/\s+/g, ' ').trim().toUpperCase() : 'INNER';
    if (kind.startsWith('RIGHT')) {
      throw unsupportedSubset(s, 'RIGHT JOIN is not modeled (rewrite as a LEFT JOIN with the tables swapped)');
    }
    const after = s.slice(jIdx + 4).trim();
    // a trailing WHERE belongs to the head, not the ON condition - peel it
    // back out before locating ON (an ON expression may legitimately START
    // with the word "where" in a string; findTopWord skips those).
    const wIdx = findTopWord(after, 'WHERE');
    const onText = wIdx > -1 ? after.slice(0, wIdx).trim() : after;
    const whereTail = wIdx > -1 ? after.slice(wIdx) : null;
    const headBase = s.slice(0, kindM ? kindM.index : jIdx).trim();
    const onIdx = findTopWord(onText, 'ON');
    if (onIdx === -1) {
      throw new D1Error(`crashtest-fake-d1: cannot parse literal "${s.slice(0, 40)}" (wants: [INNER|LEFT [OUTER]|CROSS] JOIN t2 ON <expr>)`, { code: 'PARSE' });
    }
    const t2 = onText.slice(0, onIdx).trim();
    if (!/^[\w.]+$/.test(t2)) {
      throw unsupportedSubset(s, 'JOIN target must be a bare table name');
    }
    join = { table: t2, kind, on: onText.slice(onIdx + 2).trim() };
    // re-attach the peeled WHERE (and strip the JOIN + kind word) into the head
    s = (whereTail ? `${headBase} ${whereTail.trim()}` : headBase).trim();
  }

  const m = s.match(/^SELECT\s+(DISTINCT\s+)?([\s\S]+?)(?:\s+FROM\s+([.\w]+))?(?:\s+WHERE\s+([\s\S]+))?$/i);
  if (!m) {
    throw unsupportedSubset(s, 'v0.3 subset: SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER - one JOIN, one subquery depth (no table aliases/multi-hops/subquery-FROM/compound SELECT)');
  }
  const [, distinctRaw, selector, table, where] = m;
  if (!table) {
    // A top-level FROM that did not parse into the FROM-group means trailing
    // grammar the subset does not accept (table aliases, subquery FROM, ...).
    if (findTopWord(s, 'FROM') > -1) {
      throw unsupportedSubset(s, 'table aliases / multi-table FROM / subquery-FROM stay unsupported (join with JOIN ... ON)');
    }
    // Real SQLite semantics (verified against node:sqlite): a FROM-less
    // SELECT with bare column refs errors `no such column: seq`. Pure
    // param/literal projections (`SELECT ?, ?` inside INSERT..SELECT) are
    // legal - exactly one row.
    const refWord = (() => {
      const toks = tokenize(selector.trim());
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.t !== 'word' || t.v.includes('.')) continue;
        if (i > 0) {
          const p = toks[i - 1];
          if (p.t === 'word' && p.v.toUpperCase() === 'AS') continue; // aliases are not refs
        }
        if (['NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'ASC', 'DESC', 'COALESCE', 'MAX', 'MIN', 'COUNT', 'SUM', 'AVG', 'UPPER', 'LOWER', 'LENGTH', 'TRIM', 'ABS', 'UNIXEPOCH', 'DATETIME', 'JULIANDAY', 'STRFTIME', 'JSON_EXTRACT', 'JSON_TYPE', 'JSON_QUOTE', 'SELECT', 'FROM', 'WHERE'].includes(t.v.toUpperCase())) continue;
        return t;
      }
      return null;
    })();
    if (refWord) {
      throw new D1Error(`crashtest-fake-d1: no such column: ${refWord.v} (FROM-less SELECT has no column scope; SQLite errors the same way)`, { code: 'NO_COLUMN' });
    }
  }
  const orderByList = orderBy
    ? splitProjection(orderBy).map(chunk => {
        const parts = chunk.trim().split(/\s+/);
        const src = (parts.length > 1 && ['ASC', 'DESC'].includes(String(parts[1]).toUpperCase()))
          ? parts[0]
          : chunk.trim();
        return { col: parts[0], dir: (parts[1] || 'ASC').toUpperCase(), src };
      })
    : null;
  return {
    verb: 'SELECT',
    distinct: !!distinctRaw,
    projection: selector.trim(),
    table: table ?? fallbackTable,
    fromLess: !table,
    join,
    groupBy,
    having,
    where: where ? where.trim() : 'ALL',
    orderBy: orderByList,
    limit: limitRaw != null && limitRaw !== '?' ? Number(limitRaw) : null,
    limitRaw: limitRaw ?? null,
    offset: offsetRaw != null && offsetRaw !== '?' ? Number(offsetRaw) : null,
    offsetRaw: offsetRaw ?? null,
  };
}

export function parseStatement(sql) {
  const s = sql.trim().replace(/;\s*$/, '');

  if (/^(CREATE|ALTER)\b/i.test(s)) {
    const ast = parseDdl(s);
    if (!ast) throw unsupportedSubset(s, 'DDL beyond CREATE TABLE [IF NOT EXISTS] t (cols) / ALTER TABLE t ADD COLUMN col TYPE [NOT NULL] [DEFAULT <expr>] is a documented gap');
    return ast;
  }
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

  throw unsupportedSubset(
    s,
    'v0.3 subset: SELECT/INSERT [OR IGNORE|REPLACE]/UPDATE/DELETE/CREATE/ALTER + RETURNING/ON CONFLICT/LIMIT ? - everything else (window-funcs, NOT, nested subqueries, triggers, DROP/RENAME, quoted identifiers) throws like this');
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
      case 'CREATE_TABLE': {
        const res = execCreate(this.db, ast);
        return { meta: res.meta };
      }
      case 'ALTER_TABLE': {
        const res = execAlter(this.db, ast);
        return { meta: res.meta };
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
