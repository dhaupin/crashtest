// lint-packs (issue #32) - the opt-in packstruct passthrough. Teeth:
//   - explicitly invoked + packstruct missing = exit 2 WITH the fix string
//     (a never-working requested lane is a broken config, not a skip);
//   - passthrough fidelity: exit codes ride through verbatim;
//   - dir resolution: the packs ROOT is the default, an explicit dir passes
//     through untouched, and the header line names the actual dir checked;
//   - run --lint-packs: same lane INSTEAD of the campaign, no artifacts.
// Packstruct itself is never downloaded here - a fake repo-owned bin
// (node_modules/.bin/packstruct, the FIRST resolution entry) stands in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, LEDGER_PATH } from '../src/cli.js';

async function inRepo(name, fn) {
  const dir = await mkdtemp(join(tmpdir(), `crashtest-lintpacks-${name}-`));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(prev);
  }
}

/** A repo-owned fake packstruct: echoes its argv to .captured, exits <code>. */
async function fakePackstruct(script) {
  const dir = join(process.cwd(), 'node_modules', '.bin');
  await mkdir(dir, { recursive: true });
  const bin = join(dir, 'packstruct');
  await writeFile(bin, script);
  await chmod(bin, 0o755);
}
const CAPTURE = ['#!/bin/sh', 'echo "$@" > .captured', 'exit 0', ''].join(String.fromCharCode(10));
const EXIT = (code) => ['#!/bin/sh', `exit ${code}`, ''].join(String.fromCharCode(10));

/** Pin the missing-linter path honestly: npm-run strips the repo's own
 * node_modules/.bin OFF PATH so the tmp cwd genuinely has no packstruct. */
function withoutRepoPath(fn) {
  const PATH_KEY = process.platform === 'win32' ? 'Path' : 'PATH';
  const realPath = process.env[PATH_KEY];
  process.env[PATH_KEY] = tmpdir();
  return Promise.resolve()
    .then(fn)
    .finally(() => { process.env[PATH_KEY] = realPath; });
}

test('lint-packs: explicitly invoked with no packstruct installed exits 2 naming the fix (OFF, not half-on)', async () => {
  await inRepo('missing', async () => {
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await withoutRepoPath(() => main(['lint-packs']));
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2, 'requested-but-never-working is config-class, not a skip');
    assert.match(out.join(' | '), /packstruct is not installed in this repo/);
    assert.match(out.join(' | '), /npm i -D packstruct@<exact>/);
    process.exitCode = 0;
  });
});

test('lint-packs: exit codes ride through verbatim (passthrough fidelity)', async () => {
  for (const code of [0, 1, 2]) {
    await inRepo(`exit${code}`, async () => {
      await fakePackstruct(EXIT(code));
      await main(['lint-packs']);
      if (code === 0) {
        assert.ok(process.exitCode === undefined || process.exitCode === 0, `exit ${code} rode through`);
      } else {
        assert.equal(process.exitCode, code, `exit ${code} rode through`);
      }
      process.exitCode = 0;
    });
  }
});

test('lint-packs: default dir is the packs ROOT and args pass through untouched', async () => {
  await inRepo('dirdefault', async () => {
    await fakePackstruct(CAPTURE);
    await main(['lint-packs', '--json']);
    const captured = (await readFile('.captured', 'utf8')).trim();
    assert.equal(captured, 'lint packs --json', 'the ROOT (never packs/public) plus untouched flags');
  });
});

test('lint-packs: an explicit dir passes through and the header names the ACTUAL dir checked (the packs/public footgun is visible, not guessed)', async () => {
  await inRepo('direxplicit', async () => {
    await fakePackstruct(CAPTURE);
    const out = [];
    const orig = console.log;
    console.log = (...a) => out.push(a.join(' '));
    try {
      await main(['lint-packs', 'packs/public']);
    } finally {
      console.log = orig;
    }
    const captured = (await readFile('.captured', 'utf8')).trim();
    assert.equal(captured, 'lint packs/public', 'explicit dir rides through untouched');
    assert.match(out.join(' | '), /running packstruct over packs\/public/, 'the header names the dir actually checked');
  });
});

test('run --lint-packs: the preflight runs INSTEAD of the campaign - no requests, no artifacts (issue #32)', async () => {
  await inRepo('preflight', async (dir) => {
    await fakePackstruct(CAPTURE);
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    await main(['run', '--lint-packs']);
    assert.ok(process.exitCode === undefined || process.exitCode === 0);
    const captured = (await readFile('.captured', 'utf8')).trim();
    assert.equal(captured, 'lint packs', 'same lane as the verb');
    await assert.rejects(readFile(join(dir, LEDGER_PATH)), 'no ledger written - a preflight, not a run');
    process.exitCode = 0;
  });
});

test('run --lint-packs: requested but packstruct missing = exit 2 with the fix string (issue #32)', async () => {
  await inRepo('preflight-missing', async () => {
    await writeFile('crashtest.config.js',
      "export default { routes: { burst: async () => new Response('accepted', { headers: { 'cache-control': 'no-store' } }) }, seed: 7 };\n");
    const out = [];
    const orig = console.error;
    console.error = (...a) => out.push(a.join(' '));
    try {
      await withoutRepoPath(() => main(['run', '--lint-packs']));
    } finally {
      console.error = orig;
    }
    assert.equal(process.exitCode, 2);
    assert.match(out.join(' | '), /npm i -D packstruct@<exact>/);
    process.exitCode = 0;
  });
});
