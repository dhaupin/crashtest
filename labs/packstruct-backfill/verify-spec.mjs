// verify-spec.mjs - byte-compare the committed SPEC v1 transcript
// (labs/packstruct-backfill/SPEC-v1.md) against a local packstruct copy's
// spec/SPEC.md - either an npm-installed package root
// (`node_modules/packstruct`; the npm wrapper ships the same path, this is
// what CI checks since the lane switched from the GitHub-clone pin to the
// exact devDependency "packstruct": "1.0.0") or a checkout of
// dhaupin/packstruct for manual verification. Deliberately NOT part of
// `npm test`: the check needs packstruct on disk and every socket in this
// repo's test surface is banned. The teeth live in CI instead -
// .github/workflows/ci.yml resolves the exact devDependency and runs this
// script right after `packstruct lint packs/`.
//
// Usage: node labs/packstruct-backfill/verify-spec.mjs node_modules/packstruct
//   (or: ... /path/to/packstruct-clone)
//
// On drift: re-transcribe (copy the new spec/SPEC.md over SPEC-v1.md), bump
// the exact devDependency pin in package.json, keep the historical spec
// commit note in refusal-matrix.json "spec.source", re-derive any specKey
// the new vocabulary moved, and land all of it in the SAME commit
// (labs/packstruct-backfill/README.md rule 2).
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packstructRoot = process.argv[2];
if (!packstructRoot) {
  console.error('usage: node labs/packstruct-backfill/verify-spec.mjs node_modules/packstruct  (or a packstruct checkout path)');
  process.exit(2);
}

const committedPath = fileURLToPath(new URL('./SPEC-v1.md', import.meta.url));
const remotePath = join(resolve(packstructRoot), 'spec', 'SPEC.md');

let committed;
let remote;
try {
  committed = await readFile(committedPath, 'utf8');
} catch (err) {
  console.error(`verify-spec: cannot read the committed transcript at ${committedPath}: ${err.message}`);
  process.exit(1);
}
try {
  remote = await readFile(remotePath, 'utf8');
} catch (err) {
  console.error(`verify-spec: cannot read ${remotePath} - is "${packstructRoot}" a packstruct package or checkout?`);
  process.exit(1);
}

if (committed !== remote) {
  console.error(`verify-spec: SPEC v1 transcript drifted from ${remotePath} - the pinned SHA moved meaning; re-transcribe + bump the pin + re-derive the moved specKeys in the SAME review (transcribe, never invent)`);
  process.exit(1);
}

console.log(`verify-spec: SPEC v1 transcript is byte-equal to ${remotePath}`);
