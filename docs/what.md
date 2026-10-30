---
version: 1.2.0
permalink: what
layout: default
title: What Crashtest is
description: A CLI that fires 49 seeded attacks across 14 modules at your real handlers in-process, returns REFUSED / EXPLOITED / BOUNDED / PASSED, and writes a committed ledger your CI gates.
---

# What Crashtest is

Crashtest is a command-line test runner with a security harness. Point it at
your handlers, and it fires seeded attacks in your own Node process, then
writes a hardening ledger.

## The verbs

Init the ledger, run the suite, lint the packs, gate CI.

```bash
# write the ledger + scenario config
crashtest init

# fire the seeded attacks at your handlers
crashtest run

# CI: fail on a NEW EXPLOITED or a REFUSED->EXPLOITED regression
crashtest run --ci
```

## The verdicts

Every attack returns exactly one verdict: `REFUSED` (your defense held),
`EXPLOITED` (you got hit), `BOUNDED` (a known risk with an owner and a bound),
or `PASSED` (the safe path held - evidence, never a finding).

The catalog is 49 attacks across 14 modules: identity spoofing,
privilege-decision probes, prototype pollution, session fixation and replay,
request-shape floods, stack and backtracking probes, multipart uploads,
same-key bursts, concurrent write races, credential stuffing, memory
discipline, and governance probes.

## The ledger and the exit contract

`labs/crashledger.json` records every attack id and its verdict. CI fails ONLY
on a new `EXPLOITED` finding or a `REFUSED`-to-`EXPLOITED` regression. Accepted
risks, with an owner and a bound on file, never re-alarm. That is the whole
exit contract.

The ledger travels: the packs are self-contained and ride the same grammar as
[poststruct](https://github.com/dhaupin/poststruct)'s checker packs, so a
scenario written once runs in any repo that adopts it.

<div class="crosslinks">
<p><strong>Next:</strong>
<a href="/crashtest/about">about the project</a> ·
<a href="/crashtest/reference/attacks">the attack catalog</a></p>
</div>
