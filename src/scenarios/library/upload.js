// Seed scenario library: 'upload' - PRD section 6 expansion: multipart
// shapes. Upload handlers are where agent-authored storage code trusts the
// client the hardest, because the filename and content type LOOK like
// ordinary strings. Two attacks, both insistent on the only wire truth that
// matters: what the handler DERIVES and STORES. (Note for honesty: the evil
// names here go through UTF-8-safe FormData names - null-byte and unicode
// fakes are expressed without invalid sequences.)
//
//   filename-traversal-family : attacker-shaped filenames ('../etc/passwd',
//     '..\\..\\x', percent-dots, null-byte splits, double extensions,
//     absolute paths, dotfiles) ride a multipart POST. The verdict reads the
//     STORE - any key the handler derived that escapes the safe-name grammar
//     (path separators, '..' segments, control/percent bytes, dotfiles) is
//     EXPLOITED with the key named. A handler that validated honestly
//     stores only clean basenames = REFUSED.
//   mime-polyglot-family : content types that lie. Two shapes carry universal
//     rules the way canaries do: an SVG with a script inside is a canonical
//     XSS carrier no permit should accept, and text/html is the same class.
//     Stored anywhere = EXPLOITED; rejected with an honest 4xx = REFUSED.
//     The implied allow-list discipline is the fix this attack demands.
//
// ctx vocabulary: route (default 'upload'), store (default 'UPLOADS' - a
// fake-KV namespace mounted directly at env.<store>, the same pattern the
// volume module reads DEVICE_CACHE with). Undeclared route or missing store
// names an honest skipped-REFUSED, same contract as every other library:
// coverage follows the fixture, never a false positive.

import { refused, exploited } from '../contract.js';

// Each label is a real kill-class for filename-derived storage, ordered
// deterministically. All names are FormData-safe (no raw control chars).
const EVIL_NAMES = [
  ['unix traversal', '../../etc/passwd'],
  ['windows traversal', '..\\..\\hosts'],
  ['percent-dot traversal', '%2e%2e%2fpasswd'],
  // FormData-safe stand-in for the classic null-byte split: WHATWG names
  // cannot carry a raw NUL, and the percent form names the same class.
  ['null-byte split', 'evil%00name.x'],
  ['double extension', 'shell.php.jpg'],
  ['absolute path', '/etc/cron.d/x'],
  ['dotfile', '.env'],
  ['bare dot-fragment', 'a/./b.txt'],
  ['semicolon trap', 'a.b;rm-dash-rf.txt'],
];

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const UNSAFE_KEY = /(\/|\\|\.\.|%|;|\x00)/;

const POLYGLOT_SHAPES = [
  ['svg with script', 'dropper.svg', 'image/svg+xml', '<svg><script>alert(1)</script></svg>'],
  ['html document', 'dropper.html', 'text/html', '<html><script>droplet()</script></html>'],
];

export default {
  name: 'upload',
  description: 'Multipart upload discipline: filename-derived storage keys stay inside the safe-name grammar, and polyglot content types (svg+script, text/html) are refused on the wire',

  attacks: [{
    name: 'filename-traversal-family',
    description: "Attacker-shaped filenames (traversal, percent-dots, null splits, double extensions, absolute paths, dotfiles) through multipart POST must not yield derived storage keys that escape the safe-name grammar - the STORE decides, any escape is EXPLOITED with the key named",
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'upload';
      const storeName = ctx.store ?? 'UPLOADS';
      const namespace = harness.env?.[storeName];
      if (!harness.listRoutes().includes(route) || !namespace?.list) {
        const gap = !harness.listRoutes().includes(route) ? `route "${route}"` : `kv namespace "${storeName}"`;
        return refused(`${gap} not declared on this target - upload skipped (declare the upload route + its kv store for coverage)`, { route, storeName, skipped: true });
      }

      const faults = [];
      for (const [label, name] of EVIL_NAMES) {
        const fd = new FormData();
        fd.append('file', new File([`crashtest-upload-canary:${label}`], name, { type: 'application/octet-stream' }));
        const rec = await harness.run(route, { method: 'POST', body: fd });
        if (rec.threw) { faults.push(`${label} ("${name}"): threw - ${String(rec.error).slice(0, 70)}`); continue; }
        if (rec.status >= 500) { faults.push(`${label}: ${rec.status} (shape chaos is honest-4xx territory)`); continue; }
        // Read the STORE after the write: what key did the handler derive?
        const keys = (await namespace.list()).keys.map((k) => k.name);
        const newly = keys.filter((k) => k.includes(name) || k === name || UNSAFE_KEY.test(k) || !SAFE_KEY.test(k));
        if (rec.status < 400 && newly.length) {
          faults.push(`${label}: handler accepted "${name}" and stored ${JSON.stringify(newly.slice(0, 3))} - the key escapes the safe-name grammar`);
        }
      }
      if (faults.length) {
        return exploited(`filename traversal landed at "${route}": ${faults[0]} (+${faults.length - 1} more)`, { route, storeName });
      }
      return refused(
        `${EVIL_NAMES.length} hostile filename shapes through "${route}" left nothing but safe basenames (or honest 4xx refusals) in "${storeName}"`,
        { route, storeName },
      );
    },
  }, {
    name: 'mime-polyglot-family',
    description: 'Content types that lie: an SVG with a script inside and a text/html document are canonical XSS carriers - stored anywhere = EXPLOITED, refused with an honest 4xx = REFUSED; the honest fix is an allow-list discipline on the content type',
    async run(harness, ctx = {}) {
      const route = ctx.route ?? 'upload';
      const storeName = ctx.store ?? 'UPLOADS';
      const namespace = harness.env?.[storeName];
      if (!harness.listRoutes().includes(route) || !namespace?.list) {
        const gap = !harness.listRoutes().includes(route) ? `route "${route}"` : `kv namespace "${storeName}"`;
        return refused(`${gap} not declared on this target - upload skipped (declare the upload route + its kv store for coverage)`, { route, storeName, skipped: true });
      }

      const faults = [];
      for (const [label, name, mime, bodyText] of POLYGLOT_SHAPES) {
        const fd = new FormData();
        fd.append('file', new File([bodyText], name, { type: mime }));
        const rec = await harness.run(route, { method: 'POST', body: fd });
        if (rec.threw) { faults.push(`${label}: threw - ${String(rec.error).slice(0, 70)}`); continue; }
        if (rec.status >= 500) { faults.push(`${label}: ${rec.status}`); continue; }
        if (rec.status < 400) {
          // accepted on the wire - the decisive question is what landed
          const keys = (await namespace.list()).keys.map((k) => k.name);
          if (keys.some((k) => k === name || k.includes(name))) {
            faults.push(`${label}: POLYGLOT stored - "${name}" (type ${mime}) accepted and persisted verbatim under "${storeName}"`);
          } else {
            faults.push(`${label}: accepted (${rec.status}) but nothing reached "${storeName}" - an opaque side-effect or a mis-spoken body; either way the XSS carrier passed the gate`);
          }
        }
      }
      if (faults.length) {
        return exploited(`polyglot content types landed at "${route}": ${faults[0]} (+${faults.length - 1} more)`, { route, storeName });
      }
      return refused(
        `${POLYGLOT_SHAPES.length} polyglot shapes (svg+script, text/html) refused honestly through "${route}" - an allow-list discipline holds`,
        { route, storeName },
      );
    },
  }],
};
