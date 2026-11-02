// release-notes - the GH release creation step's one job: extract the
// CHANGELOG section for the version argument (default: the checkout's
// own) so the release object and the changelog cannot disagree. `node
// scripts/release-notes.cjs [version]`; empty output + exit 1 means the
// changelog has no section for that version, and the release job refuses
// to mint one without notes (a release with a wrong or empty body is
// drift, not content).
//
// Heading form: the family writes Keep-a-Changelog sections
// (`## [1.2.0] - 2026-11-02`). The matcher also accepts the bare
// (`## 1.2.0`) and v-prefixed (`## v1.2.0`) forms the older copies wrote,
// so a changelog mid-migration still extracts honestly. The version token
// must be closed by a non-version character, so `## [1.2.0]` never matches
// a `## [1.2.0-rc.1]` section.

'use strict'
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const version = process.argv[2] || JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8')

// Anchored to line start; bracketed `## [v]`, bare `## v`, or `## vX` - with
// the version token closed by a non-version char so 1.2.0 cannot match
// 1.2.0-rc.1.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const headingRe = new RegExp(`^## (?:\\[v?${escaped}\\]|v?${escaped})(?![\\d.\\-])`, 'm')
const match = headingRe.exec(changelog)
if (!match) {
  process.stderr.write(`release-notes: no "## [${version}]" section in CHANGELOG.md - the tag and the changelog disagree\n`)
  process.exit(1)
}
// Slice from the END of the heading line, not from just after the closing
// bracket: a KAC heading is `## [version] - date`, and a slice at the
// heading's own end carries that date into the body (the notes then open
// with a stray `- 2026-11-02` bullet). The section runs to the next `## `
// heading, or to EOF when this is the newest heading - the first cut's own
// case. An absent following heading is not an empty section; the emptiness
// check below is the real judge.
const headingLineEnd = changelog.indexOf('\n', match.index)
const rest = changelog.slice(headingLineEnd + 1)
const next = rest.search(/^## /m)
const section = (next === -1 ? rest : rest.slice(0, next)).trim()
if (!section) {
  process.stderr.write(`release-notes: the "## [${version}]" section is empty\n`)
  process.exit(1)
}
process.stdout.write(section + '\n')
