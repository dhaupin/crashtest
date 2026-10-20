// v0.3 spike — WordPress/PHP adapter (PRD §8 v0.3: "WP/PHP feasibility spike
// (subprocess harness — explicitly experimental)"). PHP can't be imported
// into a Node process, so the harness's fake transport crosses ONE boundary
// as NDJSON over stdio into a PHP worker that boots the target's wp-load
// exactly once (fixtures/wordpress/wp-worker.php). No sockets, no live
// server: on the WP side every attack dispatches in-process through WP's
// own hook surface (admin_post / template_redirect) — the wire format is
// not a transport.
//
// Config (crashtest.config.js):
//   adapters: { wordpress: { wpRoot: '/srv/wordpress', phpBin: 'php' } }
//   routes stay empty — the adapter registers itself as route 'app'.
//
// Scenario surface (same contract the JS libraries already speak):
//   harness.run('app', { method, url, headers, body })  → one WP request
//   harness.wpState({ kind:'state', op, prefix, id, key }) → fixture oracle
//   harness.wpState({ kind:'call', fn, args })          → whitelisted seeder
//
// Worker lifecycle: stateless between requests; on a non-transfer fault
// (PHP fatal mid-handler) the worker flushes its envelope, exits non-zero,
// and the next request transparently respawns a fresh wp-load.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DEFAULT = join(
  dirname(fileURLToPath(import.meta.url)), '../../fixtures/wordpress/wp-worker.php',
);

/** One WordPress attack process: NDJSON request/reply over its stdio. */
class WPWorker {
  constructor({ wpRoot, phpBin = 'php', script = WORKER_DEFAULT, stderr = 'ignore' }) {
    if (!wpRoot) throw new TypeError('wordpress adapter needs { wpRoot } — the wp root to bootstrap');
    this.argv = [phpBin, script, wpRoot];
    this.stderr = stderr;
    this._child = this._spawn();
  }

  _spawn() {
    return spawn(this.argv[0], this.argv.slice(1), {
      stdio: ['pipe', 'pipe', this.stderr],
    });
  }

  /**
   * Send one envelope line; resolve the worker's matching reply line.
   * Lines pair 1:1 in index order (NDJSON; the worker never emits two).
   */
  async exchange(envelope) {
    const child = this.#exchangeLive();
    return new Promise((resolve, reject) => {
      let buf = '';
      const onData = (d) => {
        buf += d.toString('utf8');
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let parsed;
          try { parsed = JSON.parse(line); } catch {
            continue; // boot noise: never parsed into a verdict
          }
          cleanup();
          resolve(parsed);
          return;
        }
      };
      const onExit = (code) => {
        cleanup();
        const e = new Error(`wp-worker exited (code ${code}) before replying`);
        e.wpExit = code;
        reject(e);
      };
      const cleanup = () => {
        child.stdout.off('data', onData);
        child.off('exit', onExit);
      };
      child.stdout.on('data', onData);
      child.once('exit', onExit);
      child.stdin.write(JSON.stringify(envelope) + '\n', 'utf8');
    });
  }

  /** Same as exchange() with a guaranteed-live child (respawns on fault). */
  #exchangeLive() {
    if (this._child.exitCode === null && !this._child.killed) return this._child;
    this._child = this._spawn();
    return this._child;
  }

  kill() {
    if (this._child.exitCode === null) { this._child.kill(); }
  }
}

