// The npm parity gate (a new law ships with a test).
//
// Every family repo advertises its published package on npm, on every surface
// it ships: the docs (a footer or nav link) and the landing site (a nav
// entry). This proves the link is present and names the package.json name, so
// a rename or a dropped surface reds here instead of shipping a package
// nobody can find. The npm URL is one of the family's truth surfaces.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const has = (rel) => fs.existsSync(path.join(ROOT, rel))

const pkg = JSON.parse(read('package.json'))
const NPM = `https://www.npmjs.com/package/${pkg.name}`

// The docs surfaces that may carry the link: a literal, or the generated
// `{{ site.npm_url }}` var whose value lives in the generated docs config.
const DOC_SURFACES = ['docs/_layouts/default.html', 'docs/_data/nav.yml', 'docs/_config.yml']
const WEB_SURFACES = ['site.config.js', 'web/src/components/navItems.js', 'web/src/site.js']

const mentions = (rel) => {
  const src = read(rel)
  return src.includes(NPM) || src.includes('{{ site.npm_url }}')
}

test('the docs advertise the package on npm', () => {
  const present = DOC_SURFACES.filter(has)
  const hits = present.filter(mentions)
  assert.ok(hits.length > 0,
    `no docs surface links ${NPM} (checked ${present.join(', ')})`)
})

test('the landing site advertises the package on npm', () => {
  const present = WEB_SURFACES.filter(has)
  if (present.length === 0) return // docs-only repo
  const hits = present.filter(mentions)
  assert.ok(hits.length > 0, `no web nav links ${NPM} (checked ${present.join(', ')})`)
})

test('every npm link names the published package', () => {
  const all = [...DOC_SURFACES, ...WEB_SURFACES].filter(has).map(read).join('\n')
  const urls = [...all.matchAll(/https:\/\/www\.npmjs\.com\/package\/([a-z0-9@/_.-]+)/gi)].map((m) => m[1])
  for (const name of urls) {
    assert.equal(name, pkg.name, `npm link points at "${name}", package.json says "${pkg.name}"`)
  }
})
