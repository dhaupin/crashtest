/**
 * Cloudflare Pages Function: GET /api/version
 * Returns the live npm version + provenance bits for the crashtest badge,
 * so the site never lies about what shipped. Cached at the edge; npm
 * registry JSON is authoritative.
 *
 * Zero secrets: this only reads the public registry.
 */

// Proto-pollution guard: JSON.parse can materialize `__proto__`/`constructor`
// as own keys. Anything carrying them is not a registry document we echo.
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// The version floor: a String but not every String is a version. Bounded,
// semver-shaped, no control chars - anything else is an outage, not a badge.
const VERSION_FLOOR = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function rejectWhy(pkg) {
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return 'not a registry document';
  }
  for (const key of Object.keys(pkg)) {
    if (POLLUTION_KEYS.has(key)) return `pollution key in registry document`;
  }
  if (typeof pkg.version !== 'string') return 'version is not a string';
  if (pkg.version.length > 64) {
    return `version exceeds 64 chars (rejected, length withheld)`;
  }
  if (!VERSION_FLOOR.test(pkg.version)) {
    // Never echo the hostile value back on a public asset route: the 502
    // names the fault class, not the attacker's bytes.
    return `version fails the semver floor (rejected, value withheld)`;
  }
  return undefined;
}

export const onRequestGet = async () => {
  try {
    // Plain fetch only: the `cf` cache-hint option is not portable across
    // Pages runtime versions (502s at the platform layer when it's present) -
    // edge caching is left to the response's cache-control header.
    // Accept header: npm's registry 406s the /latest document route when
    // asked for the packument content-type (install-v1) - it serves plain
    // application/json there (found live: the badge 502d site-wide while the
    // registry itself was healthy).
    const res = await fetch('https://registry.npmjs.org/crashtest/latest', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    let pkg;
    try {
      pkg = await res.json();
    } catch {
      // taxonomy lesson (crashtest-site/taxonomy-impersonal-sad-paths, first
      // run): the JSON.parse failure message ECHOES registry bytes - the
      // parse error interpolates a slice of the hostile document. The public
      // 502 body names the fault class, never the bytes.
      return new Response(
        JSON.stringify({ error: 'registry returned an unparsable document (bytes withheld)' }),
        { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
      );
    }
    // Never lie by omission: a registry response without an honest version
    // string is an outage in function, not a success - found by crashtest's
    // own self-dogfood (site/registry-hostile-statuses, then the site pack's
    // version-grammar-hostile-shapes: oversize / control-char / whitespace
    // versions echoed straight through). The badge contract is "200 means a
    // floor-respecting version, 502 means say why".
    const why = rejectWhy(pkg);
    if (why !== undefined) {
      throw new Error(`registry document rejected: ${why}`);
    }
    const version = pkg.version;
    const provenance = Boolean(pkg.dist?.attestations);
    return new Response(
      JSON.stringify({ package: pkg.name ?? 'crashtest', version, provenance, source: 'npm-registry' }),
      { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } },
    );
  } catch (err) {
    // Fail honest: report the outage, never fake a version.
    return new Response(
      JSON.stringify({ error: `registry unreachable: ${err?.message ?? 'unknown'}` }),
      { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
};
