'use strict'
// verify-release - the post-publish trust ladder (the gap the 1.0.0 cut
// personally proved: publish CAN go green while the registry result is
// wrong, because nothing asserted the tarball between proof-of-publish
// and proof-of-work). This script is the reusable core; publish.yml's
// verify job runs it two ways on every cut:
//
//   --npm                 registry ladder: dist-tags.latest == this tree's
//                         package version, the published sha512 matches the
//                         metadata integrity, provenance attestations are
//                         present, then the FULL pack ladder below on the
//                         tarball that is actually served.
//   --gh --tag v1.2.3     release ladder: the GH release object exists for
//                         the tag, its target commit == `git rev-parse
//                         TAG^{commit}`, and the source tarball's file
//                         list diffs clean against `git archive` of that
//                         commit (zero drift).
//   --asset <name>        with --gh: assert the release carries an asset
//                         named <name> whose sha512 equals the registry's
//                         own integrity metadata for this version - the GH
//                         release and the npm artifact are the SAME bytes,
//                         so a consumer gets one artifact either way. Opt-in
//                         (a repo that attaches no tarball passes no flag
//                         and sees zero behavior change); a repo whose
//                         release carries the tarball passes it and makes
//                         the identity a hard requirement.
//
// The battery leg (tests/release-verify.test.js) runs the same script over
// `npm pack` output - THE PACK LADDER EVERY PUSH, offline-first:
//
//   verify-release --pack <tgz>            (the contents ladder, below)
//
// The pack ladder (audience: the runtime tar, not the source tar):
//   1. LIST: tar -tzf; every entry minus its package/ prefix.
//   2. FORBIDDEN scan: the family-default prefixes (below) plus any
//      --forbidden additions - source maps and .env* never ship. Named
//      refusal.
//   3. EXPECTED SET: `npm pack --dry-run --json` ON THE CALLER'S TREE is
//      the same-algorithm authority for what publish would include - the
//      served set must equal it EXACTLY (no stragglers, no omissions).
//   4. IDENTITY: package/package.json name + version == expected version.
//   5. CONSUMER INSTALL: a scratch tree `npm install <tgz>`, then the
//      pack's own require probe (name@version), any --probe extras the
//      caller states, and the installed bin answering --version as a
//      child process. Honest SKIP (named) when the registry is
//      unreachable - the verify job and CI always have network; a laptop,
//      sometimes not, and the skip is printed rather than swallowed.
//
// Exit contract (tooling, not the frozen reason surface): 0 verified,
// 1 verification failure (named), 2 capability gap (tar/npm/git/gh absent).
//
// GENERIC CORE (the family lane, 2026-10-28): nothing in the script is
// repo-specific - name, version, bin path, and registry package are read
// from the checkout's package.json, so a adopting repo drops the file in
// with ZERO edits and states only its own rules as flags:
//
//   --exports k1,k2,k3    pin the tarball's exports map keys exactly
//                         (pass the keys your package freezes, derived
//                         from source by the caller, never hand-copied)
//   --probe "<js expr>"   an extra consumer probe run against the
//                         INSTALLED package (repeatable; eyestruct uses
//                         the adapter-contract assertion, others may
//                         pin their own marker constants)
//   --forbidden p1/,p2/   forbidden path prefixes ADDED to the family
//                         defaults (the defaults already name the tree
//                         dirs that simply should not ride a tarball:
//                         labs/ docs/ web/ packs/ tests/ scripts/
//                         models/ examples/ .github/ node_modules/)
//
// What each repo passes lives in ITS OWN workflow/battery invocation - the
// script stays identical across the family, so a fix here is one copy.

const { spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

// The ladder judges the CALLER's tree, never the script's location:
// process.cwd() is the checkout in the battery and the verify job, and a
// foreign repo runs this same file from its own root against its own
// tarball with zero edits (the generic-core rule, walk WL-7: a
// script-relative REPO_ROOT quietly pinned the whole ladder to one repo).
const REPO_ROOT = process.cwd()
// The family-default forbidden list: tree dirs that simply should not ride
// a runtime tarball on ANY of the family repos (private state, dev rigs,
// CI wiring, node_modules). An adopting repo extends with --forbidden,
// never edits this file.
const FORBIDDEN_PREFIXES = [
  'labs/', 'web/', 'docs/', 'models/', 'packs/', 'tests/',
  'examples/', 'scripts/', 'node_modules/', '.github/',
]
const FORBIDDEN_SUFFIXES = ['.map', '.env', '.log', '.tgz']

function say(line) { process.stdout.write(line + '\n') }
function die(code, line) {
  process.stderr.write(`[verify-release] FAIL: ${line}\n`)
  process.exit(code)
}
function fail(line) { die(1, line) }
function cap(line) { die(2, line) }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// A version is "visible" when dist-tags.latest names it AND the version entry
// exists - the two things the registry must agree on. A fresh publish is
// served before the packument indexes it, so a single read right after
// publish races the propagation and reads a false negative.
function registryHasVersion(meta, version) {
  return Boolean(
    meta && meta['dist-tags'] && meta['dist-tags'].latest === version &&
    meta.versions && meta.versions[version]
  )
}

// GitHub records target_commitish as the DEFAULT BRANCH NAME when a release
// is cut from an already-pushed tag, not the commit SHA. Only a 40-hex value
// is a commit claim; a branch name carries no commit identity, and the tag
// itself (git rev-parse below) is the source of truth.
function releaseTargetMatches(target, commit) {
  const t = String(target || '')
  return !/^[0-9a-f]{40}$/i.test(t) || t === commit
}

function sh(cmd, args, opts) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

function readCheckout() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  if (!pkg.name || !pkg.version) fail(`checkout package.json carries no name/version`)
  return pkg
}

// --- the pack ladder ----------------------------------------------------

