#!/usr/bin/env node
/**
 * scripts/ship-from-download.cjs - the phone publish lane (generic; the
 * Termux recipe, scripted). FAMILY-REUSABLE: this file has no repo imports
 * - copy it as-is into any repo in the family (or anywhere) and it stages
 * that repo's zip-extracted tree the same way. The only repo-specific
 * surface is the tree you point it at and the package.json that tree
 * carries; the lane itself is product-agnostic.
 *
 * A GitHub zip carries no .git and no node_modules, and /storage/emulated
 * is a FUSE mount that refuses symlinks (EACCES, errno -13) - installs and
 * publishes must happen inside the Termux home. This script is that move,
 * made repeatable:
 *
 *   NPM_TOKEN=<token> node scripts/ship-from-download.cjs \
 *     --target /storage/emulated/0/Download/<repo>-main/<repo>-main \
 *     --root ~/web/<repo>-main               [--dry-run] [--clean]
 *
 * (or pass --token-file <path> whose only line is the token - same
 * guarantee, friendlier for a saved file; NPM_SHIP_TOKEN is accepted as a
 * fallback env name for machines where NPM_TOKEN is already claimed).
 *
 * What it does - named refusals, exit contract 0 ok / 1 child failure
 * (npm's own code surfaces) / 2 precondition refusal. Never a stack
 * trace, never a bare error:
 *   1. refuse anything that is not a readable npm package tree (a
 *      package.json that parses and carries a name; a wrong or truncated
 *      zip is caught HERE, before any install or publish)
 *   2. refuse a ROOT that is shared storage, $HOME itself, the same tree
 *      as the target, or non-empty (prints the exact `rm -rf` line; the
 *      script never deletes on its own)
 *   3. cp -r target -> root (mkdir -p the parent first)
 *   4. npm ci when package-lock.json exists in the tree, else npm install
 *   5. stage a ONE-LINE .npmrc whose token comes from the ENV at publish
 *      time (`${NPM_TOKEN}` expansion) - the raw token never lands in a
 *      file, never in argv (ps-safe), never in the log, and the staged
 *      file is unlinked in a finally, publish failing or not
 *   6. npm publish --dry-run (with --dry-run) or npm publish - the
 *      repo's own prepublishOnly gate (whatever it is) runs exactly as on
 *      any other machine; the ship script only gets you to the launchpad,
 *      the gate still rules
 *   7. with --clean: remove the staged root AFTER the run (success or
 *      failure - a failed run should not block the retry with
 *      ROOT_OCCUPIED), and log exactly what it did. Without --clean the
 *      script never deletes anything; with it, it removes ONLY the root
 *      it staged in this run, never the target, never anything else
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const TOKEN_ENV = 'NPM_TOKEN'
const TOKEN_ENV_ALIAS = 'NPM_SHIP_TOKEN'

function expandHome(p) {
  if (p === '~') return os.homedir()
  return p.replace(/^~(?=\/|$)/, os.homedir())
}

function refuse(code, msg, fix) {
  return {
    code: 2,
    out: [`ship[${code}]: ${msg}`, fix ? `ship: fix: ${fix}` : null].filter(Boolean),
  }
}

/** token shape facts only - never its value */
function tokenProblems(t) {
  if (!t) return `no token found - set ${TOKEN_ENV} (env) or --token-file <path>`
  if (/[\s\x00-\x1f\x7f]/.test(t)) return 'the token carries whitespace or a control character - a token is one printable line'
  if (t.length < 20) return 'the token is too short to be an npm token (npm tokens are npm_-prefixed automation/granular tokens)'
  if (!/^npm_/.test(t)) return 'the token does not start with "npm_" - refusing to guess (an id or a password is not a publish token)'
  return null
}

/**
 * The lane, as a function of its inputs, with the process runner injectable
 * so tests drive the whole thing offline (no npm, no network).
 */
