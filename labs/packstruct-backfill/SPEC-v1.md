# The packstruct spec, version 1

One `/packs` system, many hosts. This document is normative for any app that
loads packs from a `packs/` directory and for anyone authoring a pack.

**Schema base (verified 2026-10-24, crashtest#19 receipts):** every crashtest
production pack ships schemaVersion 1 with exactly the shared field set (8/8
conform, nothing drifted since the 2026-10-23 audit). The id space is clean:
44 pack ids across the 8 packs, zero collisions pack-vs-pack and
pack-vs-library. v1 formalizes that reality; hosts either already conform
(crashtest) or adopt it fresh (poststruct). Baseline watch: if a host fleet
bumps its manifests, the spec formalizes the new number - the spec tags
whatever the fleet ships. Ordering ruled on crashtest#19: code first, spec
formalizes after; nothing schema-changing is hidden on the engine side.

## 1. Directory contract (all hosts)

```
packs/public/<pack-name>/
  pack.json        # REQUIRED, fields per section 2
  <entry file>     # REQUIRED: the file pack.json's "entry" names
```

## 2. pack.json (frozen for v1)

| Field | Rules |
|---|---|
| `schemaVersion` | integer, MUST be `1` |
| `name` | kebab-case string, MUST match its directory name (mismatch = load refuse) |
| `description` | one-line, human-readable |
| `version` | dotted MAJOR.MINOR[.PATCH] |
| `entry` | relative path inside the pack dir, MUST exist (missing entry = instant, nameable refusal - the crashtest#16 lesson is a norm now) |
| `armedByKey` | OPTIONAL string. Present: the host MAY require an arming key before activation. Absent: the host's own default lifecycle governs |

**Host-owned acknowledged keys.** The table above is the shared-facts column:
fields every conforming loader assigns meaning to. Some hosts additionally
carry their own optional manifest keys with host-side shape validation. For
v1, three are acknowledged by name because crashtest's loader already
validates them (ruled on crashtest#19):

- `env` - the env-claims block (`d1`/`kv`/`routes`, plus optional `env.seed`)
- `plugins` - bundled plugin imports, resolved against the pack dir
- `package` - optional npm name for the pack

These are **acknowledged, not shared facts**: the spec documents that they
may appear and that the HOST owns their semantics and shape rules. Their
presence is never a spec violation, `packstruct lint` must never refuse a
pack for carrying them, and a future host naming a fourth host-owned key
extends this list in a patch revision, not a schemaVersion bump.

Extra manifest keys and extra files beside the entry are allowed as
minimum-spec (the loader assigns no shared meaning to undeclared keys; e.g.
crashtest's cve-feed ships a snapshot.json beside its entry, which is fine).

## 3. Entry profiles (per host, declared here)

An entry is an ES module with a default export. The manifest/dir/entry surface
never forks between hosts; execution semantics are declared as profiles:

- **`scenario` profile (crashtest):** default export = `register(ctx)`.
  Contains hostile scenarios executed against a transport; hosts of this
  profile provide isolation (fake transport, opt-out postures) and support
  the `armedByKey` ceremony. The execution-semantics contract lives with the
  host (crashtest's `reference/scenario-contract`); `profiles/scenario.md`
  links to it rather than copying it - doc drift is worse than indirection
  (ruled on crashtest#19).
- **`check` profile (poststruct):** default export = `{ checks: [Check] }`.
  Declarative pure-reading verifiers over files on disk. No transport, no
  network by default. Arming defaults to config enumeration: being listed in
  the host's `packs:` config IS the arm; no separate key ceremony.

A host declares which profile(s) it loads. A pack never changes its own
semantics based on the host.

## 4. Lifecycle norms (all hosts)

- **Explicit loads only.** A pack runs because the host's config enumerates
  it. Remote/npm sources are NOT part of v1; adding them requires an explicit
  spec version bump and stays no-auto-download.
- **Namespaced ids.** Pack check/scenario ids live in a pack-slug namespace
  in the host's id space. Cross-namespace collision at load time = refuse to
  start, never silent dedupe.
- **Self-audit fixtures.** Every pack ships `test/fixtures/` proving its
  contents do what they claim. A pack whose fixtures fail fails its own CI
  host-first. (Crashtest backfill note: fixtures are the one norm its
  production packs do not ship yet; it is a lifecycle requirement, not a
  manifest field, so schemaVersion does not move for it.)

## 5. Errors (nameable, instant)

A conforming loader refuses with a one-line error naming the pack and the
broken norm the moment it sees the violation: wrong schemaVersion, name/dir
mismatch, missing entry file, id collision. Never a deep stack trace and
never silent success.

## 6. Versioning

- Additive-first: v2 adds optional manifest fields; removing/renaming is a
  major spec bump requiring a migration note.
- Hosts pin the spec they implement (`implements: packstruct@1` in host docs).

## 7. Conformance tooling

- `packstruct lint <packs-dir>`: manifest validation + entry existence +
  name/dir match (section 2, plus directory-contract checks from section 1).
  Exit 0 conforming / 1 violations / 2 usage error.
- Conformance harness (M2): fixture packs a loader must pass/fail as promised.
