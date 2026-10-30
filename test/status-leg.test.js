import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The family status dialect battery (family-status@1, crashtest#47):
// the emitter's behavior is pinned with temp-dir fixtures, and the REAL
// tree's emitted counts are re-derived against the live ledgers - the same
// way every other count in this repo sits under CI. Behavior-only, temp
// dirs, no network - the same law every test here runs.
//
// The dialect is adapted from eyestruct's tests/status.test.js (worked
// example, dhaupin/eyestruct); the membership is crashtest's: ONE leg
// (labs/crashledger.json - the dogfood opts out of packs) and pack cases
// derived from each pack bank (the battery cross-checks that derivation
// against `crashtest packs --json`, the CLI's own inventory, so the two
// sources can never disagree silently).

const ROOT = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { build } = await import(path.join(ROOT, 'web', 'scripts', 'build-status.mjs'));

function fixtureRepo({ findings, packs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crashtest-status-'));
  fs.mkdirSync(path.join(root, 'labs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'labs', 'crashledger.json'),
    JSON.stringify({ schemaVersion: 1, findings }),
  );
  // `type: module` so bank .js files import as ESM inside the temp root.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const packsDir = path.join(root, 'packs', 'public');
  for (const p of packs) {
    fs.mkdirSync(path.join(packsDir, p.dir), { recursive: true });
    fs.writeFileSync(path.join(packsDir, p.dir, 'pack.json'), JSON.stringify(p.manifest));
    const bank = path.join(packsDir, p.dir, p.manifest.entry || 'index.js');
    fs.writeFileSync(bank, p.bank || '');
  }
  return root;
}

const PASS_ROW = { id: 'auth/case-a', verdict: 'REFUSED', detail: 'held' };
const ATTACKS_N = (n) => Array.from({ length: n }, (_, i) => ({ name: `a-${i}`, run: async () => PASS_ROW }));

test('status: the dialect fields and leg rows derive from the committed ledgers', async () => {
  const root = fixtureRepo({
    findings: [PASS_ROW, { id: 'auth/z/case-b', verdict: 'PASSED', detail: 'safe path held' }],
    packs: [
      {
        dir: 'eye-x',
        manifest: { name: 'eye-x', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
        bank: 'export default { name: "eye-x", attacks: ' + JSON.stringify(ATTACKS_N(2)) + ' }',
      },
    ],
  });
  const s = await build(root);
  assert.equal(s.schema, 1);
  assert.equal(s.contract, 'family-status@1');
  const leg = s.legs.find((l) => l.leg === 'crashtest');
  assert.deepEqual(leg, {
    leg: 'crashtest',
    verdict: 'PASS',
    cases: 2,
    counts: { REFUSED: 1, PASSED: 1 },
    ledger: 'labs/crashledger.json',
  });
  assert.deepEqual(s.packs, [
    { name: 'eye-x', spec: 'packstruct@1', manifest: 'packs/public/eye-x/pack.json', cases: 2 },
  ]);
});

test('status: any verdict outside the pass set degrades the leg to RED (never a fake PASS)', async () => {
  const root = fixtureRepo({
    findings: [PASS_ROW, { id: 'x', verdict: 'EXPLOITED', detail: 'the safe path got struck' }],
    packs: [
      {
        dir: 'p1',
        manifest: { name: 'p1', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
        bank: 'export default { name: "p1", attacks: ' + JSON.stringify(ATTACKS_N(1)) + ' }',
      },
    ],
  });
  const s = await build(root);
  assert.equal(s.legs[0].verdict, 'RED');
  // An unknown verdict is the same refusal - the dialect degrades, not guesses.
  const root2 = fixtureRepo({
    findings: [{ id: 'x', verdict: 'MEANWHILE', detail: 'a verdict the family never met' }],
    packs: [
      {
        dir: 'p1',
        manifest: { name: 'p1', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
        bank: 'export default { name: "p1", attacks: ' + JSON.stringify(ATTACKS_N(1)) + ' }',
      },
    ],
  });
  assert.equal((await build(root2)).legs[0].verdict, 'RED');
});

test('status: the emitter refuses the intersection cases loudly', async () => {
  // A bank declaring zero attacks is a pack the campaign never fires.
  await assert.rejects(
    () =>
      build(
        fixtureRepo({
          findings: [],
          packs: [
            {
              dir: 'empty',
              manifest: { name: 'empty', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
              bank: 'export default { name: "empty", attacks: [] }',
            },
          ],
        }),
      ),
    /zero attacks/,
  );
  // An unimportable bank (syntax error) is named, never swallowed.
  await assert.rejects(
    () =>
      build(
        fixtureRepo({
          findings: [],
          packs: [
            {
              dir: 'broken',
              manifest: { name: 'broken', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
              bank: 'export default { this is not js',
            },
          ],
        }),
      ),
    /unimportable/,
  );
  // A pack.json name that does not match its directory - the loader's own
  // footgun rule, refused upstream of any run.
  await assert.rejects(
    () =>
      build(
        fixtureRepo({
          findings: [],
          packs: [
            {
              dir: 'renamed',
              manifest: { name: 'other', schemaVersion: 1, version: '1.0.0', description: 'd', entry: 'index.js' },
              bank: 'export default { name: "other", attacks: ' + JSON.stringify(ATTACKS_N(1)) + ' }',
            },
          ],
        }),
      ),
    /does not match its directory/,
  );
});

test('status: the REAL tree serves counts that agree with the LIVE committed ledgers', async () => {
  const s = await build();
  const findings = JSON.parse(fs.readFileSync(path.join(ROOT, 'labs', 'crashledger.json'), 'utf8'));
  const leg = s.legs.find((l) => l.leg === 'crashtest');
  assert.equal(leg.cases, findings.findings.length);
  assert.equal(leg.verdict, 'PASS'); // the committed baseline is all-REFUSED (no exploited rows may ever be committed)

  // The pack rows must agree with the CLI's machine inventory - the same
  // pairing docs/reference/packs.md documents for operators. Two derivations,
  // one truth, otherwise the battery names it.
  const bin = path.join(ROOT, 'bin', 'crashtest.js');
  const { execFileSync } = await import('node:child_process');
  const last = execFileSync(process.execPath, [bin, 'packs', '--json'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .pop();
  const inventory = JSON.parse(last);
  const invByName = Object.fromEntries(inventory.packs.map((p) => [p.name, p.attacks]));
  const rowsByName = Object.fromEntries(s.packs.map((p) => [p.name, p.cases]));
  assert.deepEqual(rowsByName, invByName);
  for (const pack of s.packs) {
    assert.ok(
      fs.existsSync(path.join(ROOT, pack.manifest)),
      `pack row points at a manifest that does not exist on disk (${pack.manifest})`,
    );
  }
});

// The served docs URL must equal the docs page's own permalink (crashtest#56).
// The trailing-slash form 404s on this host, so the emitter's URL is pinned
// to the source of truth - the page frontmatter - and cannot silently regress.
test('status: the served docs URL matches the docs page permalink', async () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'reference', 'status.md'), 'utf8');
  const m = md.match(/^permalink:\s*(\S+)\s*$/m);
  assert.ok(m, 'docs/reference/status.md carries a permalink frontmatter line');
  const s = await build();
  const expected = `https://docs.creadev.org/crashtest/${m[1]}`;
  assert.equal(s.docs, expected, `served docs URL must equal base + permalink (${expected})`);
  assert.ok(!s.docs.endsWith('/'), 'the docs URL must not carry a trailing slash (it 404s on this host)');
});
