// The shared refusal battery, in-repo (dhaupin/packstruct#3 / crashtest#25).
// Three pins, each with a different kind of teeth:
//   1. BYTE-DRIFT - the generated crashtest column must stay equal to the
//      observed loader behavior over the transcribed battery bytes.
//   2. DOCUMENTED DIFFERENCES - the six host-legitimacy rows (crashtest#25)
//      stay exactly as documented; a silent drift to agreement or to a new
//      disagreement is a FINDING, never ambient noise.
//   3. CROSS-COLUMN PARITY - on every row that is NOT a documented
//      difference, our verdict must still agree with packstruct's committed
//      golden column. If it stops agreeing, the two validators diverged and
//      someone must re-derive deliberately.
//
// Zero sockets: the battery bytes are transcription-committed under
// labs/refusal-battery/packstruct@fdf1be5/ (see that folder's README;
// re-ingest = re-copy from a pinned checkout + regenerate, same commit).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const CORPUS = 'labs/refusal-battery/packstruct@fdf1be5';

const readJson = async (p) => JSON.parse(await readFile(join(REPO, p), 'utf8'));

test('battery: the generated crashtest column equals the observed loader behavior (byte-drift gate)', () => {
  const out = execFileSync('node', ['scripts/gen-refusal-battery.cjs', CORPUS], {
    cwd: REPO, encoding: 'utf8',
  });
  assert.match(out, /verified against observed bytes/, `battery: the column did not verify - the run said:\n${out}`);
});

const DOCUMENTED = {
  'version-major-only': false,
  'description-empty': false,
  'armedByKey-empty': false,
  'name-dir-mismatch': false,
  'manifest-missing': false,
  'missing-public-dir': false,
};
// Not a host difference - an UPSTREAM anomaly (packstruct's generator bug,
// recorded on #25): their battery bytes still carry "schemaVersion": 1 while
// their committed column claims refused [schemaVersion]. Their own linter
// accepts those bytes too. Skipped from general parity; its facts are pinned
// in their own test below so the day their fix lands, this file is the
// first thing that changes.
const UPSTREAM_ANOMALY = 'schemaVersion-missing';

test('battery: the six documented host differences still hold exactly as argued on #25', async () => {
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const byId = new Map(column.rows.map((r) => [r.id, r]));
  for (const [id, refused] of Object.entries(DOCUMENTED)) {
    const row = byId.get(id);
    assert.ok(row, `battery: documented row "${id}" vanished from the column`);
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

test('battery: the upstream anomaly (schemaVersion-missing) stays exactly as recorded on #25', async () => {
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const row = column.rows.find((r) => r.id === UPSTREAM_ANOMALY);
  assert.ok(row, 'battery: anomaly row vanished from our column');
  // our loader keeps accepting the bytes (the key is present and valid)
  assert.equal(row.host.refused, false, 'battery: our loader now REFUSES schemaVersion-missing bytes - if our engine moved, re-derive this row and expect their column flip too');
  // the transcribed battery bytes still carry the key the id promises is missing
  const bat = await readJson(join(CORPUS, UPSTREAM_ANOMALY + '.json'));
  assert.ok(
    bat.manifest && typeof bat.manifest === 'object' && 'schemaVersion' in bat.manifest,
    'battery: schemaVersion-missing.json no longer carries the key (packstruct fixed their generator) - re-ingest + re-derive: their column row should read honest and parity restores; move this anomaly pin in the SAME commit as the re-ingest',
  );
  // their committed column still claims a refusal their own linter does not deliver
  const theirs = await readJson(join(CORPUS, 'packstruct-column.json'));
  const their = theirs.rows.find((r) => r.id === UPSTREAM_ANOMALY);
  assert.equal(their?.packstruct?.refused, true, 'battery: packstruct fixed their column row for schemaVersion-missing - re-ingest the corpus and re-derive the parity row in the SAME review');
});

test('battery: every non-documented row still agrees with packstruct\'s committed golden column', async () => {
  const column = await readJson('labs/refusal-matrix-crashtest.json');
  const theirs = await readJson(join(CORPUS, 'packstruct-column.json'));
  const theirsById = new Map(theirs.rows.map((r) => [r.id, r]));
  for (const row of column.rows) {
    if (row.documentedDifference) continue; // asserted + argued separately
    if (row.id === UPSTREAM_ANOMALY) continue; // pinned in the anomaly test below
    const their = theirsById.get(row.id);
    assert.ok(their, `battery: packstruct column lost row "${row.id}" (re-ingest the corpus)`);
    assert.equal(
      row.host.refused,
      their.packstruct.refused,
      `battery: cross-column parity broke on "${row.id}" (crashtest ${row.host.refused ? 'REFUSED' : 'accepted'} vs packstruct ${their.packstruct.refused ? 'refused' : 'accepted'}) - the two validators agreed elsewhere and here they must too; treat the break as a linter/loader parity FINDING (one truth per concern), never bend the fixture to silence it. Known upstream anomaly: their committed column claims refused on "schemaVersion-missing" while their battery bytes still carry the key (re-observed on #25) - this test transcribes their claim faithfully; their generator fix is theirs to land`,
    );
  }
});
