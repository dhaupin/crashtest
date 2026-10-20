---
permalink: about/principles
layout: default
title: Principles
description: The seven rules crashtest is built on - they explain every design decision you'll read elsewhere.
---

# Principles

1. **No sockets, ever.** Every request is an in-process WHATWG `Request`
   handed to a registered handler. The fake transport is the product -
   deterministic, fast, safe to point anywhere.

2. **Attack surface over people.** Crashtest finds what code does wrong; it
   is never a verdict about the humans who wrote it. Reports are receipts,
   not blame.

3. **Zero runtime dependencies.** Plain Node ESM, `node:test`, nothing
   else. Build steps may land in devDependencies only.

4. **Fail loudly, fail at cause.** Unsupported shapes, bad scenario modules,
   hung routes - every gap names itself and explains. Symptoms get fixed at
   their cause, never papered over.

5. **Determinism is a feature.** Same commit → same findings. Anything
   time-derived breaks it, so keys and ids derive from the seed instead.

6. **Accepted risk has an owner and a bound.** BOUNDED without both is a
   finding, not a shrug.

7. **Docs match the binary.** Every documented command and verdict shape is
   verified against the shipped CLI before it lands. If it can't be run,
   it doesn't get written.

These say what the tool does in ways you can [verify
yourself](https://github.com/dhaupin/crashtest) - the full contract (PRD,
tasks, ledger) ships in-repo.
