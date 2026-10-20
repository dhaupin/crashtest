/**
 * Cloudflare Pages Function: GET /api/version
 * Returns the live npm version + provenance bits for the crashtest badge,
 * so the site never lies about what shipped. Cached at the edge; npm
 * registry JSON is authoritative.
 *
 * Zero secrets: this only reads the public registry.
 */
export const onRequestGet = async () => {
  try {
    // Plain fetch only: the `cf` cache-hint option is not portable across
    // Pages runtime versions (502s at the platform layer when it's present) —
    // edge caching is left to the response's cache-control header.
    const res = await fetch('https://registry.npmjs.org/crashtest/latest', {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    const pkg = await res.json();
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
