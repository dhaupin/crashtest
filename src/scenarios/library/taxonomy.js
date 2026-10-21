// Seed scenario library: 'taxonomy' - honest-refusal semantics (PRD section 6
// expansion, 2026-10-21). The response-SHAPE dimension the other libraries
// leave to chance. `input/never-fail-mutations` proves handlers never break on
// mutated VALID-shape objects; this module proves the sad path is honest:
//
//   abuse-not-5xx          : abuse-shaped traffic (garbage bodies, truncated
//     JSON, wrong/absent content types, oversized strings) may be DENIED
//     (4xx class) but must never come back 5xx or as an uncaught throw.
//     Same fuzzFloorViolation oracle the input module uses - on a distinct
//     payload family (raw garbage shapes, not mutated objects).
//   errors-stay-impersonal : every error body must stay boring - no echo of
//     attacker-planted canaries (the handler parroting request data back),
//     no stack-frame patterns (V8 frames, node:internal, file:line:col).
//     The sad-path response is infrastructure, not an inspector.
//
// Zero app-specific fixtures: works against ANY declared route. The probe
// route defaults to 'enroll' (the common agent-app write route); undeclared
// routes degrade to skipped-REFUSED - declare it for coverage, never guesses.

import { fuzzFloorViolation, refused, exploited } from '../contract.js';

const CRASHTEST_CANARY = 'crashtestCanary7d3f';
const BODY_SCAN_LIMIT = 500;

// The fingerprint families: deterministic abuse shapes (attacker-controlled
// canaries deliberately planted so echo-leaks surface in the detector).
const ABUSE_SHAPES = [
  { label: 'truncated-object',   ct: 'application/json', body: '{"key": ' },
  { label: 'truncated-array',    ct: 'application/json', body: '[' },
  { label: 'not-json',           ct: 'application/json', body: `nope: ${CRASHTEST_CANARY}` },
  { label: 'bom-leading',        ct: 'application/json', body: '\uFEFF{}' },
  { label: 'empty-body',         ct: 'application/json', body: '' },
  { label: 'wrong-content-type', ct: 'text/plain',       body: '{"key": "x", "owner": "o"}' },
  { label: 'no-content-type',    ct: undefined,          body: `{"key": "${CRASHTEST_CANARY}"}` },
  { label: 'canary-echo-bait',   ct: 'application/json', body: `{"key": "${CRASHTEST_CANARY}"}` },
  { label: 'huge-string',        ct: 'application/json', body: `{"key": "${'D'.repeat(8192)}"}` },
  { label: 'canary-field-name',  ct: 'application/json', body: `{"${CRASHTEST_CANARY}": 1}` },
];

async function fireAbuse(harness, route, shapes) {
  const records = [];
  for (const shape of shapes) {
    const headers = shape.ct ? { 'content-type': shape.ct } : {};
    const record = await harness.run(route, { method: 'POST', body: shape.body, headers });
    records.push({ shape, record });
  }
  return records;
}

/** Scan a sad-path response for impersonal-evidence leaks. Returns the first leak reason or null. */
function impersonalLeak(text) {
  if (!text) return null;
  if (text.includes(CRASHTEST_CANARY)) return 'canary echo (handler parroting attacker-controlled data)';
  if (/node:internal/.test(text)) return 'node:internal frame leaked';
  if (/\.js:\d+:\d+/.test(text)) return 'file:line:col reference leaked';
  if (/\bat\s+[^\s(]+\(/.test(text)) return 'stack frame ("at fn(...)" line) leaked';
  return null;
}

export default {
  name: 'taxonomy',
  description: 'Honest-refusal semantics: abuse never 5xx, error bodies stay impersonal',

  attacks: [{
    name: 'abuse-not-5xx',
    description: 'Abuse-shaped traffic must be denied honestly (4xx class) - never 5xx, never an uncaught throw',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - taxonomy skipped (declare it for coverage)`, { route, skipped: true });
      }
      const records = await fireAbuse(harness, route, ABUSE_SHAPES);
      const escalations = records
        .map(({ shape, record }) => ({ shape: shape.label, violation: fuzzFloorViolation(record) }))
        .filter(r => r.violation);

      if (escalations.length) {
        const first = escalations[0];
        return exploited(
          `${escalations.length}/${ABUSE_SHAPES.length} abuse shapes escalated on "${route}" - first: ${first.shape} (${first.violation})`,
          { route, escalations: escalations.slice(0, 5) },
        );
      }
      const statuses = [...new Set(records.map(r => r.record.status ?? 'threw'))].join('/');
      return refused(
        `${ABUSE_SHAPES.length} abuse shapes answered honestly on "${route}" (statuses: ${statuses})`,
        { route },
      );
    },
  }, {
    name: 'errors-stay-impersonal',
    description: 'Error-path bodies must stay boring - no attacker-canary echo, no stack frames',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target - taxonomy skipped (declare it for coverage)`, { route, skipped: true });
      }
      const records = await fireAbuse(harness, route, ABUSE_SHAPES);
      const leaks = [];

      for (const { shape, record } of records) {
        const status = record.status ?? 'threw';
        if (status === 'threw' || status < 400) continue; // impersonal scan is about the sad path
        let text = '';
        try {
          text = (await record.response?.text())?.slice(0, BODY_SCAN_LIMIT) ?? '';
        } catch { text = ''; }
        // Uncaught handler errors surface as transport throws - their message
        // is part of the sad path too and may carry the same leaks.
        const leak = impersonalLeak(text)
          ?? impersonalLeak(record.error?.message?.slice(0, BODY_SCAN_LIMIT));
        if (leak) leaks.push({ shape: shape.label, status, leak });
      }

      if (leaks.length) {
        const first = leaks[0];
        return exploited(
          `${leaks.length}/${ABUSE_SHAPES.length} error paths leak on "${route}" - first: ${first.shape} (${first.leak})`,
          { route, leaks: leaks.slice(0, 5) },
        );
      }
      return refused(
        `${ABUSE_SHAPES.length} abuse shapes answered impersonally on "${route}" - no canary echo, no stack frames`,
        { route },
      );
    },
  }],
};
