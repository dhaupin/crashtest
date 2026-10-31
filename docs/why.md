---
version: 1.2.0
permalink: why
layout: default
title: Why Crashtest
description: Agent-built apps ship fast and ship holes. Why behavioral attacks - in-process, seeded, ledgered - catch what a SAST read or a live pentest cannot.
---

# Why Crashtest

An agent can build a working app in an afternoon and ship a privilege hole in
the same commit. The code runs; nothing looked at what it does when someone
lies to it.

## The problem: code that runs is not code that holds

SAST tools read your code and never run it, so a behavioral hole survives
review. Live pentest tools need a server and network traffic, which is the
wrong shape for a solo dev or an agent loop and gets throttled by hosts.
Neither one answers the question that matters: what does this handler do when a
request lies about who it is.

Crashtest answers that by running the code, in-process, with seeded attacks and
cost accounting. It is behavioral QA before deploy, not a read of the source.

## The thesis: no sockets, and receipts that fail

Every request is an in-process WHATWG `Request` handed to a registered handler.
The fake transport is the product: deterministic, fast, safe to point anywhere,
and impossible to ban because no firewall ever sees a packet. Same commit, same
findings, forever.

The run produces a committed ledger, and CI fails only on a new `EXPLOITED`
finding or a `REFUSED`-to-`EXPLOITED` regression - things that held yesterday
and broke today. Findings are receipts, never a verdict about the humans who
wrote the code.

## Who it is for

Anyone shipping an app they cannot fully test: the solo dev who has no
security team, the agent loop that needs a wall before deploy, and the CI that
has to fail the commit that reopened a closed hole.

<div class="crosslinks">
<p><strong>Next:</strong>
<a href="/crashtest/what">what crashtest is</a> ·
<a href="/crashtest/about">about the project</a></p>
</div>