function tarList(file) {
  const r = sh('tar', ['-tzf', file])
  if (r.status !== 0) cap(`tar failed to list ${file}: ${r.stderr.trim()}`)
  return r.stdout.trim().split('\n').filter(Boolean).map((n) => n.replace(/^\.{1,2}\//, '')).map((n) => n.replace(/^package\//, '').replace(/^package$/, ''))
}

function forbidden(scan, extraPrefixes, allowed) {
  const prefixes = [...FORBIDDEN_PREFIXES, ...extraPrefixes]
  // --allowed (alias --allow) names exemptions: a name under an allowed
  // prefix skips the scan. Exemption only - you can never re-assert
  // something the scan itself forbids, and a repo that passes no flag sees
  // zero behavior change.
  const exempt = (name) => (allowed || []).some((p) => name === p || name.startsWith(p))
  const hits = []
  for (const name of scan) {
    if (exempt(name)) continue
    for (const p of prefixes) {
      if (name.startsWith(p)) hits.push(`${name} (forbidden path prefix ${p})`)
    }
    for (const s of FORBIDDEN_SUFFIXES) {
      if (name.endsWith(s)) hits.push(`${name} (forbidden suffix ${s})`)
    }
    // Tarball names arrive already package/-stripped, so any dot segment
    // left in a name is a real dotfile, not the tarball's root dir.
    if (/(^|\/)\.[\w-]+/.test(name)) hits.push(`${name} (dotfile)`)
  }
  // Exact duplicates collapse: one file, one named hit (joined below).
  return hits
}

function packLadder(tgz, expectedVersion, cfg) {
  say(`[verify-release] pack ladder: ${tgz}`)

  // 2. forbidden scan before anything else - a file that must not ship is
  // refused BY NAME, fast (the doctored-tar battery case relies on this).
  const names = tarList(tgz)
  if (!names.length) fail('the tarball lists zero files')
  const bad = forbidden(names, cfg.extraForbidden, cfg.allowed)
  if (bad.length) fail(`FORBIDDEN contents in the tarball: ${bad.join('; ')}`)
  say(`[verify-release] PASS forbidden scan (${names.length} entries, 0 forbidden)`)

  // 3. expected set from the same tree, same algorithm.
  const packRun = sh('npm', ['pack', '--dry-run', '--json'], { cwd: REPO_ROOT })
  let expected = null
  try {
    const packJson = JSON.parse(packRun.stdout)
    expected = (Array.isArray(packJson) ? packJson[0] : packJson).files.map((f) => f.path)
  } catch {
    cap(`npm pack --dry-run --json failed: ${packRun.stderr.trim()}`)
  }
  const gotSet = [...names].sort()
  const want = [...new Set([...expected, 'package.json'])].sort()
  const missing = want.filter((n) => !gotSet.includes(n))
  const extra = gotSet.filter((n) => !want.includes(n))
  if (missing.length || extra.length) {
    // Same discipline the gh ladder learned live: bare array interpolation
    // swallows an empty-string finding ('[' + [''] + ']' prints as []).
    fail(`served set != pack set of the release commit - missing: ${JSON.stringify(missing.slice(0, 10))} extra: ${JSON.stringify(extra.slice(0, 10))}`)
  }
  say(`[verify-release] PASS served set == npm pack of this tree (${want.length} files)`)

  // 4. identity.
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-'))
  const ex = sh('tar', ['-xzf', tgz, '-C', dest])
  if (ex.status !== 0) cap(`tar failed to extract ${tgz}: ${ex.stderr.trim()}`)
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package', 'package.json'), 'utf8'))
  if (pkg.name !== cfg.name) fail(`tarball package name is ${pkg.name}, expected ${cfg.name}`)
  if (pkg.version !== expectedVersion) fail(`tarball version ${pkg.version} != expected ${expectedVersion}`)
  if (cfg.exports) {
    const exportKeys = Object.keys(pkg.exports || {})
    if (exportKeys.join(',') !== cfg.exports) {
      fail(`tarball exports map drifted: ${JSON.stringify(exportKeys)} - expected ${JSON.stringify(cfg.exports.split(','))}`)
    }
    say(`[verify-release] PASS exports map held (${cfg.exports})`)
  }
  say(`[verify-release] PASS identity: ${pkg.name}@${pkg.version}`)

  // 5. consumer install. Network-honest: a named SKIP beats a silent one.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-consumer-'))
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ name: 'verify-release', version: '0.0.0', private: true }, null, 2))
  const inst = sh('npm', ['install', '--no-fund', '--no-audit', '--ignore-scripts', tgz], { cwd: home, timeout: 180000 })
  const stderr = `${inst.stderr || ''}`
  if (inst.status !== 0) {
    if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|network/i.test(stderr)) {
      say('[verify-release] SKIP consumer install (registry unreachable - named, not swallowed; the verify job always has network)')
    } else {
      fail(`consumer install failed: ${stderr.trim().slice(-400)}`)
    }
    return
  }
  // The probing is derived from the INSTALLED package.json - the bin path
  // and require name are the tarball's own truth, never a hardcoded one.
  // The default probe is LOAD-ONLY on purpose: package mains do not all
  // export .version (the toy foreign-repo case proved the class), and the
  // version truth is already compared from the tarball's package.json in
  // step 4. Repos with a stricter surface pass it as --probe (eyestruct:
  // its adapter-contract marker).
  const installedPkg = JSON.parse(fs.readFileSync(path.join(home, 'node_modules', cfg.name, 'package.json'), 'utf8'))
  // A package with no main/exports/bin legitimately has no root module to
  // load (a factory that ships tool files + templates only). Requiring its
  // own name then raises MODULE_NOT_FOUND for a shape, not a defect, so the
  // default load probe is SKIPPED by name and the repo states its real
  // surface as --probe. Named, never silent.
  const hasEntry = Boolean(installedPkg.main || installedPkg.exports || installedPkg.bin)
  const defaultProbe = `require(${JSON.stringify(cfg.name)})`
  const probes = hasEntry ? [defaultProbe, ...cfg.probes] : [...cfg.probes]
  if (!hasEntry && !cfg.probes.length) {
    say(`[verify-release] SKIP consumer load probe (${cfg.name} declares no main/exports/bin - nothing to load; pass --probe if it has a surface)`)
  }
  for (let i = 0; i < probes.length; i++) {
    const probe = spawnSync('node', ['-e', probes[i]], { cwd: home, encoding: 'utf8' })
    if (probe.status !== 0) {
      fail(`consumer probe (${i === 0 ? 'version' : 'index ' + i}) failed on the installed tarball (exit ${probe.status}): ${probes[i]}`)
    }
  }
  say(`[verify-release] PASS consumer probes (${probes.length})`)
  let binProbe = { status: 0, stdout: '' }
  const binName = installedPkg.bin ? (typeof installedPkg.bin === 'string' ? cfg.name : Object.keys(installedPkg.bin)[0]) : null
  if (binName) {
    const binPath = typeof installedPkg.bin === 'string' ? path.join(home, 'node_modules', cfg.name, installedPkg.bin) : path.join(home, 'node_modules', cfg.name, installedPkg.bin[binName])
    binProbe = spawnSync('node', [binPath, '--version'], { cwd: home, encoding: 'utf8' })
    if (binProbe.status !== 0 || binProbe.stdout.trim() !== expectedVersion) {
      fail(`installed bin ${binName} --version answered "${(binProbe.stdout || '').trim()}" (wanted ${expectedVersion})`)
    }
    say(`[verify-release] PASS installed bin ${binName} --version -> ${binProbe.stdout.trim()}`)
  }
  fs.rmSync(dest, { recursive: true, force: true })
  fs.rmSync(home, { recursive: true, force: true })
}

