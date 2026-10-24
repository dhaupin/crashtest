# packs/ - the extension-surface directory

This directory is the shell's slot for **packs**: optional, self-contained
extension bundles that adopters (or you) drop in to teach a host new
behaviors. It ships EMPTY on purpose - the `packs/` contract is a family
spec, not shell content.

## The shape (the 30-second version)

```
packs/public/<pack-name>/     tracked, shipped packs
packs/local/<pack-name>/      gitignored, private packs (same semantics,
                              different visibility - nothing about a pack's
                              loading changes based on where it lives)
  pack.json                   REQUIRED manifest (schemaVersion 1)
  <entry file>                REQUIRED - the module pack.json's "entry" names
```

`pack.json` at SPEC v1: `schemaVersion` (must be 1), `name` (kebab-case,
MUST match its directory name), `description`, `version` (the pack's OWN
semver - never bump it for shell releases), `entry` (relative path, must
exist), optional `armedByKey`, plus acknowledged host-owned keys
(`env` claims block, `plugins`, `package`). Extra keys/files are allowed.

## Who owns what (the struct family)

- **The spec** lives in SPEC v1,
  [dhaupin/packstruct](https://github.com/dhaupin/packstruct) - the frozen
  manifest table, entry profiles, lifecycle norms, and the `implements:
  packstruct@1` pin convention.
- **packstruct** is also the linter: `packstruct lint <packs-dir>` enforces
  the manifest grammar + directory contract (exit 0 conforming / 1
  violations / 2 usage error). Adopting repos pin the SPEC commit and wire
  the lint lane in CI - see dhaupin/crashtest's lane for the working shape
  (pinned-SHA clone, lint + receipt byte-compare).
- **dhaupin/crashtest** is the `scenario`-profile reference implementation:
  its loaders execute hostile scenarios in-process against a fake transport
  (the fake transport IS the product - zero sockets), and its docs + packs
  (`packs/public/*/pack.json`) double as the real-world corpus packstruct
  lints against.
- **dhaupin/poststruct** is the `check`-profile sibling: declarative,
  pure-reading verifiers over files on disk. It is queued on the same SPEC;
  its birth thread reserves its column in the shared refusal matrix.

## Shell rules for this directory

- One manifest grammar: manifest shape validates ONCE. If your host adds
  meaning to a key, that is a host-owned extension - the spec's host-owned
  list extends in a patch revision, not a schemaVersion bump.
- Adopters wire a lint lane against a PINNED packstruct commit; a floating
  linter is a random CI. When the pinned SPEC moves, re-derive in one
  reviewed commit.
- Pack semver is per-pack: minor shell version bumps don't drag packs along
  (crashtest's house policy, now yours).

Related docs: [../AGENTS.md](../AGENTS.md) (map + house rules),
[../MANIFEST.md](../MANIFEST.md) (the receipts this rig copied),
[../CHANGELOG.md](../CHANGELOG.md) (version history - and note packs are
versioned independently of it).