/** Serialize one harness Request into a worker attack envelope. */
export async function ctRequestToEnvelope(req, {
  id = 'r' + Math.random().toString(16).slice(2),
  data = {},
} = {}) {
  const url = new URL(req.url);
  const path = url.pathname + (url.search || '');
  // Cookie header → the cookies envelope (state library attacks ride this).
  const cookies = {};
  const cookieHeader = req.headers.get('cookie');
  if (cookieHeader) {
    for (const pair of cookieHeader.split(/;\s*/)) {
      const eq = pair.indexOf('=');
      if (eq > 0) cookies[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  Object.assign(cookies, data?.cookies ?? {});
  // Dispatch inference, in order:
  //   · x-ct-dispatch header (explicit escape hatch for exotic surfaces)
  //   · the admin-post.php URL (and its ?action=) => admin_post
  //   · everything else => template_redirect (front-end surfaces: IPN
//     receiver, gate view, portal, sitemap…)
  const explicit = req.headers.get('x-ct-dispatch');
  const isAdmin = /admin-post\.php$/.test(url.pathname) || url.pathname === '/wp-admin/admin-post.php'
    || url.pathname === '/admin-post.php';
  const action = req.headers.get('x-ct-action') ?? url.searchParams.get('action') ?? '';
  // The body: harness Requests carry urlencoded strings (the khf-style
  // flows parse into $_POST); an already-consumed body means an empty read.
  let body = '';
  try { body = await req.text(); } catch { body = ''; }
  return {
    id,
    kind: 'request',
    method: req.method,
    url: path,
    dispatch: explicit ?? (isAdmin ? 'admin_post' : 'template_redirect'),
    action,
    remoteAddr: req.headers.get('x-ct-remote-addr') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    userId: req.headers.get('x-ct-user-id') ? Number(req.headers.get('x-ct-user-id')) : 0,
    cookies,
    body,
  };
}

/** Convert one worker reply envelope into a harness Response. */
export function ctReplyToResponse(reply) {
  const headers = new Headers();
  const fatal = typeof reply.fatal === 'string' && reply.fatal !== '' ? reply.fatal : null;
  headers.set('x-ct-fatal', fatal ?? '');
  if (reply.wp_die) headers.set('x-ct-wp-die', String(reply.wp_die));
  headers.set('x-ct-ops', JSON.stringify(reply.ops ?? { queries: 0 }));
  if (reply.redirect) headers.set('location', reply.redirect);
  let status = reply.status;
  if (fatal !== null) status = 500; // a PHP fault would have been a socket 500
  else if (status === null && reply.redirect) status = 302;
  else if (status === null && reply.wp_die) status = reply.status ?? 500;
  else if (status === null) status = 200;
  return new Response(reply.body ?? '', { status, headers });
}

/** Register a WordPress target as harness route `name` (default 'app'). */
export function registerWordPress(harness, opts = {}) {
  // The generic registry passes adapters through as { app: spec }; accept
  // both the bare spec and the wrapped form so the config shape stays
  //   adapters: { wordpress: { wpRoot, phpBin } }
  const fix = (opts.app && typeof opts.app === 'object') ? opts.app : opts;
  const name = opts.name ?? 'app';
  const worker = new WPWorker({ wpRoot: fix.wpRoot, phpBin: fix.phpBin, script: fix.script });
  // Generic-adapter rule: the worker knows NO plugin. This run's specifics —
  // seeder functions (callAllow) and option rows (allowOptions) — arrive from
  // the run-root config and cross the boundary ONCE as the first 'cfg'
  // envelope. Packs declare what they need; the target config owns it.
  const callAllow = fix.callAllow ?? { wp_create_nonce: 1 };
  const allowOptions = fix.allowOptions ?? [];
  const cfgSent = (async () => {
    try {
      await worker.exchange({ id: 'cfg0', kind: 'cfg', callAllow, allowOptions });
      return true;
    } catch {
      // An older worker (pre-cfg) will fatal on the unknown kind and respawn
      // per request — surface it as a loud config error rather than silent skip.
      throw new Error('wordpress adapter: worker rejected the cfg envelope (stale wp-worker.php next to an older adapter?)');
    }
  })();
  // Cost hooks (PRD §13): real-SQL ops tick the same ledger as fake backends.
  for (const [opName, unit] of [['wp.query', 2], ['wp.redirect', 1], ['wp.die', 1], ['wp.fatal', 4]]) {
    try { harness._counter.declare(opName, unit); } catch { /* harness without counters */ }
  }

  harness.registerRoute(name, async (ctx) => {
    await cfgSent; // cfg crosses first, once — every later envelope is scoped by it
    const envelope = await ctRequestToEnvelope(ctx.request, { data: ctx.data });
    const reply = await worker.exchange(envelope);
    const ops = reply.ops ?? { queries: 0 };
    harness._counter.increment('wp.query', ops.queries ?? 0);
    if (reply.redirect) harness._counter.increment('wp.redirect');
    if (reply.wp_die) harness._counter.increment('wp.die');
    if (reply.fatal) harness._counter.increment('wp.fatal');
    return ctReplyToResponse(reply);
  });

  // Fixture-oracle surface for scenario modules (packs read state after the
  // attack: counts, money metas, whitelisted seeder calls — all through the
  // generic ops + this run's cfg whitelist).
  harness.wpState = async (payload) => {
    await cfgSent;
    const envelope = { id: 's' + Math.random().toString(16).slice(2), ...payload };
    const reply = await worker.exchange(envelope);
    const ops = reply.ops ?? { queries: 0 };
    harness._counter.increment('wp.query', ops.queries ?? 0);
    return reply;
  };
  harness.wpWorker = worker;
  return harness;
}
