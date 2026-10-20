---
permalink: reference/presets
layout: default
title: Builder Presets
description: One-line starter configs for Lovable/Bolt/Replit exports - generated from what detect() actually finds in the repo, never a guess from the builder's name.
---

# Builder presets (`crashtest preset`)

Exports from agent app-builders (Lovable, Bolt.new, Replit Agent) ship a
range of backend shapes, and none of the three builders guarantees ONE
universal handler shape in every export. A preset therefore does not claim a
handler from the builder's name - that would be fiction. It **detects** what
is really in the repo and emits a starter config for what is actually there,
naming plainly anything it cannot resolve.

```bash
crashtest preset lovable --root ../my-lovable-export   # also: bolt, replit
crashtest preset list                                  # the three one-liners
```

## What detection looks for (repo evidence, not names)

| Marker | Meaning |
|---|---|
| `supabase/config.toml` + `supabase/functions/<fn>/index.ts` | Supabase Edge Functions layout (Lovable Cloud and Supabase-backed Bolt projects use this) |
| the function source's export shape | `default { fetch }` vs `Deno.serve(...)` - two documented module interfaces, named per file |
| `src/routeTree.gen.ts` | TanStack Start (server functions; framework-managed routes) |
| `.replit` run command / `replit.nix` | Replit-managed repo and the entry the project actually runs |
| `package.json` | `main`, module type; invalid JSON surfaces as a warning, never silently ignored |

## What the preset emits

`crashtest preset <name>` prints a starter `crashtest.config.js` plus:

- **notes** - every detection finding with the file it came from
- **warnings** - anything the preset could not resolve, with the exact files
  to wire by hand

Nothing is guessed. If the export has no server handlers (a pure static SPA),
the preset says so: crashtest attacks server HANDLERS, and a static site has
nothing to attack.

## Known limits (documented, not hidden)

- **TypeScript/Deno functions need a JS shim.** crashtest imports plain ESM
  JS and never transpiles; a Supabase `index.ts` needs a JS re-export of the
  handler (or a compiled copy) before it can ride an in-process adapter.
- **Listening servers are not handlers.** A Replit `run = "npm run dev"`
  starts a server process; the adapter wants the app export
  (`adapters: { express: app }` or hono/fastify/node) - the wiring doc lives
  in each framework playbook.
- **TanStack Start server functions** are detected but not yet auto-wired -
  that framework route shape is on the not-yet-automatable list rather than
  being faked.

## Detection leaves things alone

`crashtest preset` is pure `node:fs` inspection: no network, no writes, no
build step, exit 0 either way. It reads files and prints text - it never
modifies the repo it scans.
