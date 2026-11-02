'use strict';
/**
 * Behavior tests for scripts/ship-from-download.cjs (the generic phone
 * publish lane). Temp dirs only, fake npm runner (the runner seam), no
 * network. The lane is family-reusable - it stages ANY npm package tree,
 * so these fixtures use an invented package name deliberately (`lib-x`),
 * never crashtest, to prove the product-agnostic contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ship, TOKEN_ENV } = require('../scripts/ship-from-download.cjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ship-lane-'));
}

function mktree(root, name = 'lib-x', version = '1.0.0') {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
}

function fakeRunner(status = 0) {
  const calls = [];
  const run = (cmd, args, o) => {
    calls.push({ cmd, args: [...args], o });
    return { status };
  };
  run.calls = calls;
  return run;
}

const GOOD_TOKEN = 'npm_LIVE-AMPLE-HELLO-WORLD-0123456789abcdef';

test('ship lane: the staged .npmrc holds the ENV expansion, never the token or the deprecated always-auth line', () => {
  const base = tmp();
  mktree(path.join(base, 'src-tree'));
  let captured = null;
  const origWrite = fs.writeFileSync;
  fs.writeFileSync = (p, c, ...rest) => {
    if (String(p).endsWith('.npmrc')) captured = c;
    return origWrite(p, c, ...rest);
  };
  try {
    const r = ship({ target: path.join(base, 'src-tree'), root: path.join(base, 'dest'), token: GOOD_TOKEN, run: fakeRunner(0) });
    assert.equal(r.code, 0);
  } finally {
    fs.writeFileSync = origWrite;
  }
  assert.ok(captured && captured.includes(`\${${TOKEN_ENV}}`), 'the .npmrc carries the env placeholder');
  assert.ok(captured && !captured.includes('always-auth'), 'the deprecated always-auth line is never staged (npm >=9 warns on it)');
  assert.ok(captured && !captured.includes(GOOD_TOKEN), 'the raw token never hits the staged file');
  fs.rmSync(base, { recursive: true, force: true });
});

test('ship lane: the staged .npmrc is unlinked in finally even when publish fails', () => {
  const base = tmp();
  mktree(path.join(base, 'src-tree'));
  const npmrc = path.join(base, 'dest', '.npmrc');
  const run = fakeRunner(1);
  const r = ship({ target: path.join(base, 'src-tree'), root: path.join(base, 'dest'), token: GOOD_TOKEN, run });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(npmrc), false, 'the staged .npmrc is gone after a failing publish');
  assert.ok(!JSON.stringify(run.calls.map((c) => c.args)).includes(GOOD_TOKEN), 'the token is never in argv');
  fs.rmSync(base, { recursive: true, force: true });
});

test('ship lane: missing --target and --root are named refusals (exit 2)', () => {
  for (const opts of [{ run: fakeRunner() }, { target: '/no/where', run: fakeRunner() }, { root: '/tmp/x', run: fakeRunner() }]) {
    const r = ship(opts);
    assert.equal(r.code, 2, JSON.stringify(r.out));
    assert.ok(r.out.join('\n').includes('ship['), 'refusal carries a named code');
  }
});
