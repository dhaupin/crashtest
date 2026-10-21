// wp-roles armed exercise - the PRD's gap list for the WP lane asked for
// three things: (1) a worker fixture carrying a role/callback registration
// layer, (2) the pack with role-callback bypass shapes, (3) an armed
// exercise end to end. The stub WordPress core (fixtures/wordpress/
// stub-wp/wp-load.php) closes 1 and 3 for every checkout: the REAL WP e2e
// stays where it always lived (target run roots); THIS test proves the
// wire, the capability gate, the seeding vocabulary and the pack verdicts
// against the stub. Skips loudly when PHP is absent (never a fake pass).
// Bonused with the stock smoke pack armed the same way - the stub walks
// enough of the WP surface for the whole smoke lane to grade honestly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, LEDGER_PATH } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB_ROOT = join(REPO, 'fixtures', 'wordpress', 'stub-wp');

function phpAvailable() {
  try {
    execFileSync('php', ['-v'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const php = phpAvailable();

test('wp-roles armed e2e: pack REFUSED exit 0 against the stub WP root', { skip: php ? false : 'PHP not available in this environment' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crashtest-wproles-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const adapterRoot = JSON.stringify(join(REPO, 'fixtures', 'wordpress', 'stub-wp'));
    const packsRoot = JSON.stringify(join(REPO, 'packs'));
    writeFileSync('crashtest.config.js', [
      `import { registerWordPress } from ${JSON.stringify(join(REPO, 'src/adapters/wordpress.js'))};`,
      'export default {',
      `  adapters: { wordpress: { wpRoot: ${adapterRoot}, phpBin: 'php', callAllow: { wp_create_nonce: 1, ct_create_user: 2, ct_reset_users: 0 }, allowOptions: ['blogname'] } },`,
      `  packs: [${packsRoot}],`,
      "  modules: ['wp-roles'],",
      '  seed: 0xC0FFEE,',
      '};',
      '',
    ].join('\n'));
    await main(['run']);
    assert.equal(process.exitCode, 0, 'the armed wp-roles exercise must hold at exit 0');
    const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    const rows = ledger.findings.filter((f) => f.id.startsWith('wp-roles/'));
    assert.equal(rows.length, 3, 'all three wp-roles attacks ran');
    assert.ok(rows.every((f) => f.verdict === 'REFUSED'), 'every armed role attack refused: ' + rows.map((r) => `${r.id}/${r.detail}`).join(' | '));
    process.exitCode = undefined;
  } finally {
    process.chdir(prev);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
});

test('stock smoke armed e2e: the stockwp pack runs against the stub WP root', { skip: !php ? 'PHP not available in this environment' : false }, async () => {
  // Bonus armed exercise: the stockwp smoke pack against the stub. The stub
  // walks enough of the WP primitive surface (options, posts, wpdb query
  // ticks, whitelist refusals) for every stockwp attack to grade honestly.
  const dir = mkdtempSync(join(tmpdir(), 'crashtest-stockwp-'));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    writeFileSync('crashtest.config.js', [
      `import { registerWordPress } from ${JSON.stringify(join(REPO, 'src/adapters/wordpress.js'))};`,
      'export default {',
      `  adapters: { wordpress: { wpRoot: ${JSON.stringify(STUB_ROOT)}, phpBin: 'php', callAllow: { wp_create_nonce: 1 }, allowOptions: ['blogname'] } },`,
      `  packs: [${JSON.stringify(join(REPO, 'packs'))}],`,
      "  modules: ['stockwp'],",
      '  seed: 0xC0FFEE,',
      '};',
      '',
    ].join('\n'));
    await main(['run']);
    assert.equal(process.exitCode, 0, 'the armed stock smoke must hold at exit 0');
    const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
    const rows = ledger.findings.filter((f) => f.id.startsWith('stockwp/'));
    assert.ok(rows.length >= 4, 'all four stockwp attacks ran');
    assert.ok(rows.every((f) => f.verdict === 'REFUSED'), 'every armed smoke attack refused: ' + rows.map((r) => `${r.id}/${r.detail}`).join(' | '));
    process.exitCode = undefined;
  } finally {
    process.chdir(prev);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
});
