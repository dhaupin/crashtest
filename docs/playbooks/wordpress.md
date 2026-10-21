---
permalink: playbooks/wordpress
layout: default
title: WordPress (v0.3 spike)
description: Attack any WordPress/PHP target in-process through WP's own hook surface - no sockets, no changes to the target repo.
---

# WordPress (v0.3 spike) - "the subprocess harness"

PHP can't be imported into a Node process, so the harness's fake transport
crosses exactly ONE boundary as NDJSON over stdio into a PHP worker
(`fixtures/wordpress/wp-worker.php`) that boots the target's `wp-load.php`
**exactly once**. On the WP side every attack dispatches in-process through
WordPress's own hook surface - `admin_post` / `admin_post_nopriv` /
`template_redirect` - with `wp_redirect` and `wp_die()` captured as
structured transfers.

**No sockets, no live server, ever; the NDJSON stream is a wire format, not
a transport** (PRD section 10 + section 14 still hold: the drone never dials anything).

> The spike is **explicitly experimental** (PRD section 8 v0.3). It was proven on a
> live production WordPress plugin target in October 2026: 16/16 REFUSED,
> 0 false positives, and one real target bug on the first run - a shipping
> email template whose double-quoted heredoc interpolated away its own
> `${fee}` placeholder at compile time. See the repo issues for the run.

## Config

```js
// crashtest.config.js (any CMS target; nothing installs into the target repo)
export default {
  adapters: {
    wordpress: {
      wpRoot: '/srv/wordpress', phpBin: 'php',  // registers route 'app'
      // WHO OWNS THE SPECIFICS: the target's run root. The worker is generic -
      // it knows NO plugin. You declare what your pack is allowed to touch:
      callAllow: { fm_mark_registration_paid: 3, wp_create_nonce: 1 }, // seeded whitelisted fns, fn => max args
      allowOptions: ['fm_settings'],                                  // option rows your pack may read/write
    },
  },
  scenarioDirs: ['/abs/path/to/your/wp-scenarios'], // keep target scenarios outside the target repo
  seed: 0xC0FFEE,
};
```

## The scenario surface

Same contract every JS library already speaks:

```js
// one WP request, in-process, through the real hooks:
const rec = await harness.run('app', {
  method: 'POST',
  url: '/wp-admin/admin-post.php?action=acme_checkout',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, // + x-ct-remote-addr, x-ct-user-id, x-ct-dispatch
  body: 'item=widget&qty=1',
});
// fixture oracles (whitelisted; the worker carries no fuzzing surface):
await harness.wpState({ kind: 'state', op: 'post-meta', id: 42, key: '_acme_paid' });
await harness.wpState({ kind: 'state', op: 'option', name: 'acme_settings', key: 'receiver' }); // gated by allowOptions
await harness.wpState({ kind: 'call', fn: 'acme_mark_paid', args: [42] }); // gated by callAllow
```

Dispatch inference: an `admin-post.php` URL maps to `admin_post` (with its
`?action=`), everything else to `template_redirect` - both overridable via
the `x-ct-dispatch` / `x-ct-action` headers. A PHP fatal mid-request flushes
its envelope with `x-ct-fatal` set and the handler turns it into an honest
500 (never a fake 200). Cost economics ride the REAL database: ops = SQL
queries (`wp.query` @ 2), plus redirect/die/fatal counters.

The example pack [`packs/public/wp-money-shapes/index.js`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-money-shapes/index.js)
ships the three plugin-agnostic money shapes (write-volley / txn-replay /
gate-burst). It carries NO plugin vocabulary of its own: point a run-root copy
of it (or a rebinding wrapper in `packs/local/`) at your target and set
`moduleCtx['wp-money-shapes']` - postType, metaPaid, metaEmail, optionKey,
action, nonceAction, pacedHints.

## The three rules scenarios MUST obey (cross-repo edition)

1. **Restore what you touch.** Any whitelisted seed that mutates shared
   settings must snapshot + restore in the attack's own teardown. A target's
   regression suite WILL catch the miss (the spike's own first run proved it).
2. **Fixtures live on attacker-namespaced identifiers** and get torn down
   via the generic `delete-posts` op - never shared rows.
3. **The worker is generic; packs own specifics.** CPT slugs, meta keys,
   option rows, and seeder functions are the target pack's vocabulary,
   declared once via `callAllow` + `allowOptions` in the run-root config.
   The khf names in the example pack are examples, not plumbing.

## What's next for the spike

The registry already treats `wordpress` like any JS framework adapter, and
the WP run is also the template for the run-root pattern - see
[Run Roots & Recipes](/crashtest/playbooks/run-roots), which is the same
story generalized to any target, and where the section 14 service thread lives.

## Stock-WordPress smoke (headless install recipe)

You can prove the whole harness end to end against a REAL WordPress in
~10 minutes with no target repo at all - the `wp-stock-smoke` pack does it.
Paid-for lessons are baked into the recipe:

```bash
# 1. PHP + SQLite (no MySQL needed):
apt-get install -y php-cli php-sqlite3 php-mbstring php-xml
# 2. WordPress core + the official SQLite Database Integration plugin:
curl -sL -o wp.zip https://wordpress.org/latest.zip && unzip -q wp.zip
unzip sqlite-database-integration.zip -x 'sqlite-database-integration/*' # or drop into wp-content/plugins/
cp sqlite-database-integration/db.copy wordpress/wp-content/db.php
# 3. wp-config.php: DB_ENGINE=sqlite + the salts - and the ONE constant that
#    trips everyone: WP_INSTALLING.
#    `wp_installing()` latches a STATIC from the WP_INSTALLING constant at
#    first call; setting the global later does nothing. Define it in
#    wp-config BEFORE wp-load, or wp_not_installed() redirect-exits silently.
cat >> wordpress/wp-config.php <<'CFG'
define('WP_INSTALLING', true);
CFG
# 4. Headless install (no web UI):
php -r 'require "wp-load.php"; require "wp-admin/includes/upgrade.php"; wp_install("sandbox","admin","admin@probe.example.org",true);'
# 5. Remove WP_INSTALLING before attacking - normal boots must behave normally.
sed -i "/define('WP_INSTALLING'/d" wordpress/wp-config.php
```

Then a run root pointing `adapters: { wordpress: { wpRoot: '/path/to/wordpress', phpBin: 'php' } }`
and `scenarioDirs` at a copy of [`packs/public/wp-stock-smoke/index.js`](https://github.com/dhaupin/crashtest/blob/main/packs/public/wp-stock-smoke/index.js)
proves: real dispatch through admin-post hooks, whitelisted seeder (`wp_create_nonce`),
**real-SQL cost economics** (ops ride `SAVEQUERIES`), and - the punchline attack -
the worker's `CALL_ALLOW` whitelist refusing a destructive core call
(`wp_delete_post`) with the post intact. First stock run: 16/16 REFUSED,
0 false positives, ~2 op meters live from the actual database.
