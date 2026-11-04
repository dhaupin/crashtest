// check-action-pins.cjs - the family house rule "pins, never floats" (packstruct#69).
//
// Every GitHub Action `uses:` must name a 40-hex commit SHA, never a floating
// tag or branch (`@v4`, `@main`). A floating ref lets the action that runs in
// CI change under us between runs with no commit here - the supply-chain
// surface eyestruct, govstruct, and monoforge all closed; packstruct's
// publish.yml already pinned, but docs/corpus/crashtest/test floated. This
// guard makes the rule mechanical: a future float fails in CI, not in review.
//
// Allowed refs:
//   - a 40-hex SHA (with an optional `# vN` comment, which we also want)
//   - a local action / reusable workflow (`./path/to/action`)
// Docker refs (`docker://image`) are refused too: an unpinned image is the
// same float in a different costume.
//
// No dependencies: reads the workflow files, matches the shape.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Optional argv[2] overrides the workflows dir so the guard's own battery can
// drive it over temp fixtures (both ways), per the house test rule.
const OVERRIDE = Boolean(process.argv[2]);
const WORKFLOWS = OVERRIDE ? path.resolve(process.argv[2]) : path.join(ROOT, '.github', 'workflows');
// The repo root: this repo by default; when a fixture workflows dir is passed,
// its parent stands in, so the action.yml leg is testable the same way.
const REPO = OVERRIDE ? path.dirname(WORKFLOWS) : ROOT;
const SHA_RE = /^[0-9a-f]{40}$/;

const problems = [];
let checked = 0;

if (!fs.existsSync(WORKFLOWS)) {
  console.error(`ACTION PINS: FAIL (${WORKFLOWS} is missing)`);
  process.exit(1);
}

// Scan the workflows AND the repo's composite Action manifest (action.yml): a
// `uses:` float there seeds every consumer repo that adds the Action - the same
// supply-chain surface, which the workflow scan alone never saw (crashtest's
// action.yml floated setup-node/upload-artifact until this leg).
const targets = fs
  .readdirSync(WORKFLOWS)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .sort()
  .map((name) => ({ name, file: path.join(WORKFLOWS, name) }));
const actionFile = path.join(REPO, 'action.yml');
if (fs.existsSync(actionFile)) targets.push({ name: 'action.yml', file: actionFile });

for (const { name, file } of targets) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Match `uses: <ref>` with any indentation / list dash.
    const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)\s*(?:#.*)?$/);
    if (!m) return;
    const ref = m[1].replace(/^["']|["']$/g, '');
    checked++;

    // Local actions and reusable workflows are in-repo - nothing to pin.
    if (ref.startsWith('./')) return;

    // Everything else must be owner/repo@<40-hex>.
    const at = ref.lastIndexOf('@');
    const sha = at === -1 ? '' : ref.slice(at + 1);
    if (at === -1 || !SHA_RE.test(sha)) {
      problems.push(`${name}:${i + 1}: floating ref "${ref}" - pin to a 40-hex SHA`);
      return;
    }
    // A SHA with no tag comment is legal but unreadable; nudge (not a failure).
    if (!/#\s*\S/.test(line)) {
      problems.push(`${name}:${i + 1}: "${ref}" is pinned but carries no "# vN" tag comment`);
    }
  });
}

// A missing tag comment is a readability nudge, not a supply-chain break, so
// it does not fail the gate - but it prints, because the family writes them.
const hard = problems.filter((p) => !/tag comment/.test(p));
const soft = problems.filter((p) => /tag comment/.test(p));

if (hard.length > 0) {
  console.error(`ACTION PINS: FAIL (${hard.length} floating ref(s) - the house rule is "pins, never floats")`);
  for (const p of hard) console.error('  ' + p);
  process.exit(1);
}
for (const p of soft) console.log('  note: ' + p);
const wfCount = targets.filter((t) => t.name !== 'action.yml').length;
const extra = targets.length > wfCount ? ' + action.yml' : '';
console.log(`ACTION PINS: PASS (${checked} ref(s) across ${wfCount} workflow(s)${extra}, all SHA-pinned)`);