// --- the registry ladder -------------------------------------------------

// Protocol-aware so the propagation retry can be exercised against a local
// lagging server (the test seam); https in production.
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? require('http') : require('https')
    mod.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      let d = ''
      res.on('data', (c) => { d += c })
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

function registryBase() {
  return (process.env.VERIFY_RELEASE_REGISTRY || 'https://registry.npmjs.org').replace(/\/$/, '')
}

// Poll knobs, overridable so the propagation-retry seam is testable fast.
function registryPollAttempts() {
  const n = Number(process.env.VERIFY_RELEASE_ATTEMPTS)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20
}
function registryPollDelayMs() {
  const n = Number(process.env.VERIFY_RELEASE_DELAY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 6000
}

function httpsBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http://') ? require('http') : require('https')
    mod.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)) }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

async function npmLadder(expectedVersion, cfg) {
  const regUrl = `${registryBase()}/${cfg.name}`
  say(`[verify-release] npm ladder: ${regUrl}`)
  // A fresh publish is served before the registry's packument indexes it --
  // npm's own "may take a few minutes to become available". Poll through
  // that window instead of red-flagging a cut that DID land: the first
  // v1.2.0 verify run read latest 1.1.0 seconds after `+ prestruct@1.2.0`
  // and failed a release that was already correct on the wire.
  const attempts = registryPollAttempts()
  const delayMs = registryPollDelayMs()
  let meta = null
  for (let i = 0; i < attempts; i++) {
    try {
      meta = await httpGetJson(regUrl)
    } catch (e) {
      say(`[verify-release] SKIP npm ladder (registry unreachable: ${e.message})`)
      return false
    }
    if (registryHasVersion(meta, expectedVersion)) break
    meta = null
    if (i < attempts - 1) {
      say(`[verify-release] registry has not settled on ${expectedVersion} yet (propagation); retry ${i + 1}/${attempts - 1} in ${delayMs / 1000}s`)
      await sleep(delayMs)
    }
  }
  if (!meta) fail(`registry never indexed ${expectedVersion} after ${attempts} polls over ${(attempts - 1) * delayMs / 1000}s - the cut did not land`)
  const latest = meta['dist-tags'] && meta['dist-tags'].latest
  if (latest !== expectedVersion) fail(`registry latest is ${latest}, expected ${expectedVersion} - either the cut did not land or a hand-moved dist-tag sits on a different version`)
  const ver = meta.versions[expectedVersion]
  if (!ver) fail(`registry serves no ${expectedVersion} at all`)
  const att = (ver.dist && (ver.dist.attestations || ver.dist.provenance)) || null
  if (!att) fail(`published ${expectedVersion} carries no provenance attestations - the OIDC trust chain did not stamp this cut`)
  say(`[verify-release] PASS registry latest == ${expectedVersion}, provenance attestations present`)

  const tarball = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-registry-')), 'served.tgz')
  let buf
  try { buf = await httpsBuffer(ver.dist.tarball) } catch (e) {
    say(`[verify-release] SKIP tarball download (${e.message})`)
    return false
  }
  fs.writeFileSync(tarball, buf)
  const got = crypto.createHash('sha512').update(buf).digest('base64')
  const wantIntegrity = (ver.dist.integrity || '').replace(/^sha512-/, '')
  if (!wantIntegrity || got !== wantIntegrity) {
    fail(`served tarball integrity ${got ? got.slice(0, 12) + '...' : '(empty)'} != registry metadata ${wantIntegrity ? wantIntegrity.slice(0, 12) + '...' : '(empty)'}`)
  }
  say('[verify-release] PASS served tarball sha512 == registry integrity metadata')
  packLadder(tarball, expectedVersion, cfg)
  return true
}

