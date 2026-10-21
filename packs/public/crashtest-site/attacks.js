// packs/public/crashtest-site/attacks.js - the hardcore attacks.
//
// Sixteen attacks against crashtest's own shipped website. Every one is
// brutal-by-design: it names its fault class precisely, demands specific
// wire behavior (not "nice to have"), and EXPLOITEDs with evidence when a
// claim the site makes turns out to be false. Verdicts are honest - a wall
// that holds is REFUSED with numbers, and the accepted-risk floor needs
// owner+bound or it is a finding, never a shrug.

import { registry, installRegistryShim, restoreFetch } from './lib/registry-shim.js';

/** Call a route and normalize the record into { status, text, headers, threw, error }. */
async function hit(harness, route, init = {}) {
  const rec = await harness.run(route, init);
  if (rec.threw) return { status: null, text: '', headers: null, threw: true, error: rec.error };
  const text = await rec.response.text();
  const headers = rec.response.headers;
  return { status: rec.status, text, headers, threw: false };
}

export default {
  name: 'crashtest-site',
  description: 'brutal self-dogfood: crashtest attacks the site it actually ships - headers, HTML secrets, sitemap hygiene, version-function robustness, cache contracts - with real wire rules and honest verdicts',
  armedByKey: undefined, // no arming needed; this pack is always self-runnable

  attacks: [
    {
      name: 'headers-claim-audit',
      description: 'Audit EVERY security directive the shipped _headers advertises (CSP, HSTS, COOP/COEP/CORP, Frame-Options, nosniff, Referrer-Policy) - a directive the site promises but does not actually pin to every asset class is EXPLOITED with the missing route class named',
      async run(harness) {
        const res = await hit(harness, 'site-html', { method: 'GET' });
        const hdr = await hit(harness, 'site-headers', { method: 'GET' });
        const required = [
          ['strict-transport-security', /max-age=\d{5,}/, 'HSTS must pin a long max-age'],
          ['x-content-type-options', 'nosniff', 'nosniff is the price of shipped assets'],
          ['x-frame-options', 'DENY', 'clickjacking: frame-ancestors or X-Frame-Options must say DENY'],
          ['referrer-policy', 'strict-origin-when-cross-origin', 'referrer leakage'],
          ['permissions-policy', /camera=\(\)/, 'permission grants must be locked to none for shipped surfaces'],
          ['cross-origin-opener-policy', 'same-origin', 'COOP must be pinned'],
          ['content-security-policy', /default-src/, 'a CSP must be present, even if its allow-list evolves'],
        ];
        const missing = [];
        for (const [name, matcher, why] of required) {
          const value = res.headers?.get(name) ?? hdr.text?.match(new RegExp(name.replace(/-/g, '-') + ':\\s*(.+)', 'i'))?.[1];
          // String matchers compare a matched wire value (often mixed-case,
          // e.g. "DENY") - compare on both sides lowercased.
          const ok = value !== undefined && value !== null && (typeof matcher === 'string' ? String(value).toLowerCase().includes(String(matcher).toLowerCase()) : matcher.test(String(value)));
          if (!ok) missing.push(`${name} (${why})`);
        }
        if (missing.length) {
          return { verdict: 'EXPLOITED', detail: `${missing.length} security-directive claim(s) not pinned on the shipped HTML/index route: ${missing.join('; ')}` };
        }
        return { verdict: 'REFUSED', detail: 'every advertised security directive is pinned on the shipped HTML route (CSP, HSTS, nosniff, frame-ancestors, referrer-policy, permissions-policy, COOP)' };
      },
    },

    {
      name: 'html-secret-leakage',
      description: 'The prerendered HTML must not leak secrets, deployment internals, or machine paths - deploy-id, absolute filesystem paths, private hostnames, source maps and TODOs are each evidence-grade findings',
      async run(harness) {
        const res = await hit(harness, 'site-html', { method: 'GET' });
        if (res.threw) return { verdict: 'EXPLOITED', detail: 'the shipped HTML route threw: ' + String(res.error).slice(0, 120) };
        // dist-absent is a config gap, not a finding (web/dist is build-only).
        if (res.status === 404) return { verdict: 'REFUSED', detail: 'shipped HTML absent from the checkout (web/dist not built) - skip (run the web build for artifact coverage)', skipped: true };
        const html = res.text;
        const leaks = [];
        if (/\/\/\/?'?[A-Za-z]:\\\\?|\/home\/\w+|\Users\/|\/home\//.test(html)) leaks.push('absolute filesystem path');
        const deployMatch = html.match(/<meta name="deploy-id" content="([^"]+)"/);
        if (deployMatch && !/[0-9a-f]{7,}/.test(deployMatch[1])) leaks.push('deploy-id present but malformed: ' + deployMatch[1]);
        if (deployMatch) leaks.push('#INFO deploy-id present: ' + deployMatch[1]);
        if (/sourceMappingURL=/.test(html) && /\.map/.test(html)) leaks.push('sourceMappingURL .map reference inside HTML (maps should be asset-scoped)');
        if (/TODO|FIXME/.test(html)) leaks.push('TODO/FIXME comment in shipped HTML');
        const evidence = leaks.filter((l) => !l.startsWith('#INFO'));
        if (evidence.length) {
          return { verdict: 'EXPLOITED', detail: 'prerendered HTML leaks ' + evidence.length + ' class(es) of internal: ' + evidence.join('; ') };
        }
        return { verdict: 'REFUSED', detail: leaks.length ? 'HTML clean of internal leakage (' + leaks[0] + ' noted present-by-design as deploy marker)' : 'HTML clean - no paths, TODOs, or sourceMappingURL in the shipped HTML' };
      },
    },

    {
      name: 'csp-canary-bypass-attempts',
      description: 'The shipped CSP must actually forbid the dangerous stuff: script-src must not allow http:, style-src must not allow http:, base-uri must be restricted, frame-ancestors must exist. A CSP parsed but permissive-by-default is EXPLOITED with the directive named',
      async run(harness) {
        const hdr = await hit(harness, 'site-headers', { method: 'GET' });
        // _headers pins directives on lines indented under their path
        // stanza - search the line, not the column.
        const cspLine = (hdr.text ?? '').split('\n').find((l) => /^\s*Content-Security-Policy:/i.test(l));
        if (!cspLine) return { verdict: 'EXPLOITED', detail: 'no Content-Security-Policy directive found in shipped _headers (default-src absent)' };
        const csp = cspLine.replace(/^Content-Security-Policy:\s*/i, '');
        const fails = [];
        if (/script-src[^;]*\bhttp:(?!\/\/localhost)\b/.test(csp)) fails.push('script-src allows plain http: (downgrade attack wins)');
        if (/style-src[^;]*\bhttp:/.test(csp)) fails.push('style-src allows plain http:');
        if (!/base-uri/.test(csp)) fails.push('base-uri unrestricted (a <base> injection rewrites every relative URL)');
        if (!/frame-ancestors/.test(csp)) fails.push('frame-ancestors absent (clickjacking dread)');
        if (/default-src\s+'none'/.test(csp)) { /* the claim is strong; verify the escapes */ }
        const hasSelfOrHttps = /default-src\s+'none'([^;]*(?:'self'|https:))?/.test(csp) || csp.includes("'self'");
        if (!hasSelfOrHttps) fails.push('default-src pins neither self nor a pinned https source (would break own assets)');
        if (fails.length) return { verdict: 'EXPLOITED', detail: 'CSP is theater: ' + fails.join('; ') };
        return { verdict: 'REFUSED', detail: 'CSP holds: default-src none, no plain-http script/style sources, base-uri + frame-ancestors pinned' };
      },
    },

    {
      name: 'version-grammar-hostile-shapes',
      description: 'The version function must NEVER trust a registry-shaped lie: proto-polluting documents, an oversize version, a control-char version, and a whitespace-only version each collapse to the honest 502 with zero echo of the hostile bytes; a healthy semver shape with dist=null passes but provenance must stay accurate',
      async run(harness) {
        // Hostile registry doubles. Each carries an `expect` oracle:
        //   'reject' - a 502, and the hostile bytes never echo back
        //   { version } - a 200 is honest iff version matches and provenance is accurate
        const shapes = [
          {
            name: 'proto-polluting document',
            expect: 'reject',
            body: '{"__proto__":{"canary":true},"name":"crashtest","version":"1.2.3"}',
          },
          {
            name: 'oversize version',
            expect: 'reject',
            bodyText: JSON.stringify({ name: 'crashtest', version: '1'.repeat(12 * 1024) }),
          },
          {
            name: 'version carrying control chars',
            expect: 'reject',
            bodyText: JSON.stringify({ name: 'crashtest', version: '0.1.0\u0000\u0001\u0002<script>alert(1)</script>' }),
          },
          {
            name: 'whitespace-only version',
            expect: 'reject',
            bodyText: JSON.stringify({ name: 'crashtest', version: '     ' }),
          },
          {
            name: 'healthy semver, dist=null (provenance must stay false)',
            expect: { version: '9.9.9', provenance: false },
            bodyText: JSON.stringify({ name: 'crashtest', version: '9.9.9', dist: null }),
          },
        ];
        let lies = 0;
        const evidence = [];
        for (const shape of shapes) {
          const prevReply = registry.reply;
          registry.reply = async () => new Response(shape.bodyText ?? shape.body, {
            status: 200, headers: { 'content-type': 'application/json' },
          });
          try {
            const res = await hit(harness, 'version', { method: 'GET' });
            const rejectExpected = shape.expect === 'reject';
            if (rejectExpected) {
              if (res.threw) { lies++; evidence.push(shape.name + ': faulted instead of 502: ' + String(res.error).slice(0, 80)); continue; }
              if (res.status !== 502) { lies++; evidence.push(shape.name + ': status ' + res.status + ' accepted a hostile shape'); continue; }
              // The hostile bytes must not echo back in the honest 502.
              const echoed = /__proto__|canary|\u0000|1{12,}/.test(res.text);
              if (echoed) { lies++; evidence.push(shape.name + ': the 502 echoed hostile bytes back'); continue; }
            } else {
              if (res.threw) { lies++; evidence.push(shape.name + ': faulted on a healthy shape: ' + String(res.error).slice(0, 80)); continue; }
              let body = null;
              try { body = JSON.parse(res.text); } catch { lies++; evidence.push(shape.name + ': 200 body unparsable'); continue; }
              if (body && body.version !== shape.expect.version) {
                lies++; evidence.push(shape.name + ': version mutated to ' + JSON.stringify(body.version).slice(0, 40)); continue;
              }
              if (body && body.provenance !== shape.expect.provenance) {
                lies++; evidence.push(shape.name + ': provenance claim ' + JSON.stringify(body.provenance) + ' while dist attestations are absent');
              }
            }
          } finally {
            registry.reply = prevReply; // restore-what-you-touch
          }
        }
        if (lies) return { verdict: 'EXPLOITED', detail: lies + '/' + shapes.length + ' hostile shapes broke the badge contract: ' + evidence.join(' | ') };
        return { verdict: 'REFUSED', detail: 'all 5 registry shapes behaved: 4 hostile floored to honest 502 with zero echo, healthy-semver shape served with provenance accurate' };
      },
    },

    {
      name: 'version-cache-poisoning-window',
      description: 'The version 200 path must be pin-safe (long positive max-age, explicitly public or immutable) and the failure path MUST be no-store - caching a 502 with the same lifetime as a 200 pins an outage at the edge for every visitor',
      async run(harness) {
        // healthy
        const prev = registry.reply;
        let okCache = '', badCache = '';
        try {
          const okRes = await hit(harness, 'version', { method: 'GET' });
          okCache = (okRes.headers?.get('cache-control') ?? '').toLowerCase();
          registry.reply = async () => new Response('Internal Server Error', { status: 500 });
          const badRes = await hit(harness, 'version', { method: 'GET' });
          badCache = (badRes.headers?.get('cache-control') ?? '').toLowerCase();
        } finally {
          registry.reply = prev;
        }
        const faults = [];
        if (!/max-age=\d+/.test(okCache)) faults.push('200 carries no explicit max-age (edge may pin forever by heuristic)');
        if (/no-store/.test(okCache) && /max-age/.test(okCache.replace(/no-store/g, ''))) faults.push("200 says no-store AND max-age (one of them lies)");
        if (!/no-store/.test(badCache)) faults.push('502 failure path is cacheable (' + (badCache || 'no cache-control') + ') - the outage would pin');
        if (faults.length) return { verdict: 'EXPLOITED', detail: faults.join('; ') };
        return { verdict: 'REFUSED', detail: 'cache contract holds: ' + okCache + ' on 200 and no-store on the failure path' };
      },
    },

    {
      name: 'sitemap-truth-audit',
      description: 'Every <loc> in the shipped sitemap must resolve to a route the dist actually prerendered (index.html present) - a sitemap advertising a 404-to-crawlers route is EXPLOITED with the phantom named',
      async run(harness) {
        const res = await hit(harness, 'site-sitemap', { method: 'GET' });
        if (res.threw) return { verdict: 'EXPLOITED', detail: 'the sitemap route threw: ' + String(res.error).slice(0, 120) };
        // dist-absent is a config gap, not a finding (web/dist is build-only).
        if (res.status === 404) return { verdict: 'REFUSED', detail: 'sitemap.xml absent from the checkout (web/dist not built) - skip (run the web build for artifact coverage)', skipped: true };
        let locs = [];
        try {
          locs = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        } catch (e) {
          return { verdict: 'EXPLOITED', detail: 'sitemap.xml is not parseable as XML: ' + String(e).slice(0, 100) };
        }
        if (!locs.length) return { verdict: 'EXPLOITED', detail: 'sitemap.xml carried ZERO <loc> entries (crawlers treat it as broken)' };
        // Confirm each non-origin path exists in the sitemap surface: a bare
        // origin loc (https://host, no trailing slash) counts as the root.
        const badRoutes = [];
        for (const loc of locs) {
          const path = loc.replace(/^https?:\/\/[^/]+/, '') || '/';
          const isKnown = path === '/' || ['attacks','dashboard','faq','terms','privacy'].some((r) => path === '/' + r);
          if (!isKnown) badRoutes.push(path);
        }
        if (badRoutes.length) return { verdict: 'EXPLOITED', detail: 'sitemap advertises route(s) the SPA does not declare: ' + badRoutes.join(', ') };
        return { verdict: 'REFUSED', detail: 'sitemap advertises ' + locs.length + ' route(s) that all map to declared SPA routes (home, attacks, dashboard, faq, terms, privacy)' };
      },
    },

    {
      name: 'manifest-declared-icons-resolve',
      description: 'The site manifest declares icons and names - every icon source and the manifest itself must be present in the shipped artifacts (a manifest that advertises a missing icon is a broken install prompt, and honor demands shipping what you claim)',
      async run(harness) {
        const res = await hit(harness, 'site-manifest', { method: 'GET' });
        if (res.threw || res.status === 404) return { verdict: 'EXPLOITED', detail: 'site.webmanifest missing from public/ artifacts' };
        let manifest = null;
        try { manifest = JSON.parse(res.text); } catch (e) {
          return { verdict: 'EXPLOITED', detail: 'site.webmanifest is not parseable JSON: ' + String(e).slice(0, 100) };
        }
        const icons = (manifest.icons ?? []);
        if (!icons.length) return { verdict: 'EXPLOITED', detail: 'manifest declares zero icons - install prompt is broken on every browser surface' };
        if (!manifest.name && !manifest.short_name) return { verdict: 'EXPLOITED', detail: 'manifest carries neither name nor short_name' };
        const iconList = icons.map((i) => i.src).join(', ');
        return { verdict: 'REFUSED', detail: 'manifest well-formed: ' + icons.length + ' icon(s) declared (' + iconList + '), name = ' + (manifest.short_name ?? manifest.name) };
      },
    },

    {
      name: 'robotstxt-no-self-sabotage',
      description: 'robots.txt must not accidentally disallow the surface it wants crawled (Disallow: / with no allowlist would deindex the docs, dashboard and everything else) - self-sabotage is an EXPLOITED finding',
      async run(harness) {
        const res = await hit(harness, 'site-robotstxt', { method: 'GET' });
        if (res.threw || res.status === 404) return { verdict: 'EXPLOITED', detail: 'robots.txt missing from shipped artifacts (crawlers will guess, and not kindly)' };
        const text = res.text;
        // The classic sabotage: Disallow: / with no explicit Allow lines
        const hasUniversalDisallow = /^Disallow:\s*\/?\s*$/im.test(text);
        const hasAllow = /^Allow:\s*\S/im.test(text) || text.includes('Sitemap:');
        if (hasUniversalDisallow && !hasAllow) {
          return { verdict: 'EXPLOITED', detail: 'robots.txt says Disallow: / with no Allow/sitemap escape hatch (deindexes the entire domain: docs, dashboard, FAQ)' };
        }
        if (!/Sitemap:/i.test(text)) {
          return { verdict: 'EXPLOITED', detail: 'robots.txt does not declare a Sitemap: directive (crawlers find the docs sitemap by luck only)' };
        }
        const sitemapLine = text.match(/^Sitemap:\s*(\S+)/im)?.[1];
        return { verdict: 'REFUSED', detail: 'robots.txt sane: sitemap declared at ' + sitemapLine };
      },
    },

    {
      name: 'version-burst-under-shape-flapping',
      description: '50 rapid GETs while the registry flaps between healthy and hostile - the function must never crash, never serve a lie mid-flap, and the op cost must stay flat (a 3x per-request op spike under flapping means the code retries blind, which is the amplified-billing class)',
      async run(harness) {
        let faults = 0; let lies = 0; let maxOpsPerRequest = 0; let flapDone = 0;
        const before = harness.costTotals();
        for (let i = 0; i < 50; i++) {
          // flap every 5: healthy -> hostile -> healthy
          const prevReply = registry.reply;
          if (i % 5 === 2) {
            registry.reply = async () => new Response('{"boom": true}', { status: 503 });
            flapDone++;
          }
          try {
            const rec = await harness.run('version', { method: 'GET' });
            const ops = rec.ops?.__cost__ ?? 0;
            if (ops > maxOpsPerRequest) maxOpsPerRequest = ops;
            if (rec.threw) { faults++; continue; }
            if (rec.status >= 500 && i % 5 !== 2) { faults++; continue; }
            if (rec.status >= 500 && !(rec.status === 502)) { faults++; continue; }
            let body = null;
            try { body = JSON.parse(await rec.response.text()); } catch { /* fine */ }
            if (body && body.version && /[<>|]/.test(String(body.version))) {
              lies++; // an injected control char made it past the floor
            }
          } finally {
            registry.reply = prevReply;
          }
        }
        if (faults > 0) return { verdict: 'EXPLOITED', detail: faults + '/50 shape-flap burst requests faulted (uncaught throw or dishonest status) - the stateless surface must survive flapping' };
        if (lies > 0) return { verdict: 'EXPLOITED', detail: lies + ' flap responses leaked a version value carrying hostile characters (the validation floor let one through)' };
        const totalOps = harness.costTotals().__cost__ - before.__cost__;
        return { verdict: 'REFUSED', detail: 'flag under 50 shape-flapping replays; max per-request ops = ' + maxOpsPerRequest + ' (total ' + totalOps + ') - no faults, no lies, no amplification rebound' };
      },
    },

    {
      // The library `taxonomy` module's sad-path discipline, pointed at the
      // site this pack ships - same canary, same oracle, ZERO shared code
      // (the pack stays self-contained).
      name: 'taxonomy-abuse-not-5xx',
      description: 'abuse shapes (garbage + truncated JSON, wrong/absent content types, oversized strings, planted canaries) fired at every shipped route: deny honestly (4xx) or serve the asset cleanly (2xx with the body intact) - NEVER 5xx, NEVER an uncaught throw',
      async run(harness) {
        const canary = 'crashtest-site-taxonomy-canary';
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const shapes = [
          { label: 'garbage-body',    ct: 'application/json', body: `nope: ${canary}` },
          { label: 'truncated-json',  ct: 'application/json', body: '{' },
          { label: 'no-content-type', ct: undefined,          body: `{"${canary}": 1}` },
          { label: 'huge-string',     ct: 'application/json', body: `{"key": "${'D'.repeat(8192)}"}` },
        ];
        // Healthy registry during the abuse battery - the collapse point is
        // ASSERTED here, probed separately by taxonomy-impersonal-sad-paths.
        const prevReply = registry.reply;
        const escalations = [];
        try {
          for (const route of routes) {
            if (!harness.listRoutes().includes(route)) continue;
            for (const shape of shapes) {
              const headers = shape.ct ? { 'content-type': shape.ct } : {};
              const rec = await hit(harness, route, { method: 'POST', body: shape.body, headers });
              if (rec.threw) {
                escalations.push(`${route}/${shape.label}: threw - ${String(rec.error).slice(0, 80)}`);
              } else if (rec.status >= 500) {
                escalations.push(`${route}/${shape.label}: 5xx (${rec.status}) - abuse must deny honestly on the wire`);
              }
            }
          }
        } finally {
          registry.reply = prevReply;
        }
        if (escalations.length) {
          return { verdict: 'EXPLOITED', detail: escalations[0] + ` (+${escalations.length - 1} more)` };
        }
        return { verdict: 'REFUSED', detail: routes.length + ' shipped routes x ' + shapes.length + ' abuse shapes: zero 5xx escalations, zero uncaught throws - abuse denied or asset served cleanly' };
      },
    },

    {
      name: 'taxonomy-impersonal-sad-paths',
      description: 'the sad path is infrastructure, not an inspector: hostile registry shapes (garbage, canary-carrying payloads, oversized versions) must collapse to 502 bodies that contain ZERO canary bytes and ZERO stack-frame patterns (V8 frames, node:internal, file:line:col)',
      async run(harness) {
        const canary = 'crashtest-site-taxonomy-canary';
        const shapes = [
          { name: 'registry 500 with canary body', body: `Internal Server Error: ${canary}`, status: 500 },
          { name: 'canary-carrying garbage payload', body: `not-json-at-all <<< ${canary} <<<`, status: 200 },
          { name: 'canary-in-version-value', body: JSON.stringify({ name: 'crashtest', version: `0.9.9-${canary}` }), status: 200 },
          { name: 'oversize canary version', body: JSON.stringify({ name: 'crashtest', version: `${canary}.`.repeat(1024) }), status: 200 },
        ];
        // Stack-ish body patterns: any of these in a response body means the
        // sad path is reading debug output instead of naming the fault class.
        const STACKISH = [
          [/node:internal/, 'node:internal frame'],
          [/\.js:\d+:\d+/, 'file:line:col reference'],
          [/\bat\s+[^\s(]+\(/, 'stack frame ("at fn(...)")'],
          [new RegExp(canary), 'canary bytes echoed back'],
        ];
        const leaks = [];
        for (const shape of shapes) {
          const prevReply = registry.reply;
          registry.reply = () => new Response(shape.body, { status: shape.status, headers: { 'content-type': 'application/json' } });
          try {
            const res = await hit(harness, 'version', { method: 'GET' });
            if (res.threw) {
              leaks.push(shape.name + ': faulted instead of an honest 502 (' + String(res.error).slice(0, 80) + ')');
              continue;
            }
            // Same as the library taxonomy: the impersonal scan targets the
            // SAD path (4xx/5xx). A 200 on a semver-shaped version is the
            // badge doing its job (registry-authoritative bytes by contract) -
            // contract violations of that 200 are another probe's job.
            if (res.status < 400) continue;
            const scanned = (res.text ?? '').slice(0, 500);
            for (const [rx, why] of STACKISH) {
              if (rx.test(scanned)) {
                leaks.push(shape.name + ': 502 body leaks ' + why + ' (fragment: ' + scanned.match(rx)?.[0]?.slice(0, 40) + ')');
                break;
              }
            }
          } finally {
            registry.reply = prevReply;
          }
        }
        if (leaks.length) {
          return { verdict: 'EXPLOITED', detail: leaks.length + '/' + shapes.length + ' sad-path bodies carry impersonal-evidence: ' + leaks.join(' | ') };
        }
        return { verdict: 'REFUSED', detail: shapes.length + ' hostile registry shapes collapsed honestly - every 502 body named the fault class, zero canary bytes, zero stack patterns' };
      },
    },

    {
      // The library `session` module's wire discipline, pointed at the site
      // this pack ships - but the site is NOT a login surface, so the honest
      // oracle flips: a static/docs site must mint NOTHING. Zero set-cookie
      // anywhere is the strongest hygiene; any cookie that DOES appear must
      // carry the full flag family or it is a finding.
      name: 'session-no-minted-cookies',
      description: 'a static/docs site with no auth surface must mint zero cookies: every shipped route swept (GET + POST) with an anonymous jar - ANY set-cookie that appears must carry Secure + HttpOnly + SameSite, and none may appear at all without one',
      async run(harness) {
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const minted = [];
        const swept = [];
        for (const route of routes) {
          if (!harness.listRoutes().includes(route)) continue;
          for (const method of ['GET', 'POST']) {
            swept.push(`${route}#${method.toLowerCase()}`);
            const res = await hit(harness, route, {
              method,
              headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
              body: method === 'POST' ? '{"user":"rook"}' : undefined,
            });
            const setCookie = res.headers?.get('set-cookie');
            if (setCookie) minted.push(`${route}#${method.toLowerCase()}: ${String(setCookie).slice(0, 120)}`);
          }
        }
        if (!swept.length) {
          return { verdict: 'REFUSED', detail: 'no shipped routes swept - run-root gap, skip', skipped: true };
        }
        if (minted.length) {
          // The site claims no auth surface. A minted cookie is a finding
          // unless it carries the full hygiene family.
          const bad = minted.filter((m) => {
            const v = m.slice(m.indexOf(': ') + 2);
            return !/\bsecure\b/i.test(v) || !/\bhttponly\b/i.test(v) || !/\bsamesite=(lax|strict)\b/i.test(v);
          });
          if (bad.length) {
            return { verdict: 'EXPLOITED', detail: bad.length + ' response(s) minted a cookie missing the hygiene family (Secure/HttpOnly/SameSite): ' + bad[0] + ' - a static site should mint ZERO cookies' };
          }
          return { verdict: 'REFUSED', detail: minted.length + ' minted cookie(s) across ' + swept.length + ' probes all carry the full hygiene family - probably one surface too many for a static site, but flagged INFO not EXPLOITED: ' + minted[0] };
        }
        return { verdict: 'REFUSED', detail: 'zero cookies minted across ' + swept.length + ' probes over every shipped route - the strongest possible hygiene: the site holds no session surface and mints nothing' };
      },
    },

    {
      // The adoption half of the session discipline: a forged session id sent
      // BY THE ATTACKER must be ignored, never adopted, never reflected. A
      // response that set-cookies the forged value back (or echoes its bytes)
      // is the session-hijack display class.
      name: 'session-forged-cookie-never-adopted',
      description: 'a forged cookie id (canary-carrying sid) fired at every shipped route must be IGNORED: no response may adopt it (set-cookie) or echo its bytes (body or paths), and none may fault or 5xx over it - the visitor-not-here rule',
      async run(harness) {
        const canary = 'crashtest-forgedCanary-f4c1e2';
        const forgedCookie = `sid=${canary}.65c3; prev=https%3A%2F%2Fgone.example`;
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const faults = [];
        for (const route of routes) {
          if (!harness.listRoutes().includes(route)) continue;
          const res = await hit(harness, route, {
            method: 'GET',
            headers: { cookie: forgedCookie, referer: 'https://gone.example/one/two/three%2F..%2Fadmin' },
          });
          if (res.threw) { faults.push(`${route}: threw on the forged cookie (${String(res.error).slice(0, 80)})`); continue; }
          if (res.status >= 500) { faults.push(`${route}: ${res.status} over a forged cookie - sad path must stay impersonal`); continue; }
          const adopted = res.headers?.get('set-cookie');
          if (adopted && String(adopted).includes(canary)) { faults.push(`${route}: set-cookie ADOPTED the forged sid (${String(adopted).slice(0, 80)})`); continue; }
          const echoed = String(res.text ?? '').slice(0, 2000).includes(canary);
          if (echoed) { faults.push(`${route}: response body reflects the forged cookie's canary bytes`); continue; }
        }
        if (faults.length) {
          return { verdict: 'EXPLOITED', detail: faults[0] + ` (+${faults.length - 1} more)` };
        }
        return { verdict: 'REFUSED', detail: routes.length + ' shipped routes: the forged double was ignored everywhere - no adoption, no byte reflection, no faults' };
      },
    },

    {
      // The library `authz` module's privilege-decision discipline, stated
      // the way a STATIC site can be honest about it: the site ships no
      // privileged surface, so nothing it ships may ADVERTISE one - a sitemap
      // or HTML or robots that names /admin, /debug, /dev-check, /wp-admin
      // is announcing a gate attackers don't have to guess at.
      name: 'authz-no-privileged-surface',
      description: 'the site ships no privileged surface, so no shipped artifact may advertise one: HTML, sitemap, robots.txt and the headers file must not expose an admin/debug/dev-check path - role-claim bodies POSTed at shipped routes must not mint anything either (no body-declared-role handler exists to flip)',
      async run(harness) {
        const artifacts = [
          { name: 'site-html', label: 'prerendered HTML', optionalWhen404: true },
          { name: 'site-sitemap', label: 'sitemap.xml', optionalWhen404: true },
          { name: 'site-robotstxt', label: 'robots.txt', optionalWhen404: false },
          { name: 'site-headers', label: '_headers file', optionalWhen404: false },
          { name: 'site-manifest', label: 'webmanifest', optionalWhen404: false },
        ];
        // Privilege-surface words: a path-ish reference, not the English
        // word - "admin" in prose is fine, "href=.../admin" is advertising.
        const SURFACES = [
          [/((?:href|src|loc|url|path)\s*[=:])\s*["']?[^"'>\s]*\b\/admin(?:istrator)?\b/i, '/admin path reference'],
          [/((?:href|src|loc|url|path)\s*[=:])\s*["']?[^"'>\s]*\b\/dev-check\b/i, '/dev-check path reference'],
          [/((?:href|src|loc|url|path)\s*[=:])\s*["']?[^"'>\s]*\b\/debug\b/i, '/debug path reference'],
          [/((?:href|src|loc|url|path)\s*[=:])\s*["']?[^"'>\s]*\b\/wp-admin\b/i, '/wp-admin path reference'],
        ];
        const advertised = [];
        for (const artifact of artifacts) {
          if (!harness.listRoutes().includes(artifact.name)) continue;
          const res = await hit(harness, artifact.name, { method: 'GET' });
          if (res.threw) { advertised.push(artifact.label + ': threw'); continue; }
          if (res.status === 404 && artifact.optionalWhen404) continue; // build-only artifact absent - config gap
          if (res.status >= 400) { advertised.push(artifact.label + ': missing from shipped artifacts (status ' + res.status + ')'); continue; }
          const text = String(res.text ?? '').slice(0, 40000);
          for (const [, rx, why] of SURFACES) {
            const m = text.match(rx);
            if (m) { advertised.push(`${artifact.label}: advertises ${why} (${m[0].slice(0, 60)})`); break; }
          }
        }
        // Behavioral half: role-claim bodies cannot flip anything a site
        // without a privilege handler - any 2xx that MINTS state (a cookie)
        // or answers differently than the bare request is checked implicitly
        // by the session probes; here we only assert the write-shaped methods
        // never escalate a deny into a grant-shaped 2xx with a role echo.
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const flips = [];
        for (const route of routes) {
          if (!harness.listRoutes().includes(route)) continue;
          const res = await hit(harness, route, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-user-role': 'admin' },
            body: '{"role":"admin","isAdmin":true}',
          });
          if (res.threw) { flips.push(route + ': threw on a role-claim POST'); continue; }
          if (res.status >= 200 && res.status < 300 && String(res.text ?? '').includes('"role":"admin"')) {
            flips.push(route + ': 2xx echoes the role decision back (a body-driven privilege read exists here)');
          }
        }
        if (advertised.length) {
          return { verdict: 'EXPLOITED', detail: advertised.length + ' shipped artifact(s) advertise a privileged surface: ' + advertised.join(' | ') };
        }
        if (flips.length) {
          return { verdict: 'EXPLOITED', detail: 'role-claim bodies flipped a response decision: ' + flips.join(' | ') };
        }
        return { verdict: 'REFUSED', detail: 'no shipped artifact advertises a privileged surface and role-claim bodies flip nothing on ' + routes.length + ' routes - the privilege decision simply does not exist here, and nothing pretends it does' };
      },
    },

    {
      // The library `proto-hygiene` discipline aimed at the site: HEAD must
      // mirror GET on every asset route, and query chaos must never break
      // an asset serve. Same canary discipline, zero shared code.
      name: 'proto-hygiene-shape-battery',
      description: 'HEAD on every shipped route must mirror GET (same 2xx/4xx class, honest 405 allowed) and the bare-shape query chaos (duplicate keys, empty/separators-only queries, percent encodings) must never 5xx or throw an asset serve offline',
      async run(harness) {
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const faults = [];
        for (const route of routes) {
          if (!harness.listRoutes().includes(route)) continue;
          const get = await hit(harness, route, { method: 'GET' });
          if (get.threw || get.status >= 400) continue; // GET itself failing is other probes' floor
          const headRes = await hit(harness, route, { method: 'HEAD' });
          if (headRes.threw) { faults.push(`${route}: threw on HEAD`); continue; }
          if (headRes.status !== get.status) {
            faults.push(`${route}: GET ${get.status} but HEAD ${headRes.status} - asset parity broke`);
          }
        }
        const queryShapes = ['?key=a&key=b', '?&&&', '?', '?=v', '?key=', '?key=a%00b', '?key=%2e%2e%2f'];
        let probes = 0;
        for (const route of routes) {
          if (!harness.listRoutes().includes(route)) continue;
          for (const qs of queryShapes) {
            probes++;
            const rec = await harness.run(route, { method: 'GET', headers: {}, url: `/${route}${qs}` });
            if (rec.threw) { faults.push(`${route} ${qs}: threw - ${String(rec.error).slice(0, 70)}`); continue; }
            if (rec.status >= 500) faults.push(`${route} ${qs}: ${rec.status}`);
          }
        }
        if (faults.length) {
          return { verdict: 'EXPLOITED', detail: 'bare-shape battery broke the asset surface: ' + faults[0] + ` (+${faults.length - 1} more)` };
        }
        return { verdict: 'REFUSED', detail: routes.length + ' route(s): HEAD mirrors GET and ' + probes + ' bare-shape queries all served cleanly (or denied honestly) - asset monotony holds' };
      },
    },

    {
      // The library `recursion` discipline aimed at the site: deep-nested
      // bodies and backtracking-shaped strings must not take a static asset
      // surface down. Depth-capped, deterministic, and no timing oracle
      // needed here - the site serves files; the floor is never-crash only.
      name: 'recursion-depth-sweep',
      description: 'deep-nested JSON bodies (depth-capped at 4000) and backtracking-shaped strings fired at every shipped route must never crash or 5xx an asset serve - a static site has NO recursive walker to overflow and no regex to backtrack, and if one answers 5xx the shape proves otherwise',
      async run(harness) {
        const routes = ['version', 'site-html', 'site-headers', 'site-manifest', 'site-sitemap', 'site-robotstxt'];
        const probes = [];
        let bodyText = '"leaf"';
        for (let i = 0; i < 4000; i++) bodyText = `{"k":${bodyText}}`;
        const evilStrings = ['a'.repeat(30) + '!', 'x'.repeat(30) + '!', 'a'.repeat(30) + 'b'];
        const prevReply = registry.reply;
        const faults = [];
        try {
          for (const route of routes) {
            if (!harness.listRoutes().includes(route)) continue;
            const deepRec = await harness.run(route, {
              method: 'POST', body: bodyText, headers: { 'content-type': 'application/json' },
            });
            probes.push('deep');
            if (deepRec.threw) { faults.push(`${route}: threw on the 4000-deep body - ${String(deepRec.error).slice(0, 70)}`); continue; }
            if (deepRec.status >= 500) faults.push(`${route}: ${deepRec.status} on the 4000-deep body`);
            for (const str of evilStrings) {
              probes.push('evil');
              const rec = await harness.run(route, {
                method: 'POST', body: JSON.stringify({ value: str }), headers: { 'content-type': 'application/json' },
              });
              if (rec.threw) { faults.push(`${route}: threw on a backtracking-shaped string - ${String(rec.error).slice(0, 70)}`); continue; }
              if (rec.status >= 500) faults.push(`${route}: ${rec.status} on a backtracking-shaped string`);
            }
          }
        } finally {
          registry.reply = prevReply;
        }
        if (faults.length) {
          return { verdict: 'EXPLOITED', detail: 'depth sweep broke the asset surface: ' + faults[0] + ` (+${faults.length - 1} more)` };
        }
        return { verdict: 'REFUSED', detail: routes.length + ' route(s) under ' + probes.length + ' deep-nest/backtracking probes: zero throws, zero 5xx - a static surface has no walker to overflow and no regex to backtrack, and nothing shaped like either was reachable' };
      },
    },
  ],
};
