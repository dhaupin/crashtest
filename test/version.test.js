// Version-drift pin: package.json and VERSION in src/cli.js are the two
// release surfaces the publish flow requires to be bumped "in one commit"
// (DEPLOY.md section III). Nothing else enforced that - this test does: the two
// surfaces must name the same version, and it must be a real x.y.z.
//
// Both files also must not have drifted from each OTHER fiction gates:
// the changelog heads the same number, so a mismatch here means release
// prose is stale somewhere.
//
// Version-truth ruling (crashtest#51, the eyestruct worked example at
// 3d8a822): package.json is THE single version truth; a living surface
// that names the CURRENT version must derive from it or refuse drift -
// never hand-copy it. Classification applied to this tree (2026-10-29):
//   LAWFUL era rows, keep their wording: dated changelog/discussion
//     sections, the `(v1.2.0)` annotations on docs/web prose and the
//     nav title announcing drafts (they name a release moment, pinned,
//     not the current number);
//   LAWFUL range pins: devDeps like `crashtest ^1.1.0` bind 1.x
//     compatibility, never the current version;
//   ENFORCED living surfaces: the web rig's package.json (rides the
//     root version - the leg below refuses drift instead of trusting
//     the release-day memory "move them together"). The npm badge on
//     the site is LIVE (/api/version island probe) - never a
//     hardcoded truth; its static fallback carries no number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const webPkg = JSON.parse(readFileSync(join(REPO, 'web', 'package.json'), 'utf8'));
const header = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');

test('package.json and src/cli.js VERSION name the same x.y.z', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, 'VERSION must be bare x.y.z (no prerelease in the publish flow)');
  assert.equal(VERSION, pkg.version, `src/cli.js VERSION (${VERSION}) must equal package.json version (${pkg.version})`);
});

test('CHANGELOG.md carries an entry for the current version', () => {
  assert.match(header, new RegExp(`^## ${pkg.version.replace('.', '\\.')}(?![.\\d])[^\n]*$`, 'm'), `CHANGELOG.md must list ${pkg.version} as a heading`);
  assert.match(header, /unreleased/i, 'an untagged version must be marked (unreleased) until the tag exists');
});

test('the web rig rides the root version (drift is refused, not remembered)', () => {
  assert.equal(webPkg.version, pkg.version, `web/package.json version (${webPkg.version}) drifted from package.json (${pkg.version}) - the rig must ride the root; bump both in one commit`);
});
