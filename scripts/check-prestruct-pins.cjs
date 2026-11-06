// check-prestruct-pins.cjs - the family house rule "one prestruct floor".
//
// prestruct is the family prerender engine. Every web surface consumes it, and
// the version had drifted: coreforge/govstruct/packstruct declared `^1.0.0`
// (whose lockfiles froze at 1.1.0, missing the 404-head fix), crashtest pinned a
// bare github commit, vant pinned exact 1.1.0, while eyestruct/monoforge/
// poststruct/gistory were on `^1.2.0`. Nothing held the line, so the fleet
// forked - the same drift class the docs-lane consolidation closed for docs.
// This guard makes the floor mechanical: every `prestruct` declaration must be a
// semver spec at or above the family floor (never a bare protocol float), and a
// committed lockfile must resolve at or above it too. A future fork fails in CI,
// not in review.
//
// The floor moves only on proof, and the move is one deliberate edit here.
//
// No dependencies: reads package.json (and its sibling lockfile), matches shape.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Optional argv[2] overrides the repo root so the guard's own battery can drive
// it over temp fixtures (both ways), per the house test rule.
const OVERRIDE = Boolean(process.argv[2]);
const REPO = OVERRIDE ? path.resolve(process.argv[2]) : ROOT;

// The family prestruct floor: prestruct >= 1.3.0 - the release that closes the
// 404 head (#33/#42), the react-router-7 prerender seam (#68), and the SSRF
// guard on the opt-in external audit lane.
const FLOOR = { major: 1, minor: 3 };
const FLOOR_LABEL = `^${FLOOR.major}.${FLOOR.minor}.0`;

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.prestruct', '.bundle', 'vendor']);

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'package.json') out.push(p);
  }
  return out;
}

/** True when a concrete version string is below the family floor. */
function belowFloor(version) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major < FLOOR.major || (major === FLOOR.major && minor < FLOOR.minor);
}

const problems = [];
let checked = 0;

for (const pkgPath of walk(REPO)) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    continue;
  }
  const spec =
    (pkg.devDependencies && pkg.devDependencies.prestruct) ??
    (pkg.dependencies && pkg.dependencies.prestruct);
  if (spec === undefined) continue;
  checked++;
  const rel = path.relative(REPO, pkgPath).replace(/\\/g, '/');

  // 1. The declared spec must be a semver pin (^ / ~ / exact), never a bare
  //    protocol float (github:, file:, git+, workspace:, *, latest).
  const m = String(spec).match(/^([\^~])?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    problems.push(
      `${rel}: prestruct "${spec}" is not a semver pin - the family floor is ${FLOOR_LABEL} (a github:/file:/bare float is unmanaged)`,
    );
    continue;
  }

  // 2. Its floor must be at or above the family floor.
  const major = Number(m[2]);
  const minor = Number(m[3]);
  if (major < FLOOR.major || (major === FLOOR.major && minor < FLOOR.minor)) {
    problems.push(
      `${rel}: prestruct "${spec}" is below the family floor ${FLOOR_LABEL} (the fixes it needs landed in 1.3.0)`,
    );
  }

  // 3. A committed lockfile must resolve at or above the floor too: a fixed spec
  //    with a stale lock still installs the old engine (the ^1.0.0 freeze).
  const lockPath = path.join(path.dirname(pkgPath), 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch {
      lock = null;
    }
    const resolved =
      lock && lock.packages && lock.packages['node_modules/prestruct']
        ? lock.packages['node_modules/prestruct'].version
        : null;
    if (resolved && belowFloor(resolved) === true) {
      problems.push(
        `${path.relative(REPO, lockPath).replace(/\\/g, '/')}: resolves prestruct ${resolved}, below the family floor ${FLOOR_LABEL} - reinstall to refresh the lock`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`PRESTRUCT PINS: FAIL (${problems.length} finding(s) - the family floor is ${FLOOR_LABEL})`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`PRESTRUCT PINS: PASS (${checked} declaration(s), all at or above ${FLOOR_LABEL})`);
