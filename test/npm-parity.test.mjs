// The npm parity gate (a new law ships with a test).
//
// Every family repo advertises its published package on npm, on every surface
// it ships. This proves each REQUIRED surface carries a link naming the
// package.json name, so a rename or a dropped surface reds here instead of
// shipping a package nobody can find.
//
// Three lawful shapes, each resolved to its source of truth:
//   - the literal https://www.npmjs.com/package/<name>
//   - {{ site.npm_url }}, resolved against docs/_config.yml
//   - {{ site.title }}, resolved against docs/_config.yml title
//
// The bite: the predicate is a plain function, and a mutation fixture proves it
// reports a problem when a required surface loses its link. A check that cannot
// fail is not a check.

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

// The surfaces that MUST carry the link. Named explicitly: a docs tree has
// several surfaces, and a gate satisfied by whichever one happens to carry a
// link cannot notice the one that lost it.
const REQUIRED = [
  'docs/_layouts/default.html',
  'docs/_data/nav.yml',
  'web/src/components/navItems.js',
]

const LITERAL = /https:\/\/www\.npmjs\.com\/package\/([a-z0-9@/_.-]+)/gi
const NPM_URL_VAR = /\{\{?\s*site\.npm_url\s*\}\}/
// The templated title only counts INSIDE an npm URL: {{ site.title }}
// also appears in ordinary <title> tags, which are not npm links.
const TITLE_VAR = /npmjs\.com\/package\/\{\{?\s*site\.title\s*\}\}/

// Resolve the generated docs config once: the templated forms are only correct
// while the value they interpolate names this package.
const docsConfig = has('docs/_config.yml') ? read('docs/_config.yml') : ''
const configValue = (key) => {
  const m = docsConfig.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

// The one predicate: given a surface's text, does it advertise THIS package?
// Returns null when lawful, a reason string when not.
function parityProblem(rel, text) {
  const literal = [...text.matchAll(LITERAL)].map((m) => m[1])
  for (const name of literal) {
    if (name !== pkg.name) {
      return `${rel} links the package "${name}", but package.json says "${pkg.name}"`
    }
  }
  if (NPM_URL_VAR.test(text)) {
    const url = configValue('npm_url')
    if (!url) return `${rel} renders {{ site.npm_url }} but docs/_config.yml has no npm_url (run the sync)`
    if (!url.endsWith(`/package/${pkg.name}`)) {
      return `${rel} renders {{ site.npm_url }}, which resolves to "${url}" - not this package`
    }
  }
  if (TITLE_VAR.test(text)) {
    const title = configValue('title')
    if (title !== pkg.name) {
      return `${rel} builds its npm URL from {{ site.title }}, but docs/_config.yml title is "${title}" and package.json says "${pkg.name}"`
    }
  }
  if (literal.length === 0 && !NPM_URL_VAR.test(text) && !TITLE_VAR.test(text)) {
    return `${rel} carries no link to ${NPM} (no literal, no {{ site.npm_url }}, no {{ site.title }})`
  }
  return null
}

test('the package is published under the name the site advertises', () => {
  assert.ok(!pkg.private, 'a private package must not advertise an npm link')
})

for (const rel of REQUIRED) {
  test(`${rel} advertises the package on npm`, () => {
    assert.ok(has(rel), `${rel} is missing - update the REQUIRED list if the surface moved`)
    const problem = parityProblem(rel, read(rel))
    assert.equal(problem, null, problem || '')
  })
}

test('the gate bites: a required surface that loses its link is refused', () => {
  // The regression this gate exists for: a rebrand sweep or a footer rewrite
  // drops the link. Strip it and prove the SAME predicate reports it.
  for (const rel of REQUIRED) {
    const original = read(rel)
    const stripped = original
      .replace(LITERAL, 'https://example.com/removed')
      .replace(NPM_URL_VAR, 'https://example.com/removed')
      .replace(TITLE_VAR, 'https://example.com/removed')
    assert.notEqual(stripped, original, `the fixture must actually remove a link from ${rel}`)
    assert.notEqual(parityProblem(rel, stripped), null,
      `${rel} with its link removed must be refused, but the predicate passed it`)
  }
})

test('the gate bites: a link naming the wrong package is refused', () => {
  // A synthetic surface, not a real one: the required surfaces carry the link
  // in different shapes (literal, npm_url, title), so retargeting a real file
  // would silently no-op on the templated ones. This tests the predicate.
  const fake = '<a href="https://www.npmjs.com/package/not-this-package">npm</a>'
  assert.notEqual(parityProblem('fixture', fake), null, 'a link naming another package must be refused')
})
