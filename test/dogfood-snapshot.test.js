// dogfoodSnapshot teeth - the dashboard's DEFAULT view is a GENERATED file
// rebuilt from the committed labs/ artifacts. The first cut had NO gate
// pinning it fresh: after a dogfood run changed labs/, a forgotten
// regeneration would let the site drift into rendering stale receipts as
// "the current baseline" (found walking the generator, round 22). These
// rows re-derive what the generator writes from the committed artifacts and
// pin the committed file to it - same-commit -> same-snapshot, and a
// version bump that forgets the regen fails here, not on the site.
//
// A test reading labs/ is safe: the artifacts are project-committed inputs,
// never outputs the test runner may mutate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dogfood } from '../web/src/lib/dogfoodSnapshot.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const labsLedger = JSON.parse(await readFile(join(REPO, 'labs', 'crashledger.json'), 'utf8'));
const hardening = await readFile(join(REPO, 'labs', 'hardening.md'), 'utf8');

test('committed dogfoodSnapshot is a faithful copy of the labs artifacts (staleness gate)', () => {
  assert.deepEqual(
    dogfood.ledger,
    labsLedger,
    'the snapshot ledger drifted from labs/crashledger.json - re-run node web/scripts/make-ledger-snapshot.mjs and commit',
  );
  const totals = hardening.match(/^- total: (\d+) backend ops across (\d+) in-process requests from (\d+) attacks/m);
  assert.ok(totals, 'labs/hardening.md lost its cost total line (the generator cannot parse this shape)');
  assert.deepEqual(
    dogfood.cost.totals,
    { ops: Number(totals[1]), requests: Number(totals[2]), distinctAttacks: Number(totals[3]) },
    'snapshot cost totals drifted from the hardening report - re-run the generator',
  );
  const perAttack = [...hardening.matchAll(/^  - ([a-z0-9-]+\/[a-z0-9-]+): (\d+) ops \/ (\d+) requests$/gm)];
  assert.ok(perAttack.length > 0, 'no per-attack cost lines parsed from labs/hardening.md');
  assert.equal(dogfood.cost.perAttack.length, perAttack.length, 'per-attack cost row count drifted - re-run the generator');
});

test('snapshot meta rides the report header (version + seed) like the generator derives it', () => {
  const head = hardening.match(/^> crashtest v(\S+) \/ seed (\d+)/m);
  assert.ok(head, 'labs/hardening.md header shape changed (cut-stamp refactor landed?)');
  assert.equal(dogfood.meta.version, head[1], 'snapshot version drifted from the report header - re-run the generator');
  assert.equal(Number(dogfood.meta.seed), Number(head[2]), 'snapshot seed drifted from the report header - re-run the generator');
  // startedAt is the ONE wall-clock field: it rides labs/run-meta.json, the
  // blessed moving sidecar - the artifacts never move, the stamp may.
  assert.equal(typeof dogfood.meta.startedAt, 'string');
});