function ship(opts = {}) {
  const target = opts.target ? expandHome(String(opts.target)) : null
  const rootArg = opts.root ? expandHome(String(opts.root)) : null
  const dryRun = Boolean(opts.dryRun)
  const run = opts.run || ((cmd, args, o) => require('node:child_process').spawnSync(cmd, args, { stdio: 'inherit', ...o }))
  const out = []
  const log = (s) => { out.push(s); if (opts.log) opts.log(s) }

  const deny = (c, m, f) => { const r = refuse(c, m, f); for (const l of r.out) log(l); return r }
  if (!target) return deny('MISSING_TARGET', 'no --target given - the zip-extracted tree to stage', '--target /storage/emulated/0/Download/<repo>-main/<repo>-main')
  if (!rootArg) return deny('MISSING_ROOT', 'no --root given - where inside the phone home the tree is staged', '--root ~/web/<repo>-main')

  const root = path.resolve(rootArg)
  const targetStat = fs.existsSync(target) && fs.statSync(target)
  if (!targetStat || !targetStat.isDirectory()) {
    return deny('MISSING_TARGET', `--target is not a readable directory: ${target}`, '--target <zip-extracted <repo>-main folder>')
  }
  const targetPkgPath = path.join(target, 'package.json')
  if (!fs.existsSync(targetPkgPath)) {
    return deny('NOT_A_PACKAGE_TREE', `--target carries no package.json: ${target}`, 'point --target at the extracted repo folder (<repo>-main), not its parent zip dir')
  }
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf8'))
  } catch {
    return deny('BAD_PACKAGE_JSON', `--target's package.json does not parse: ${targetPkgPath}`, 'the zip may be truncated - re-download from GitHub')
  }
  if (!pkg || typeof pkg.name !== 'string' || !pkg.name.trim()) {
    return deny('BAD_PACKAGE_NAME', `--target's package.json carries no "name" - not a publishable npm tree: ${targetPkgPath}`, 'point --target at the repo folder that owns the package')
  }
  const name = pkg.name.trim()
  const version = String(pkg.version || '0.0.0')

  if (root.startsWith('/storage/') || root === '/sdcard' || root.startsWith('/sdcard')) {
    return deny('SHARED_STORAGE_ROOT', `--root is on shared storage (symlinkless FUSE): ${root}`, 'stage INSIDE the Termux home, e.g. ~/web/<repo>-main')
  }
  if (root === path.resolve(os.homedir())) {
    return deny('HOME_ROOT', '--root is the home directory itself - copying the repo over it would bury your dotfiles', 'use a subfolder, e.g. ~/web/<repo>-main')
  }
  if (path.resolve(target) === root) {
    return deny('ROOT_SAME_AS_TARGET', '--root and --target are the same directory', 'the staged copy must be a distinct folder inside the home')
  }
  let rootStat = null
  try {
    rootStat = fs.statSync(root)
  } catch { /* absent is the common case */ }
  if (rootStat && !rootStat.isDirectory()) {
    return deny('ROOT_NOT_DIR', `--root exists and is not a directory: ${root}`, 'remove or rename it, then re-run')
  }
  if (rootStat) {
    const occupied = fs.readdirSync(root).length > 0
    if (occupied) {
      return deny('ROOT_OCCUPIED', `--root exists and is not empty: ${root}`, `run \`rm -rf ${root}\` first (the ship lane never deletes on its own), or pass a fresh --root`)
    }
  } else {
    fs.mkdirSync(path.dirname(root), { recursive: true })
  }

  log(`ship: staging ${name}@${version}`)
  log(`  from: ${target}`)
  log(`  into: ${root}`)
  fs.cpSync(target, root, { recursive: true })
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    return deny('COPY_FAILED', 'staged root carries no package.json after the copy - the copy did not land', 'check free space in the Termux home and re-run')
  }

  const lockPath = path.join(root, 'package-lock.json')
  const installCmd = fs.existsSync(lockPath) ? 'ci' : 'install'
  // npmrcPath lives in FUNCTION scope, not try scope: the finally below
  // must see it to unlink (a try-scoped const would make the finally's
  // reference a ReferenceError, silently swallowed by its own catch -
  // the staged secret-file would survive, the leak the test refused).
  const npmrcPath = path.join(root, '.npmrc')
  try {
    log(`ship: npm ${installCmd} (staged tree)`)
    const installed = run('npm', [installCmd], { cwd: root })
    if ((installed.status || 0) !== 0) {
      log(`ship: npm ${installCmd} failed (exit ${installed.status}) - fix the install first; publishing an unproven tree is not on the menu`)
      return { code: installed.status || 1, out }
    }

    const token = opts.token != null ? String(opts.token) : null
    if (tokenProblems(token)) {
      return deny('BAD_TOKEN', tokenProblems(token), 'create a granular publish token on npmjs.com (Automation type, no 2FA prompt) and pass it via env or --token-file')
    }

    if (fs.existsSync(npmrcPath)) {
      return deny('NPMRC_EXISTS', `the staged tree already carries an .npmrc: ${npmrcPath}`, 'inspect it and remove it if it is not yours - the lane stages its own and refuses to clobber')
    }
    // The staged file holds the EXPANSION, not the token: npm expands the
    // ${ENV} placeholder from the child process env, so the raw token lives
    // only in memory, never on disk, never in argv. The child env always
    // carries NPM_TOKEN (even when the token arrived via --token-file) so
    // the expansion resolves.
    fs.writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=\${${TOKEN_ENV}}\nalways-auth=true\n`)
    const publishArgs = ['publish']
    if (dryRun) publishArgs.push('--dry-run')
    log(`ship: npm ${publishArgs.join(' ')} (the repo's prepublishOnly gate runs inside this)`)
    const pub = run('npm', publishArgs, { cwd: root, env: { ...process.env, [TOKEN_ENV]: token } })
    if ((pub.status || 0) !== 0) {
      log(`ship: publish failed (exit ${pub.status}) - if npm demanded an OTP, use an automation-type token or set 2FA to token-only on the account level`)
      return { code: pub.status || 1, out }
    }
    log(dryRun ? 'ship: dry-run OK (nothing published)' : `ship: PUBLISHED ${name}@${version}`)
    return { code: 0, out }
  } catch (err) {
    return deny('PUBLISH_THROW', `publish step threw: ${err && err.message}`, 'send the output - this is a lane bug, not a machine fact')
  } finally {
    try { fs.unlinkSync(npmrcPath) } catch { /* already gone is fine */ }
    // --clean fires on EVERY exit after staging - success, publish
    // failure, install failure, even the refusals - because a failed run
    // must not block the retry with ROOT_OCCUPIED. Without --clean the
    // lane never deletes anything. A delete failure is advisory, never a
    // publishing verdict (the run keeps its own exit code).
    if (opts.clean) {
      try {
        fs.rmSync(root, { recursive: true, force: true })
        log(`ship: --clean removed the staged root (${root}) - the next run stages fresh`)
      } catch (err) {
        log(`ship[CLEAN]: could not remove the staged root (${root}) - ${err && err.message} - remove it by hand before the retry`)
      }
    }
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const tokenFile = flag('--token-file')
  const token = tokenFile != null
    ? fs.readFileSync(expandHome(tokenFile), 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
    : (process.env[TOKEN_ENV] != null ? process.env[TOKEN_ENV] : process.env[TOKEN_ENV_ALIAS])
  const res = ship({
    target: flag('--target'),
    root: flag('--root'),
    dryRun: argv.includes('--dry-run'),
    clean: argv.includes('--clean'),
    token,
    log: (s) => process.stdout.write(s + '\n'),
  })
  // the log seam already streamed every line (streamed AND collected); the
  // CLI must not print the collection twice (double log, the same shape
  // bug the ledger contract refuses) - exit on the lane's exit contract.
  process.exit(res.code)
}

module.exports = { ship, tokenProblems, expandHome, TOKEN_ENV, TOKEN_ENV_ALIAS }
