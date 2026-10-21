// Version-drift pin: package.json and VERSION in src/cli.js are the two
// release surfaces the publish flow requires to be bumped "in one commit"
// (DEPLOY.md section III). Nothing else enforced that - this test does: the two
// surfaces must name the same version, and it must be a real x.y.z.
//
// Both files also must not have drifted from each OTHER fiction gates:
// the README badge, DEPLOY.md pins and the docs pages quote the same
// number, so a mismatch here means release prose is stale somewhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const header = readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8');

test('package.json and src/cli.js VERSION name the same x.y.z', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/, 'VERSION must be bare x.y.z (no prerelease in the publish flow)');
  assert.equal(VERSION, pkg.version, `src/cli.js VERSION (${VERSION}) must equal package.json version (${pkg.version})`);
});

test('CHANGELOG.md carries an entry for the current version', () => {
  assert.match(header, new RegExp(`^## ${pkg.version.replace('.', '\\.')}(?![.\\d])[^\n]*$`, 'm'), `CHANGELOG.md must list ${pkg.version} as a heading`);
  assert.match(header, /unreleased/i, 'an untagged version must be marked (unreleased) until the tag exists');
});