// --- the release ladder --------------------------------------------------

function ghLadder(tag, cfg, version, assetName) {
  const repo = process.env.GITHUB_REPOSITORY
  if (!repo) cap('--gh needs GITHUB_REPOSITORY (it runs inside publish.yml)')
  if (sh('gh', ['--version']).status !== 0) cap('gh CLI not available for the release ladder')
  say(`[verify-release] gh ladder: ${repo} @ ${tag}`)

  const rel = sh('gh', ['api', `repos/${repo}/releases/tags/${tag}`])
  if (rel.status !== 0) fail(`gh ladder: no release object for ${tag} - the tag pushed, the release did not: ${rel.stderr.trim().slice(0, 300)}`)
  let obj
  try { obj = JSON.parse(rel.stdout) } catch { cap(`gh api returned non-JSON: ${rel.stdout.slice(0, 200)}`) }
  const revParse = sh('git', ['rev-parse', `${tag}^{commit}`])
  if (revParse.status !== 0) cap(`git rev-parse ${tag} failed: ${revParse.stderr.trim()}`)
  const commit = revParse.stdout.trim()
  if (String(obj.tag_name || '') !== tag) fail(`release object is tagged ${obj.tag_name}, expected ${tag}`)
  // GitHub records target_commitish as the DEFAULT BRANCH NAME for a release
  // cut from an existing tag (the publish lane's `gh release create vX` shape),
  // not the tag's commit -- so a branch name is the normal, correct value, and
  // comparing it to the SHA fails every tag-based release (v1.2.0's first
  // verify run: "release v1.2.0 pinpoints main, but the tag resolves to
  // d84d13a"). Only a full SHA here is a commit claim worth checking; a ref
  // name is the creation hint, and the tag itself is the identity.
  const target = String(obj.target_commitish || '')
  if (!releaseTargetMatches(target, commit)) fail(`release ${tag} pinpoints ${target}, but the tag resolves to ${commit} - the release object and the tag disagree`)
  const isSha = /^[0-9a-f]{40}$/i.test(target)
  say(`[verify-release] PASS release object exists for ${tag} (target ${isSha ? commit.slice(0, 12) : `${target} -> tag commit ${commit.slice(0, 12)}`})`)

  // Source tarball == git archive of the release commit.
  const arch = spawnSync('git', ['archive', '--format=tar.gz', commit], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (arch.status !== 0) cap(`git archive ${commit} failed`)
  const src = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-gh-')), 'src.tgz')
  fs.writeFileSync(src, arch.stdout)
  const archList = tarList(src) // named 'release-commit.tar' style: prefix casers
  const tarFile = path.join(path.dirname(src), 'ghsrc.tgz')
  const dl = spawnSync('gh', ['api', `repos/${repo}/tarball/${tag}`, '-H', 'Accept: application/vnd.github+json'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (dl.status !== 0) cap(`gh api tarball download failed`)
  fs.writeFileSync(tarFile, dl.stdout)
  // The GH source tar carries ONE entry git archive never does: its root
  // directory ('owner-repo-sha/'). It is a directory, not a file - a
  // prefix-strip turns it into the empty string, which must be DROPPED,
  // never compared (a name that lost its identity to normalization is
  // not drift; one that kept a wrong identity is). Same rule both sides:
  // strip the top segment, drop what became empty.
  const ghEntries = sh('tar', ['-tzf', tarFile]).stdout.trim().split('\n').filter(Boolean)
  const ghNames = new Set(ghEntries.map((n) => n.replace(/^[^/]+\//, '')).filter(Boolean))
  const archNames = new Set(archList.filter(Boolean))
  const missing = [...archNames].filter((n) => !ghNames.has(n))
  const extra = [...ghNames].filter((n) => !archNames.has(n))
  if (missing.length || extra.length) {
    // JSON.stringify on purpose: an empty string must stay visible - a
    // bare [${list}] interpolates [''] into [] and hides the finding.
    fail(`GH source tarball drifts from the release commit tree - missing: ${JSON.stringify(missing.slice(0, 10))} extra: ${JSON.stringify(extra.slice(0, 10))}`)
  }
  say(`[verify-release] PASS GH source tarball == git archive of ${commit.slice(0, 12)} (${archNames.size} files, zero drift)`)

  // The release asset, when the repo attaches one: its bytes must equal the
  // registry's own integrity metadata for this version, so the GH release
  // and the npm artifact are literally the same tarball - a consumer
  // downloads one artifact either way. The registry is the authority
  // (metadata the publish lane already asserted); a mismatch is drift.
  if (assetName) {
    const meta = sh('npm', ['view', `${cfg.name}@${version}`, 'dist.integrity', '--json'])
    if (meta.status !== 0) cap(`npm view ${cfg.name}@${version} dist.integrity failed: ${meta.stderr.trim()}`)
    let want
    try { want = JSON.parse(meta.stdout) } catch { cap(`npm view returned non-JSON: ${meta.stdout.slice(0, 200)}`) }
    want = String(want || '').replace(/^sha512-/, '')
    if (!want) fail(`the registry carries no integrity metadata for ${cfg.name}@${version} - cannot judge the release asset`)
    const assetApi = sh('gh', ['api', `repos/${repo}/releases/tags/${tag}`])
    let assets = []
    try { assets = JSON.parse(assetApi.stdout).assets || [] } catch { cap('gh api returned non-JSON assets') }
    const asset = assets.find((x) => x.name === assetName)
    if (!asset) fail(`the release carries no asset named ${assetName} (found: ${JSON.stringify(assets.map((x) => x.name))})`)
    const dlAsset = spawnSync('gh', ['api', `repos/${repo}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    if (dlAsset.status !== 0) cap(`gh api asset download failed for ${assetName}`)
    const got = crypto.createHash('sha512').update(dlAsset.stdout).digest('base64')
    if (got !== want) fail(`release asset ${assetName} sha512 ${got.slice(0, 12)}... != registry integrity ${want.slice(0, 12)}... - the GH release and the npm artifact are not the same bytes`)
    say(`[verify-release] PASS release asset ${assetName} sha512 == registry integrity (same bytes as npm)`)
  }

  fs.rmSync(path.dirname(src), { recursive: true, force: true })
}

// ------------------------------------------------------------------------- 

function main() {
  const a = process.argv.slice(2)
  // Config: everything repo-specific arrives as flags; the script itself is
  // one identical file across the family.
  const checkout = readCheckout()
  const cfg = { name: checkout.name, exports: null, probes: [], extraForbidden: [], allowed: [] }
  const exportsIdx = a.indexOf('--exports')
  if (exportsIdx !== -1) cfg.exports = a[exportsIdx + 1]
  const forbiddenIdx = a.indexOf('--forbidden')
  if (forbiddenIdx !== -1) {
    if (a[forbiddenIdx + 1]) cfg.extraForbidden = String(a[forbiddenIdx + 1]).split(',').filter(Boolean)
  }
  // --allowed (alias --allow): prefixes de-asserted from the forbidden scan
  // for this invocation.
  const allowedIdx = a.findIndex((v) => v === '--allowed' || v === '--allow')
  if (allowedIdx !== -1) {
    if (a[allowedIdx + 1]) cfg.allowed = String(a[allowedIdx + 1]).split(',').filter(Boolean)
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--probe') {
      if (!a[i + 1]) cap('--probe needs a js expression')
      cfg.probes.push(a[i + 1])
    }
  }
  const wantPack = a.includes('--pack')
  const wantNpm = a.includes('--npm')
  const wantGh = a.includes('--gh')
  if (!wantPack && !wantNpm && !wantGh) {
    say('usage: verify-release [--pack <tgz>] [--npm] [--gh --tag vX.Y.Z] [--asset <name>] [--version X.Y.Z] [--exports k1,k2,...] [--probe "<js>"] [--forbidden p1/,p2/] [--allowed p1/,p2/]')
    process.exit(2)
  }
  const versionArgIdx = a.indexOf('--version')
  const version = versionArgIdx !== -1 ? a[versionArgIdx + 1] : checkout.version

  const tagIdx = a.indexOf('--tag')
  if (wantGh && (tagIdx === -1 || !a[tagIdx + 1])) cap('--gh needs --tag vX.Y.Z')
  const assetIdx = a.indexOf('--asset')
  const assetName = assetIdx !== -1 ? a[assetIdx + 1] : null
  if (assetIdx !== -1 && !assetName) cap('--asset needs an asset file name')
  if (assetName && !wantGh) cap('--asset is a --gh modifier; pass --gh --tag vX.Y.Z --asset <name>')

  ;(async () => {
    let packTarget = null
    if (wantPack) {
      const i = a.indexOf('--pack')
      packTarget = a[i + 1]
      if (!packTarget) cap('--pack needs a tarball path')
    }
    if (wantNpm) {
      const served = await npmLadder(version, cfg)
      if (served) packTarget = null // the registry ladder already ran the pack ladder on the SERVED tarball
      if (!served && !wantPack) {
        say('[verify-release] registry unreachable and no --pack target given; nothing verified')
        process.exit(1)
      }
    }
    if (wantPack && packTarget) packLadder(packTarget, version, cfg)
    if (wantGh) {
      const gitOk = sh('git', ['rev-parse', '--git-dir'])
      if (gitOk.status !== 0) cap('not a git worktree; the gh ladder needs the release commit')
      ghLadder(a[tagIdx + 1], cfg, version, assetName)
    }
    say('[verify-release] VERIFIED: everything it checked is checked.')
  })().catch((e) => cap(e.message))
}

// The pure helpers are exported for the battery (the family release-verify
// test pins releaseTargetMatches + registryHasVersion). main() runs only when
// the file is executed as the CLI, never on a require() from a test.
module.exports = { releaseTargetMatches, registryHasVersion }

if (require.main === module) main()
