---
permalink: getting-started/install
layout: default
title: Installation
description: Zero runtime dependencies; install as a dev tool or drive it with npx.
---

# Installation

Crashtest ships as a plain Node package — **zero runtime dependencies**.

## As a dev dependency (recommended)

```console
$ npm install --save-dev crashtest
$ npx crashtest --version
```

## One-off probes

```console
$ npx crashtest init
$ npx crashtest run
```

`npx` fetches on first use and pins nothing — for CI, prefer the committed
dev dependency or the composite action below so versions don't surprise you.

## CI (GitHub Action)

One step gates a whole branch:

```yaml
- uses: dhaupin/crashtest@v0.1.1
  with:
    config: crashtest.config.js   # default
    run-tests: 'false'            # also run your own npm test first, if you want
```

The action installs crashtest, runs the gate against your committed
`labs/crashledger.json`, uploads `hardening-run.md` as an artifact, and exits
with the gate [exit rules](/crashtest/reference/exit-rules).

## Requirements

- Node 22 (the action defaults to 22; knobs per-step)
- ESM package (`"type": "module"` in your package.json — Node 22 parses ESM
  configs without it too, but your config imports your handlers, so match
  your codebase)

## Verify what you installed

```console
$ npm view crashtest dist.attestations
true
```

Every release is published with SLSA provenance from GitHub Actions — the
tarball is traceable to an exact commit, signed into the Sigstore
transparency log. First release: [0.1.0
provenance](https://search.sigstore.dev/?logIndex=3329750463).
