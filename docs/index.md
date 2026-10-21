---
version: 1.0.0
permalink: /
layout: default
title: Crashtest Documentation
description: Crashtest drives a seeded, in-process attack suite against your real handlers and produces a hardening ledger your CI fails on regressions - no sockets, no redeploy loop.
---

# Crashtest Documentation

> Adversarial QA for agent-built apps. Attack the code, not the people.

Crashtest is a command-line test runner with a security harness. Point it at
your server handlers (plain functions or a framework app), and it fires seeded
attacks against them **in your own Node process** - no sockets, no staging
server, no test deployment. Every run produces:

- `labs/hardening.md` - a readable report of what held and what didn't
- `labs/crashledger.json` - a committed baseline your CI won't let regress

Each attack returns one of three verdicts:

| Verdict | Meaning |
|---|---|
| 🛡 **REFUSED** | Your handler did the right thing - denied, validated, constrained |
| ⚡ **EXPLOITED** | A real weakness - CI fails on finding this for the first time |
| 🔒 **BOUNDED** | A known, accepted risk with a named owner and an explicit bound |

## Where to go

- **New here?** [Quick Start](/crashtest/getting-started/quick-start) gets a run
  going in about two minutes.
- **Using a framework?** Pick your
  [playbook](/crashtest/playbooks/): plain handlers,
  [Express](/crashtest/playbooks/express),
  [Hono](/crashtest/playbooks/hono),
  [Fastify](/crashtest/playbooks/fastify), or a
  [raw Node server](/crashtest/playbooks/raw-node).
- **Wired into CI?** The
  [GitHub Action playbook](/crashtest/playbooks/github-action) turns your
  ledger into a branch gate.
- **Details people:** the [attack catalog](/crashtest/reference/attacks), the
  [ledger format](/crashtest/reference/ledger), and the
  [exit rules](/crashtest/reference/exit-rules) are documented machine-honest -
  every claim here matches the shipped CLI.
- **Extending it:** shipped packs (including `cve-feed`, the offline
  KEV/NVD snapshot sweep) and your own are covered in the
  [packs register](/crashtest/reference/packs).

## The one rule worth quoting

Every request the harness fires is an in-process WHATWG `Request` handed to a
registered handler. If something needs a real network socket, it's out of
scope by design. The fake transport **is** the product - which is why runs are
deterministic, fast, and safe to point anywhere.

Crashtest is [MIT-licensed open source](https://github.com/dhaupin/crashtest)
and is part of the [Creadev.org](https://creadev.org) family.
