// Seed scenario library: 'proto-hygiene' - PRD section 6 expansion (shipped
// 2026-10-21): the cheap, low-false-positive guards extension. Where
// guards/ checks WHAT the response carries, proto-hygiene checks HOW the
// request's bare geometry is met. Two attacks, both sweep-based (no arming
// - they walk every declared route, narrowed by ctx.routes when a module
// needs one):
//
//   head-get-parity   : HEAD must be the cheap mirror of GET. The graded
//     rules are the class that breaks real surfaces: HEAD that THROWS, and
//     HEAD 5xx where GET answered 2xx, and GET-2xx routes whose HEAD answers
//     anything but 2xx or an honest 405. HEAD body bytes are an INFO note,
//     never a finding (in-process nothing strips them; the wire's runtime
//     usually does - grading that here would false-positive correct code).
//   request-shape-flood : the bare shapes attackers fire before payloads:
//     duplicate query keys, malformed separators, embedded control bytes,
//     dot-segment/double-slash path shapes, and identity headers spelled in
//     three casings. Every one must land 4xx-class-or-cleaner: no 5xx, no
//     uncaught throw, no response that CHANGES answer when only the spelling
//     changed. `?`-less handlers survive; handlers that dereference a param
//     the URL never carried do not - that is the class.
//
// Honest note on header case: the fake transport normalizes header names
// by construction (WHATWG Headers), so the case axis pins that invariant -
// differential control. The PRD lists it under this module for exactly that
// reason: cheap, low false-positive, and it keeps anyone from bypassing the
// normalization later.

import { refused, exploited } from '../contract.js';

const QUERY_SHAPES = [
  ['duplicate key (2x)', '?key=a&key=b'],
  ['duplicate key (6x)', '?key=a&key=a&key=a&key=a&key=a&key=a'],
  ['bare separators', '?&&&'],
  ['empty query', '?'],
  ['empty key', '?=value'],
  ['empty value', '?key='],
  ['spaces over-encoded', '?key=a%20b%20c'],
  ['null byte in value', '?key=a%00b'],
  ['dup + percent mix', '?key=%2e%2e%2f&key=a'],
];

const PATH_SHAPES = [
  ['dot-segment up', '/..'],
  ['dot-segment inner', '/a/../b'],
  ['double slash', '//a'],
  ['trailing dot', '/a/.'],
  ['percent-dot up', '/%2e%2e'],
  ['mixed dots', '/a%2Fb/../c'],
];

const HEADER_CASES = ['x-user-role', 'X-USER-ROLE', 'X-User-Role'];

export default {
  name: 'proto-hygiene',
  description: 'Bare request geometry: HEAD mirrors GET, and hostile-but-valid request shapes (query chaos, path shapes, header casings) never crash a handler',

  attacks: [{
    name: 'head-get-parity',
    description: 'HEAD must be the cheap mirror of GET: no throw, no 5xx where GET answered 2xx, and GET-2xx routes may answer HEAD only 2xx or an honest 405 - HEAD body bytes are an INFO note (wire runtimes strip them), never a finding',
    async run(harness, ctx = {}) {
      const scope = sweepRoutes(harness, ctx);
      if (!scope.length) {
        return refused('no routes declared on this target - proto-hygiene skipped', { skipped: true });
      }
      const faults = [];
      const notes = [];
      for (const route of scope) {
        const get = await harness.run(route, { method: 'GET' });
        if (get.threw) { notes.push(`${route}: GET throws (a badder probe owns that floor; skipped here)`); continue; }
        const head = await harness.run(route, { method: 'HEAD' });
        if (head.threw) { faults.push(`${route}: threw on HEAD while GET answered ${get.status}`); continue; }
        if (get.status < 400 && head.status >= 400 && head.status !== 405) {
          faults.push(`${route}: GET ${get.status} but HEAD ${head.status} - only 405 is an honest unhandled-HEAD answer (covers 5xx drift)`);
          continue;
        }
        const headBody = await head.response.text();
        if (headBody.length > 0) {
          notes.push(`${route}: HEAD carries ${headBody.length} body byte(s) (info: wire runtimes usually strip; raw transports would leak)`);
        }
      }
      if (faults.length) {
        return exploited(`HEAD fails to mirror GET on ${faults.length}/${scope.length} sweep route(s) - first: ${faults[0]}`, { faults });
      }
      return refused(
        `${scope.length} route(s): HEAD mirrors GET (no throws, no status drift beyond honest 405)${notes.length ? ` + ${notes.length} info note(s)` : ''}`,
        { notes: notes.slice(0, 6) },
      );
    },
  }, {
    name: 'request-shape-flood',
    description: 'The bare shapes attackers fire before payloads - duplicate query keys, malformed separators, embedded control bytes, dot-segment/path shapes, and identity headers in three casings - must never crash a handler or change its answer by spelling alone',
    async run(harness, ctx = {}) {
      const scope = sweepRoutes(harness, ctx);
      if (!scope.length) {
        return refused('no routes declared on this target - proto-hygiene skipped', { skipped: true });
      }
      const faults = [];
      let probes = 0;
      for (const route of scope) {
        for (const [qsLabel, qs] of QUERY_SHAPES) {
          probes++;
          const rec = await harness.run(route, { method: 'GET', url: `/${route}${qs}` });
          if (rec.threw) { faults.push(`${route} ${qsLabel}: threw - ${String(rec.error).slice(0, 70)}`); continue; }
          if (rec.status >= 500) faults.push(`${route} ${qsLabel}: ${rec.status}`);
        }
        for (const [pathLabel, shape] of PATH_SHAPES) {
          probes++;
          const rec = await harness.run(route, { method: 'GET', url: `/${route}${shape}` });
          if (rec.threw) { faults.push(`${route} ${pathLabel}: threw - ${String(rec.error).slice(0, 70)}`); continue; }
          if (rec.status >= 500) faults.push(`${route} ${pathLabel}: ${rec.status}`);
        }
        // Case-parity axis: same semantic claim, three spellings - the
        // answers must agree. In-process the transport normalizes names;
        // this keeps that invariant pinned (differential control).
        const casings = [];
        let caseFaults = false;
        for (const spelling of HEADER_CASES) {
          const rec = await harness.run(route, { method: 'GET', headers: { [spelling]: 'admin' } });
          if (rec.threw) { caseFaults = true; casings.push('threw'); break; }
          casings.push(rec.status);
        }
        probes += HEADER_CASES.length;
        const unique = [...new Set(casings.filter(c => c !== 'threw'))];
        if (caseFaults || unique.length > 1 || casings.includes('threw')) {
          faults.push(`${route}: header-case parity broke (${casings.join(' / ')})`);
        }
      }
      if (faults.length) {
        return exploited(`request-shape flood broke ${faults.length} probe(s) across ${scope.length} route(s) - first: ${faults[0]}`, { faults });
      }
      return refused(
        `${scope.length} route(s) x ${probes / scope.length} bare shapes (query chaos, path shapes, header casings) all landed 4xx-or-cleaner with case-parity intact`,
        { probes, scope: scope.length },
      );
    },
  }],
};

/** Sweep scope: ctx.routes (array) narrows; default = every declared route. */
function sweepRoutes(harness, ctx = {}) {
  const declared = harness.listRoutes();
  if (!Array.isArray(ctx.routes) || !ctx.routes.length) return declared;
  return ctx.routes.filter(r => declared.includes(r));
}
