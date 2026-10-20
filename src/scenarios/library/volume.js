// Seed scenario library: 'volume' — PRD §1.3 barrage: bursts, identity
// rotation, storage fill, amplification. EVERY attack reports **cost
// accounting**: backend ops per admitted vs refused request (PRD §7 economics).
// Verdicts: EXPLOITED only when the handler BREAKS (uncaught/5xx) or an
// amplification bound is violated; walls that hold are REFUSED — volume with
// numbers, never with vibes.
//
// Config ctx for this library (defaults work against lab fixtures):
//   { route, rounds, maxOpsPerRequest, uniqueKeys } — see each attack.

import { refused, exploited } from '../contract.js';

async function postBody(harness, route, body, headers = {}) {
  return harness.run(route, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export default {
  name: 'volume',
  description: 'Volume campaigns with cost accounting: stuffing, storage fill, amplification',

  attacks: [{
    name: 'credential-stuffing',
    description: 'Rotate identity keys/caps across N attempts; measure ops per admitted + refused request',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      const rounds = ctx.rounds ?? 60;
      let admitted = 0, refusedN = 0, broke = 0, firstBreak = null;
      const before = harness.costTotals();

      for (let i = 0; i < rounds; i++) {
        const body = JSON.stringify({ key: ctx.uniqueKeys ? `stuff-${i}` : 'same-key', owner: 'stuffing' });
        const record = await postBody(harness, route, body);
        if (record.threw) {
          broke++;
          firstBreak = firstBreak ?? `${record.error?.name}: ${record.error?.message}`;
          continue;
        }
        if (record.status >= 500) { broke++; firstBreak = firstBreak ?? `${record.status}`; continue; }
        if (record.status < 400) admitted++; else refusedN++;
      }
      const cost = harness.costTotals();
      const opsDelta = cost.__cost__ - before.__cost__;
      const admittedOps = admitted > 0 ? +(opsDelta / rounds).toFixed(2) : opsDelta;

      if (broke > 0) {
        return exploited(`stuffing broke "${route}" ${broke}/${rounds}× — ${firstBreak}`,
          { route, rounds, admitted, refused: refusedN, costPerRequest: admittedOps, breaks: broke });
      }
      return refused(
        `${route} held ${rounds} stuffing attempts (${admitted} admitted, ${refusedN} refused) · ${opsDelta} ops total · ~${admittedOps} ops/request`,
        { route, rounds, admitted, refused: refusedN, costPerRequest: admittedOps },
      );
    },
  }, {
    name: 'storage-fill',
    description: 'N large unique KV writes through the route; watch op cost AND storage growth per round',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'kvwrite';
      if (!harness.listRoutes().includes(route)) {
        return refused(`route "${route}" not declared on this target — fill check skipped (declare a KV-writing route)`, { route, skipped: true });
      }
      const rounds = ctx.rounds ?? 30;
      const payloadSize = ctx.payloadSize ?? 8 * 1024;
      let broke = 0, firstBreak = null, admitted = 0, refusedN = 0;
      const growth = [];
      const before = harness.costTotals();

      for (let i = 0; i < rounds; i++) {
        const body = JSON.stringify({ key: `fill-${i}`, owner: 'filler', blob: 'F'.repeat(payloadSize) });
        const record = await postBody(harness, route, body);
        if (record.threw) { broke++; firstBreak = firstBreak ?? `${record.error?.name}: ${record.error?.message}`; continue; }
        if (record.status >= 500) { broke++; firstBreak = firstBreak ?? `${record.status}`; continue; }
        record.status < 400 ? admitted++ : refusedN++;
        const kvList = await harness.env.DEVICE_CACHE?.list?.({}) ?? null;
        if (kvList) growth.push(kvList.keys.length);
      }
      const cost = harness.costTotals();
      const opsDelta = cost.__cost__ - before.__cost__;

      if (broke > 0) {
        return exploited(`storage fill broke "${route}" ${broke}/${rounds}× — ${firstBreak}`,
          { route, rounds, admitted, growth: growth.slice(-3), opsDelta });
      }
      // Storage keeps growing without any cap signal? Numbers, not a verdict.
      const last = growth.at(-1);
      return refused(
        `fill held on "${route}" (${admitted} admitted) · ${opsDelta} ops total · storage ${last} keys after ${rounds} rounds`,
        { route, rounds, admitted, growth: growth.slice(-3), opsDelta },
      );
    },
  }, {
    name: 'cost-amplification',
    description: 'Identical request, N times: per-request backend ops must stay under the bound',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'enroll';
      const rounds = ctx.rounds ?? 40;
      const maxOpsPerRequest = ctx.maxOpsPerRequest ?? 12;
      const body = ctx.body !== undefined
        ? JSON.stringify(ctx.body)
        : JSON.stringify({ key: 'amp-probe', owner: 'amplifier' });
      const before = harness.costTotals();
      const cumulative = [];

      for (let i = 0; i < rounds; i++) {
        const record = await postBody(harness, route, body);
        if (record.threw) {
          return exploited(`amplification probe broke "${route}" on replay #${i} — ${record.error?.name}: ${record.error?.message}`, { route, i });
        }
        cumulative.push(harness.costTotals().__cost__ - before.__cost__);
      }
      const totalOps = cumulative.at(-1) ?? 0;
      const deltas = [cumulative[0] ?? 0, ...cumulative.slice(1).map((v, i) => v - cumulative[i])];
      const stable = new Set(deltas.map(d => +d.toFixed(2))).size === 1; // identical request → identical op shape
      const opsPerRequest = +(totalOps / rounds).toFixed(2);
      if (opsPerRequest > maxOpsPerRequest) {
        return exploited(
          `"${route}" burns ${opsPerRequest} ops/request sustained across ${rounds} identical replays (bound ${maxOpsPerRequest}) — amplification`,
          { route, opsPerRequest, bound: maxOpsPerRequest, rounds, totalOps },
        );
      }
      return refused(
        `"${route}" held the amplification bound: ${opsPerRequest} ops/request over ${rounds} identical replays (bound ${maxOpsPerRequest})`,
        { route, opsPerRequest, bound: maxOpsPerRequest, rounds, totalOps },
      );
    },
  }],
};
