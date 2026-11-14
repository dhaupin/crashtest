// The release-post permalink law (ported from eyestruct, the same fix).
//
// A dotted, slashless permalink (`permalink: discussions/announcing-v1.0.0`)
// makes Jekyll emit an EXTENSIONLESS file: Ruby reads the ".0" as a file
// extension, so Jekyll skips appending ".html". freestruct's page scanner
// matches only `.html`/`.htm`, so the page is invisible to the whole SEO
// pipeline - no sitemap <loc>, no og/canonical/JSON-LD - even though it serves
// 200. The trailing-slash form emits `<slug>/index.html` and is seen.
//
// Two legs, per the house rule: every post permalink carries the slash, and
// the index lists exactly the post files (one row each, linking the slash
// form), so a new post without an index row reds this too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(REPO, 'docs', 'discussions');

const posts = () => readdirSync(DIR).filter((f) => /^announcing-v.+\.md$/.test(f)).sort();

test('every release-post permalink ends with "/" (a dotted, slashless slug is invisible to the sitemap)', () => {
  const files = posts();
  assert.ok(files.length >= 3, 'expected the release posts to be present');
  for (const f of files) {
    const m = readFileSync(join(DIR, f), 'utf8').match(/^permalink:\s*(\S+)\s*$/m);
    assert.ok(m, `${f}: no permalink`);
    assert.match(
      m[1],
      /\/$/,
      `${f}: permalink "${m[1]}" must end with "/" so Jekyll emits index.html (a dotted, slashless slug is extensionless on disk and freestruct never sees it)`
    );
  }
});

test('the release-post index lists exactly the post files, by their slash permalinks', () => {
  const index = readFileSync(join(DIR, 'index.md'), 'utf8');
  const linked = [...index.matchAll(/\]\(\/crashtest\/discussions\/(announcing-v[0-9.]+)\/?\)/g)]
    .map((m) => `${m[1]}.md`)
    .sort();
  assert.deepEqual(
    linked,
    posts(),
    'every post file needs exactly one index row, and every row a post file (each row links the trailing-slash form)'
  );
});
