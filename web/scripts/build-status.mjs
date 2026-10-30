/**
 * scripts/build-status.mjs - the family status contract emitter
 * (family-status@1), crashtest's member side.
 *
 * Adapted from eyestruct's emitter (dhaupin/eyestruct, the dialect origin -
 * worked example adopted per crashtest#47). The CONTRACT is identical; the
 * MEMBERSHIP is crashtest's own shape:
 *
 *   - crashtest ships ONE committed ledger, labs/crashledger.json - the pack
 *     campaigns ride the suite (config: packs:false for the dogfood), so the
 *     legs array carries the `crashtest` leg only. Nothing is invented: no
 *     leg is claimed for a ledger the repo does not carry.
 *   - the packs rows carry each pack's DECLARED attack count, derived from
 *     the pack bank itself (dynamic import of the manifest's entry file) -
 *     the same files `crashtest packs --json` reads. The battery test
 *     cross-checks the emitter derivation against the CLI inventory so the
 *     two sources can never disagree silently (test/status-leg.test.js).
 *
 * Generated, never hand-edited: the file is REGENERATED on every web build
 * (CI runs this script first in the web-build lane; locally `node
 * web/scripts/build-status.mjs`), and web/public/status.json is gitignored -
 * committing it would recreate the exact stale-copy drift class the family
 * kills everywhere else (regeneration IS the freshness).
 *
 * The dialect (family-status@1), thirty seconds:
 *
 *   { schema: 1, contract: "family-status@1", repo, site, docs, asOf,
 *     legs: [{ leg, verdict, cases, counts, ledger }],
 *     packs: [{ name, spec, manifest, cases }] }
 *
 * Verdict rule (additive-first): every case verdict is REFUSED, PASSED, or
 * BOUNDED -> "PASS". Anything else (EXPLOITED, FAILED, a verdict the dialect
 * has never met) -> "RED", never a fake pass. A row without a verdict is a
 * corruption - it degrades the leg honestly instead of guessing.
 *
 * Reader rule (the OTHER half of the contract): refuse on missing/renamed
 * schema or contract; render a not-yet row, never a guessed number. Our
 * island (web/src/components/FamilyStatusIsland.jsx) implements exactly
 * that, per-sibling.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')
const OUT_PATH = join(REPO_ROOT, 'web', 'public', 'status.json')

const REPO = 'dhaupin/crashtest'
const SITE = 'https://crashtest.creadev.org/dashboard' // honest pointer: the human face of this ledger
// The docs page ships under the extensionless permalink (docs/reference/status.md,
// permalink: reference/status). The trailing-slash form 404s on this host
// (crashtest#56), so the emitted URL is the sitemap's own shape - no slash.
const DOCS = 'https://docs.creadev.org/crashtest/reference/status'

const PASS_VERDICTS = new Set(['REFUSED', 'PASSED', 'BOUNDED'])

function legOf(rows, { leg, ledger }) {
  const counts = {}
  let verdict = 'PASS'
  for (const row of rows) {
    const v = row.verdict
    if (v === undefined || v === null) {
      // A row without a verdict is a corruption the battery would refuse
      // elsewhere; here it degrades the leg honestly instead of guessing.
      verdict = 'RED'
      continue
    }
    if (!PASS_VERDICTS.has(v)) verdict = 'RED'
    counts[v] = (counts[v] || 0) + 1
  }
  return { leg, verdict, cases: rows.length, counts, ledger }
}

/**
 * The packs rows: manifest inventory from the packs themselves, no CLI
 * spawn and no duplicated parser - read each pack.json, import the bank the
 * manifest's entry names, and count the attacks it declares. Refusals are
 * loud and named (family rule: refuse, never guess):
 *   - an unreadable pack.json (a pack the inventory cannot count)
 *   - a bank that will not import
 *   - a bank declaring ZERO attacks (a pack the campaign never fires)
 *   - a pack.json name that does not match its directory (the loader's own
 *     footgun rule - the status contract refuses it upstream of a run)
 */
async function packsOf(root) {
  const packsDir = join(root, 'packs', 'public')
  let entries
  try {
    entries = readdirSync(packsDir).sort()
  } catch (err) {
    throw new Error(`packs/public unreadable (${err.message}) - the status contract refuses a repo whose pack corpus is not countable`)
  }

  const packs = []
  for (const entry of entries) {
    if (!statSync(join(packsDir, entry)).isDirectory()) continue
    const manifestPath = join(packsDir, entry, 'pack.json')
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      throw new Error(`pack ${entry}: pack.json unreadable (${err.message}) - the status contract refuses a pack the inventory cannot count`)
    }
    if (manifest.name !== entry) {
      throw new Error(`pack ${entry}: pack.json name "${manifest.name}" does not match its directory - refuse, never guess`)
    }
    const bankPath = join(packsDir, entry, manifest.entry || 'index.js')
    let bank
    try {
      bank = await import(pathToFileURL(bankPath).href)
    } catch (err) {
      throw new Error(`pack ${entry}: bank "packs/public/${entry}/${manifest.entry || 'index.js'}" unimportable (${String(err.message).split('\n')[0]}) - the status contract refuses a pack the campaign cannot count`)
    }
    const cases = bank?.default?.attacks?.length
    if (!cases) {
      throw new Error(`pack ${entry}: bank declares zero attacks - run the campaign before serving a status for it (a pack the registry never fires is exactly the gap the family refuses)`)
    }
    packs.push({ name: manifest.name, spec: 'packstruct@1', manifest: `packs/public/${entry}/pack.json`, cases })
  }
  return packs
}

/**
 * build({ root }) -> the status object. Exported for the battery test.
 * Throws (refusing, never guessing) when a mandated input is unreadable.
 */
export async function build(root = REPO_ROOT) {
  let ledger
  try {
    ledger = JSON.parse(readFileSync(join(root, 'labs', 'crashledger.json'), 'utf8'))
  } catch (err) {
    throw new Error(`labs/crashledger.json unreadable (${err.message}) - the status contract refuses to serve without the committed ledger`)
  }
  const findings = ledger.findings ?? []

  let asOf = 'worktree'
  try {
    asOf = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // no git context (zip download): say worktree, never a fake sha
  }

  return {
    schema: 1,
    contract: 'family-status@1',
    repo: REPO,
    site: SITE,
    docs: DOCS,
    asOf,
    legs: [
      legOf(findings, { leg: 'crashtest', ledger: 'labs/crashledger.json' }),
    ],
    packs: await packsOf(root),
  }
}

export function write(root = REPO_ROOT, outPath = OUT_PATH) {
  return build(root).then((status) => {
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(status, null, 2) + '\n')
    return { status, outPath }
  })
}

// CLI: node scripts/build-status.mjs -> writes web/public/status.json.
// Silent success (npm scripts), refusal prints and exits nonzero.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { outPath } = await write()
    console.log(`family status written: ${outPath}`)
  } catch (err) {
    console.error(`family status REFUSED: ${err.message}`)
    process.exit(1)
  }
}
