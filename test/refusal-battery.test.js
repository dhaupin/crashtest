// The shared refusal battery, in-repo (dhaupin/packstruct#3 / crashtest#25 /
// crashtest#27). Three pins, each with a different kind of teeth:
//   1. BYTE-DRIFT - the generated crashtest column must stay equal to the
//      observed loader behavior over the transcribed battery bytes.
//   2. DOCUMENTED DIFFERENCES - the host-legitimacy rows (crashtest#25/#27)
//      stay exactly as documented; a silent drift to agreement or to a new
//      disagreement is a FINDING, never ambient noise.
//   3. CROSS-COLUMN PARITY - on every row that is NOT a documented
//      difference, our verdict must still agree with packstruct's committed
//      golden set. If it stops agreeing, the two validators diverged and
//      someone must re-derive deliberately.
//
// Zero sockets: the battery bytes are transcription-committed under
// labs/refusal-battery/packstruct@3c84ace/ (see that folder's README;
// re-ingest = re-copy from a pinned checkout + regenerate, same commit).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const CORPUS = 'labs/refusal-battery/packstruct@3c84ace';

const readJson = async (p) => JSON.parse(await readFile(join(REPO, p), 'utf8'));

test('battery: the generated crashtest column equals the observed loader behavior (byte-drift gate)', () => {
  const out = execFileSync('node', ['scripts/gen-refusal-battery.cjs', CORPUS], {
    cwd: REPO, encoding: 'utf8',
  });
  assert.match(out, /verified against observed bytes/, `battery: the column did not verify - the run said:\n${out}`);
});

const DOCUMENTED = {
  'version-major-only': false,    // packs/loader.js does not gate on `version`
  'description-empty': false,     // presence + string type; empties pass
  'armedByKey-empty': false,      // presence semantics only; arming is host-ceremony
  'armedByKey-non-string': false, // same host-owned class: no type gate on armedByKey
  'name-dir-mismatch': false,     // `seen` is keyed by name; dir-match is data-level
  'manifest-missing': false,      // loose WIP dirs skip quietly (the local/ contract)
  'missing-public-dir': false,    // visibility dirs are optional roots
};

test('battery: the documented host differences still hold exactly as argued on #25', async () => {
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const byId = new Map(column.rows.map((r) => [r.id, r]));
  for (const [id, refused] of Object.entries(DOCUMENTED)) {
    const row = byId.get(id);
    assert.ok(row, `battery: documented row "${id}" vanished from the column (corpus re-ingested? re-run the generator)`);
    assert.equal(
      row.host.refused,
      refused,
      `battery: documented difference "${id}" changed (was: ${refused ? 'REFUSED' : 'accepted'} per crashtest#25) - either the engine rule moved (re-argue the row on the issue, cite the new loader text) or the battery re-ingest needs the SAME-review re-derivation`,
    );
    assert.equal(row.documentedDifference, true, `battery: "${id}" lost its documentedDifference flag`);
  }
  const flagged = column.rows.filter((r) => r.documentedDifference).map((r) => r.id).sort();
  assert.deepEqual(
    flagged,
    Object.keys(DOCUMENTED).sort(),
    'battery: the documented-difference set drifted without a deliberate re-derivation (a new disagreement is a finding - argue it, then move this table in the SAME commit)',
  );
});

test('battery: the packstruct generator fix is LANDED, and our re-observation matches the branch it predicted (crashtest#27 item 1)', async () => {
  // The fix (packstruct 5a56281): the emitter drops the schemaVersion key
  // exactly once - the battery bytes for schemaVersion-missing now truly
  // OMIT the key. crashtest#27 asked us to re-observe and paste the cell:
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const row = column.rows.find((r) => r.id === 'schemaVersion-missing');
  assert.ok(row, 'battery: schemaVersion-missing vanished from our column');
  assert.deepEqual(
    [row.host.refused, row.host.norms],
    [true, ['schemaVersion']],
    'battery: the key-absent manifest should REFUSE [schemaVersion] (loader.js REQUIRED_KEYS); if this is now accepted, the SPEC question reopens LOUDLY on #27/#25 - do not silent it',
  );
  // the battery bytes on record really omit the key
  const bat = await readJson(join(CORPUS, 'schemaVersion-missing.json'));
  assert.ok(
    bat.manifest && typeof bat.manifest === 'object' && !('schemaVersion' in bat.manifest),
    'battery: the battery bytes carry schemaVersion again - either a rollback re-ingest or a generator regression; re-derive the whole row in the SAME review',
  );
  // and the golden set marks this row as the post-fix re-verification
  const golden = await readJson(join(CORPUS, 'packstruct-golden.json'));
  const their = golden.rows.find((r) => r.id === 'schemaVersion-missing');
  assert.equal(
    their.packstruct.refused,
    true,
    'battery: packstruct stopped refusing key-absent manifests on their side - the columns flipped the OTHER way; re-derive both sides per crashtest#27',
  );
});

test('battery: every non-documented row still agrees with packstruct\'s committed golden set', async () => {
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const golden = await readJson(join(CORPUS, 'packstruct-golden.json'));
  const theirsById = new Map(golden.rows.map((r) => [r.id, r]));
  for (const row of column.rows) {
    if (row.documentedDifference) continue; // asserted + argued separately
    const their = theirsById.get(row.id);
    assert.ok(their, `battery: packstruct golden lost row "${row.id}" (re-ingest the corpus)`);
    assert.equal(
      row.host.refused,
      their.packstruct.refused,
      `battery: cross-column parity broke on "${row.id}" (crashtest ${row.host.refused ? 'REFUSED' : 'accepted'} vs packstruct ${their.packstruct.refused ? 'refused' : 'accepted'}) - the two validators agreed elsewhere and here they must too; treat the break as a linter/loader parity FINDING (one truth per concern), never bend the fixture to silence it`,
    );
  }
});
