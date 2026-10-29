#!/usr/bin/env node
'use strict'

// Unwrap prose in markdown: join lines that belong to one paragraph or one
// list item into a single line. Never touches frontmatter (--- ... ---),
// fenced code (``` blocks), table rows (| lines), headings, or blank-line
// boundaries. The point: the 72-column commit-time habit is dead - prose
// flows, and future agents must not re-wrap it.
//
// Usage: node scripts/unwrap-prose.cjs <file.md> [file2.md ...]

const fs = require('fs')

function unwrap(textOrLines) {
  const lines = Array.isArray(textOrLines) ? textOrLines : textOrLines.split('\n')
  const out = []
  let fenced = false
  let inFrontmatter = 0

  const isCodeLines = (ln) => /^\s*```/.test(ln)
  const isTableRow = (ln) => /^\s*\|/.test(ln)
  const isHeading = (ln) => /^#{1,6} /.test(ln)
  const isBlank = (ln) => ln.trim() === ''
  // A wrapped continuation: NOT blank, not a new structural start.
  const isContinuation = (ln) =>
    !isCodeLines(ln) &&
    !isTableRow(ln) &&
    !isHeading(ln) &&
    !isBlank(ln) &&
    !/^([-*+] |\d+\. |>)/.test(ln) &&
    (inFrontmatter !== 1)

  let buf = null
  let bufIsList = false
  let bufIsQuote = false

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]

    if (ln.trim() === '---' && inFrontmatter !== 2 && i < 40) {
      inFrontmatter++
      if (buf != null) { out.push(buf); buf = null }
      out.push(ln)
      continue
    }
    if (inFrontmatter === 1) { out.push(ln); continue }

    if (isCodeLines(ln)) {
      fenced = !fenced
      if (buf != null) { out.push(buf); buf = null }
      out.push(ln)
      continue
    }
    if (fenced) { out.push(ln); continue }

    if (isBlank(ln)) {
      if (buf != null) { out.push(buf); buf = null }
      out.push(ln)
      continue
    }

    const listStart = /^([-*+] |\d+\. )/.test(ln)
    const quoteStart = /^>/.test(ln)
    const tableRow = isTableRow(ln)
    const heading = isHeading(ln)

    if (tableRow || heading) {
      if (buf != null) { out.push(buf); buf = null }
      out.push(ln)
      continue
    }

    if (listStart) {
      if (buf != null) { out.push(buf); buf = null }
      buf = ln.replace(/\s+$/, '')
      bufIsList = true
      bufIsQuote = false
      continue
    }

    if (quoteStart) {
      if (buf != null) { out.push(buf); buf = null }
      buf = ln.replace(/\s+$/, '')
      bufIsList = false
      bufIsQuote = true
      continue
    }

    // Continuation line: join into the current buffer.
    if (buf != null) {
      buf = buf.replace(/\s+$/, '') + ' ' + ln.trim()
    } else {
      buf = ln.replace(/\s+$/, '')
    }
  }
  if (buf != null) out.push(buf)
  // Collapse runs of >2 consecutive blank lines down to one.
  const collapsed = []
  let blanks = 0
  for (const ln of out) {
    if (ln.trim() === '') {
      blanks++
      if (blanks > 1) continue
    } else blanks = 0
    collapsed.push(ln)
  }
  return collapsed.join('\n')
}

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8')
  const unwrapped = unwrap(src)
  fs.writeFileSync(file, unwrapped)
  const before = src.split('\n').filter((l) => l.trim() !== '').length
  const after = unwrapped.split('\n').filter((l) => l.trim() !== '').length
  console.log(`${file}: ${before} non-blank -> ${after} non-blank lines`)
}
