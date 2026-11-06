# The packstruct spec, version 1

One `/packs` system, many hosts. This document is normative for any app that loads packs from a `packs/` directory and for anyone authoring a pack.

**Revision history.** v1.0.0 froze the manifest table against crashtest's production reality. v1.1.0 is the additive-first patch section 6 promises: five rows, every one citing an ENGINE receipt (behavior at least one host loader already holds), none moving `schemaVersion` and none changing a conforming host's behavior. See section 8 for the adopted rows.

**Schema base (verified 2026-10-24, crashtest#19 receipts):** every crashtest production pack ships schemaVersion 1 with exactly the shared field set (8/8 conform, nothing drifted since the 2026-10-23 audit). The id space is clean: 44 pack ids across the 8 packs, zero collisions pack-vs-pack and pack-vs-library. v1 formalizes that reality; hosts either already conform (crashtest) or adopt it fresh (poststruct). Baseline watch: if a host fleet bumps its manifests, the spec formalizes the new number - the spec tags whatever the fleet ships. Ordering ruled on crashtest#19: code first, spec formalizes after; nothing schema-changing is hidden on the engine side.

## 1. Directory contract (all hosts)

```
packs/public/<pack-name>/
  pack.json        # REQUIRED, fields per section 2
  <entry file>     # REQUIRED: the file pack.json's "entry" names
```

**The contract root.** The lint/audit contract root is the packs ROOT - `<dir>/` with its `public/` (tracked) and `local/` (gitignored WIP) children - never `packs/public/` itself. This spec page is the canonical statement of that rule; a host that mirrors it in its own CLI reference cites this section rather than restating it (crashtest's `lint-packs` page is the first mirror, `docs/reference/cli.md`).

## 2. pack.json (frozen for v1)

| Field | Rules |
|---|---|
| `schemaVersion` | integer, MUST be `1` |
| `name` | kebab-case string, MUST match its directory name (mismatch = load refuse) |
| `description` | one-line, human-readable |
| `version` | dotted MAJOR.MINOR[.PATCH] |
| `entry` | relative path inside the pack dir, MUST exist (missing entry = instant, nameable refusal - the crashtest#16 lesson is a norm now). "Inside the pack dir" is PHYSICAL, not merely lexical: an entry whose resolved target escapes the pack (via `..`, an absolute path, or a symlink pointing outside) refuses |
| `armedByKey` | OPTIONAL string. Present: the host MAY run its arming-key ceremony before activation - presence semantics only, so an EMPTY value is "present, not yet armed" (folded from the crashtest#25 matrix fold: the engine treats empty as valid, so a non-empty rule would be a check the SPEC never promised). Absent: the host's own default lifecycle governs |

**Lint-assist key.** `armedCoverage` (added v1.1.0, section 8 row 6) is OPTIONAL: a pack's own declaration of the relative path to its armed end-to-end row - the test that runs the pack against a stub target with its vocabulary armed. It is NOT a shared fact: no conforming loader assigns it meaning. It exists for `packstruct lint`, which CONFIRMS the declared file ships inside the pack dir (a declaration naming a missing or escaping path refuses as `armed-coverage` - the vacuous-green class made loud) and never RUNS the row; runs are the host's business. Absent is the quiet default and never colors a verdict (packstruct#27).

**Host-owned acknowledged keys.** The table above is the shared-facts column: fields every conforming loader assigns meaning to. Some hosts additionally carry their own optional manifest keys with host-side shape validation. For v1, three are acknowledged by name because crashtest's loader already validates them (ruled on crashtest#19); a fourth joined in v1.1.0 (section 8 row 1):

- `env` - the env-claims block (`d1`/`kv`/`routes`, plus optional `env.seed`)
- `plugins` - bundled plugin imports, resolved against the pack dir
- `package` - optional npm name for the pack
- `implements` - optional string acknowledging the spec the pack builds against, formatted `packstruct@<MAJOR>` or an exact pin `packstruct@1.0.0` (added v1.1.0, section 8 row 1). `packstruct lint` validates FORMAT ONLY and reports a non-conforming shape as a WARNING, never a refusal; absence is the quiet default and never colors a verdict.

These are **acknowledged, not shared facts**: the spec documents that they may appear and that the HOST owns their semantics and shape rules. Their presence is never a spec violation, `packstruct lint` must never refuse a pack for carrying them, and a future host naming a fourth host-owned key extends this list in a patch revision, not a schemaVersion bump.

Extra manifest keys and extra files beside the entry are allowed as minimum-spec (the loader assigns no shared meaning to undeclared keys; e.g. crashtest's cve-feed ships a snapshot.json beside its entry, which is fine).

**Receipts per frozen row** (added per dhaupin/packstruct#4: every row cites the engine evidence it mirrors, so "conforming to spec" and "what this one repo does" never blur). Engine rows are from crashtest `fc93ca6`, `src/packs/loader.js` - the packstruct#19-audited tree:

- `schemaVersion` MUST be `1` — enforced: `loader.js:77-78` (unsupported schemaVersion throws, "have: 1").
- `name` kebab-case — enforced: `loader.js:98` throws on non-kebab names.
- `name` MUST match its directory — the engine's narrower shape: packs are loaded FROM their directories and the shared `seen` map keys identity by manifest name (`loader.js:372, :389-391`), so a name/dir disagreement surfaces as a loud collision or misattribution, never silent success. The linter deliberately enforces the stricter contract (name == dir) at author time; engine parity is tracked in dhaupin/packstruct#2.
- `entry` MUST exist — the engine admits a default entry (`loader.js:101`) and a declared file that doesn't ship fails at import with a one-line, nameable error naming the pack (`loader.js:394-396`) — the crashtest#16 class, a norm either way. The linter runs the detection at author time via file existence, so a broken manifest refuses before any host loads it.
- `version` dotted semver-ish — pack-owned semver; the manifest reality is the 8/8 #19 audit (every pack ships it), and the version is decoupled from every host's and from packstruct's own release cadence (see section 6).
- `description` non-empty — enforced: `loader.js:59, :71-73` (REQUIRED_KEYS throws on missing fields).
- `armedByKey` optional — engine shape contract: absent = unarmed-but-loadable (crashtest#19 ruling folded into the table).
- Host-owned `env`/`plugins`/`package` — acknowledged and shape-validated: `loader.js:24-35` (comment block), `:110` (validateEnvClaims), `:398-401` (bundled plugin imports), `:363-364` (seed passthrough).
- Id collisions refuse at load — enforced: `loader.js:389-391` (shared `seen` across surfaces: one loud error naming both origins).

## 3. Entry profiles (per host, declared here)

An entry is an ES module with a default export. The manifest/dir/entry surface never forks between hosts; execution semantics are declared as profiles:

- **`scenario` profile (crashtest):** default export = a module object carrying `name`, `description`, and an `attacks[]` array (attack names kebab-case, each with a `run` function or a `steps` chain). Contains hostile scenarios executed against a transport; hosts of this profile provide isolation (fake transport, opt-out postures) and support the `armedByKey` ceremony. The module-shape contract is HOST-OWNED in full: it lives with the host (crashtest's `reference/scenario-contract`); `profiles/scenario.md` links to it rather than copying it - doc drift is worse than indirection (ruled on crashtest#19; the `register(ctx)` shape in earlier drafts of this section was stale, deleted against the engine truth at `fc93ca6` per the engine-first rule). The canonical profile pages live with the spec (one address, same ruling): `profiles/scenario.md` and `profiles/check.md`.
- **`check` profile (poststruct):** default export = `{ checks: [Check] }`. Declarative pure-reading verifiers over files on disk. No transport, no network by default. Arming defaults to config enumeration: being listed in the host's `packs:` config IS the arm; no separate key ceremony.

A host declares which profile(s) it loads. A pack never changes its own semantics based on the host.

## 4. Lifecycle norms (all hosts)

- **Explicit loads only.** A pack runs because the host's config enumerates it. Remote/npm sources are NOT part of v1; adding them requires an explicit spec version bump and stays no-auto-download.
- **Namespaced ids.** Pack check/scenario ids live in a pack-slug namespace in the host's id space. Cross-namespace collision at load time = refuse to start, never silent dedupe.
- **Self-audit fixtures.** Every pack ships `test/fixtures/` proving its contents do what they claim. A pack whose fixtures fail fails its own CI host-first. (Crashtest backfill note: fixtures are the one norm its production packs do not ship yet; it is a lifecycle requirement, not a manifest field, so schemaVersion does not move for it.)

## 5. Errors (nameable, instant)

A conforming loader refuses with a one-line error naming the pack and the broken norm the moment it sees the violation: wrong schemaVersion, name/dir mismatch, missing entry file, id collision. Never a deep stack trace and never silent success.

## 6. Versioning

- Additive-first: v2 adds optional manifest fields; removing/renaming is a major spec bump requiring a migration note.
- Hosts pin the spec they implement (`implements: packstruct@1` in host docs).
- **Pack version is the pack's own semver, decoupled from every other release cadence.** A `pack.json` `version` bumps only when that pack's own surface changes - not when packstruct ships a new linter, not when a consumer ships a new CLI or spec revision. House policy verbatim from crashtest's AGENTS.md (where it is enforced by the governance suite): pack manifests carry their own semver - never bump those for CLI-level releases. The shipped-stable pack keeps its shape: a consumer adopting a newer linter or a newer consumer build does not re-roll packs it already froze.
- **Spec ↔ tool decoupling is the mirror image:** packstruct's own version (0.9.x manual, 1.0.0 OIDC per its DEPLOY.md) tracks the linter and harness surface only. A lint release that adds checks under the same frozen schema is a TOOL semver bump that leaves this document's v1 number alone.

## 7. Conformance tooling

- `packstruct lint <packs-dir>`: manifest validation + entry existence + name/dir match (section 2, plus directory-contract checks from section 1). Exit 0 conforming / 1 violations / 2 usage error.
- `packstruct lint <packs-dir> --deep`: the same shallow pass, plus the section-3/4/5 norms at author time - import each declared entry in an isolated child (an entry that fails to import or carries no default export refuses as `entry-import`/`entry-default-export`) and census the declared ids (a duplicate within a pack, a cross-pack name/id collision, or a collision against a `--against <lib>` host library refuses as `id-duplicate`/`id-collision`/`id-library-collision`). These are the spec's own load-time refusals surfaced early, never new norms; a hostile entry is killed on a timeout or output cap and refused nameably, never run in the linter's own process.
- `packstruct audit-conformance <repo-dir> --loader "<cmd> {packs}"`: the conformance harness. Bundled verdict-claiming cases (one clean bundle, one per section-5 refusal norm, plus a name-collision pair, plus one `env-claims` bundle carrying the section-2 host-owned `env` block) are materialized into scratch roots and the HOST's own loader command runs over each. A conforming loader exits 0 on the clean bundle and exits non-zero AND names the offending pack on every violation bundle (section 5: nameable refusals; identity matches, refusal wording stays host-owned). The `env-claims` bundle is an ACCEPT case: a pack that merely declares claims is conforming, so a loader must never refuse it. `--claims` additionally requires the loader to ECHO the declared block (one `packstruct:env-claims <claims-json>` stdout line) on that case - a loader that silently ignores `env` is named instead of passing, and one that refuses the spec'd key is named as such (packstruct#71). Same exit ladder: 0 all cases honored / 1 any case failed / 2 usage.

## 8. v1.1.0 - the additive rows (adopted 2026-10-29)

Six rows, each citing an ENGINE receipt, none moving `schemaVersion` and none changing a conforming host's behavior. Full proposal (byte-pinned at `dd05454` in dhaupin/gistory): `labs/` receipts and issue dhaupin/packstruct#19.

1. **`implements`** - the optional host-owned acknowledgement key (section 2). FORMAT ONLY: `packstruct@<MAJOR>` or an exact pin `packstruct@1.0.0`; a non-conforming shape is a lint WARNING, never a refusal; absence is the quiet default. Receipt: eyestruct and poststruct both carry `packstruct@1.0.0` as an exact devDependency, so the pin discipline exists but had no manifest surface.
2. **The `--loader` template contract, formalized.** `{packs}` substitutes the materialized case pack's DIRECTORY path (never a tarball, never a URL). The loader command runs with CWD = the audited repo root. Exit contract: 0 on the clean bundle; non-zero AND a stderr line naming the offending pack on every violation bundle. The loader runs with NO network and NO implicit host config. A loader that TIMES OUT or crashes is verdict "1 any case failed", never 0, and the harness names which loader failed. Receipt: both live harnesses (poststruct's `run-packs.mjs`, eyestruct's `run-packs.cjs`) hold every clause.
3. **ESM-default entries, stated plainly.** The entry's DEFAULT EXPORT is the loaded thing. The module format (ESM `export default` / CJS `module.exports`) is the pack's own concern; a loader per-profile decides what run/execute shape it accepts on that default. Receipt: the audit accepted eyestruct's and poststruct's CJS-default fixtures as CORRECT, not as exceptions.
4. **Interop routes are a LIFECYCLE NORM, not a manifest field.** A pack MAY declare an interop route (run a sibling leg's gate, fork work to a sibling CLI, consume a sibling's runtime) ONLY through the sibling's public CLI surfaces - never by import, and never by guessing a path when an `npx` resolution is available. Receipt: poststruct's `eyes-reference` routes SVG verification through eyestruct's raster gate by invoking eyestruct the TOOL.
5. **Companion-pin receipts.** Hosts carry the packstruct pin they conform to as an EXACT devDependency, bumped deliberately and receipted per host. A host may lag another host's pin; its `implements` row and CI battery reveal the state. Nothing forces synced bumps - it forces the SYNCHRONIZED RECEIPT when a bump happens.
6. **`armedCoverage` - the pack-lane coverage declaration (section 2).** OPTIONAL string: the relative path to the pack's armed end-to-end row. `packstruct lint` CONFIRMS the declared file ships inside the pack dir (a declaration naming a missing or escaping path refuses as `armed-coverage` - the vacuous-green class made loud); it never RUNS the row. Absent is the quiet default and never colors a verdict. Receipt: packstruct#27 - crashtest walk rounds 18-20 found pack defects invisible to shape lint (oracle bugs that only fire on a real wire), so the row exists to make "declared armed coverage that isn't there" nameable at author time. This row makes SPEC §2 promise the `armed-coverage` refusal `src/lint.mjs` already emitted - before it, the linter shipped a check the SPEC never promised.

## 9. The walk-exit (promotion) rule (v1.1.0)

A manual walk is not done until nothing it found is uncommissioned: a walk is not finished while any finding it produced is still unrecorded. Every finding must be promoted, in the same session that found it, to one of:

- a battery leg (an executable test that would catch the class again), or
- a pack verdict row (a case the lint or a host's own suite now grades), or
- a named docket row (a filed issue carrying the finding).

The failure mode this closes is the one-mortem: a probe that got described in prose and never encoded is re-discovered by the next walk. Walks DISCOVER classes; packs REMEMBER them. Neither rung substitutes for the other, and the join between them is this rule. Receipt: eyestruct's walk round landed its serve-dist HTTP-shape proofs and the lint-packs exit-fidelity leg in the same session as the findings (eyestruct `9983b4f`).

## 10. Onboarding a new host (the profiles-not-forks example)

A new engine ("traveler") joins the grammar by answering the three questions this spec already structures, in this order - never by forking the manifest:

1. **What does the manifest see?** The frozen v1 field table (section 2) and the host-owned acknowledged keys (`env`, `plugins`, `package`, `implements`). Nothing to fork; nothing to re-declare.
2. **What does the lint see?** The same `packstruct lint` / `audit-conformance` lanes. A new profile only extends the CASES it reports, never the manifest grammar. All profile-bearing engines to date gate clean through the same packstruct@1 lane.
3. **What does run mean?** This is the only new thing a traveler owns: a profile row (execution semantics declared by the host), an engine receipt per adopted behavior, and cases in `audit-conformance` keyed to its profile id.

A traveler inherits the standing refusals unchanged: no remote packs, no runs inside lint, no `schemaVersion` bump for additive rows, exact-pin companion receipts.

## 11. The MIGRATION-NOTE convention

Section 6 promises a migration note for non-additive changes; this section defines its shape BEFORE first need, so every host does not improvise its own answer under pressure. A non-additive change to any family artifact schema (the pack manifest, the lint/audit JSON shapes, host ledger/report artifacts, conformance case packs) MUST carry ALL of:

1. **A schema-number bump on the owning artifact** - major on removal/renaming/semantic shift (section 6); additive rows stay same-schema forever.
2. **A MIGRATIONS row** - one durable file per owning repo (`MIGRATIONS.md` or a spec section), one row per event: what changed, old shape, new shape, refusal wording.
3. **Refusal wording on old shapes, at the loader/lint** - the mismatch names the schema version it has and the migration row it maps to. Receipt: crashtest's `validatePackManifest` already emits `unsupported schemaVersion N (have: 1)`.
4. **A dual-read window ONLY where a host owns the artifact** (host configs, host ledgers). NEVER for pack manifests: a manifest is either current or refused loudly - it is a reviewable artifact, not a moving target.
5. **Consumer receipts** - every companion-pin host that consumes the changed artifact adds its bump row (the section-8-row-5 discipline applied to non-additive events).

Explicitly not proposed: no migration EXECUTION at load time (a loader either reads a shape or refuses; transforming on the fly hides the break this convention exists to name), and no new fields on `pack.json` (the note lives in prose/artifacts, not on the frozen field table).
