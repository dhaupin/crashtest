// packs/public/crashtest-site — crashtest attacking ITS OWN SHIPPED WEBSITE.
//
// The self-dogfood, expanded and hardcore. The target is everything the repo
// actually ships to crashtest.creadev.org:
//   - the real Pages Function behind the npm badge (web/functions/api/version.js)
//   - the real deployed headers (web/public/_headers — CSP/HSTS/COOP/COEP)
//   - the real prerendered HTML (web/dist/index.html — the wire truth)
//   - the real site manifest (web/public/site.webmanifest, robots.txt)
//
// House rule restored here too: attack code, not people — the pack carries
// its own registry double (lib/registry-shim.js) so nothing dials out:
// scenarios probe hostile statuses against a DOUBLE of the npm registry;
// the Pages Function code itself stays real.
//
// Deliverability: pack.json entry = the attack module (attacks.js) — the run
// root imports buildSiteRoutes() from HERE and lists the pack root or this
// pack dir in packs:. One line of config per run root.

import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRegistryShim, restoreFetch } from './lib/registry-shim.js';

const PACK_ROOT = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(PACK_ROOT, '../../..', 'web');
const DIST = join(WEB_ROOT, 'dist');

/**
 * Cached read of a committed asset (web/public/*) — undefined when absent.
 * Committed artifacts (headers, manifest, robots) are always present in a
 * checkout; only web/dist/* is build-dependent.
 */
async function asset(relPath) {
  try { return await readFile(join(WEB_ROOT, relPath), 'utf8'); }
  catch { return undefined; }
}

/**
 * Undo installRegistryShim() — the config's own cleanup hook.
 */
export function teardownSite() {
  restoreFetch();
}

/**
 * The wire surface, lazily prepared. Routes registered here:
 *   version         → the REAL Pages Function
 *   site-headers    → returns _headers contents parsed into a Response with the directives as headers
 *   site-html       → dist/index.html bytes (the prerendered homepage truth)
 *   site-manifest   → site.webmanifest bytes
 *   site-sitemap    → sitemap.xml from dist (or synthesized 404 marker)
 *   site-robotstxt  → robots.txt bytes
 */
export function buildSiteRoutes() {
  installRegistryShim();

  return {
    version: async (ctx) => {
      const mod = await import(join(WEB_ROOT, 'functions/api/version.js'));
      return mod.onRequestGet(ctx);
    },

    async 'site-headers'() {
      const raw = await asset('public/_headers');
      if (!raw) return new Response('crashtest-site: _headers not built', { status: 404 });
      const headers = { 'content-type': 'text/plain' };
      for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Za-z-]+):\s*(.+)$/);
        if (m) headers[m[1].toLowerCase()] = m[2].trim();
      }
      // No CSP directive on this synthetic response IS the finding:
      // a bare content-type is honest about what the audit reads.
      return new Response(raw, {
        status: 200,
        headers: { ...headers, 'cache-control': 'no-store' },
      });
    },

    async 'site-html'() {
      let html;
      try { html = await readFile(join(DIST, 'index.html'), 'utf8'); } catch { html = undefined; }
      // Honest marker, never a throw: web/dist is a build artifact, not a
      // committed file — a checkout that has not built the site yet is a
      // config gap, and the attacks skip it (declare the build for coverage).
      if (html === undefined) {
        return new Response('crashtest-site: web/dist/index.html missing (run the web build for HTML coverage)', {
          status: 404, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
        });
      }
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    },

    async 'site-manifest'() {
      const data = await asset('public/site.webmanifest');
      if (!data) return new Response('crashtest-site: site.webmanifest missing', { status: 404 });
      return new Response(data, {
        status: 200,
        headers: { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' },
      });
    },

    async 'site-sitemap'() {
      try {
        const data = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
        return new Response(data, {
          status: 200,
          headers: { 'content-type': 'application/xml', 'cache-control': 'no-store' },
        });
      } catch {
        return new Response('crashtest-site: sitemap.xml missing (run the build first)', { status: 404 });
      }
    },

    async 'site-robotstxt'() {
      const data = await asset('public/robots.txt');
      if (!data) return new Response('crashtest-site: robots.txt missing', { status: 404 });
      return new Response(data, {
        status: 200,
        headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
      });
    },
  };
}
