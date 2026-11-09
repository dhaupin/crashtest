// src/packs/relevance.js - the pack ignore mechanism (relevance, not a deny-list).
//
// A pack declares what it NEEDS (`requires`, host-owned capability tokens);
// a run root declares what its target IS (`provides`). A pack whose
// requirements the target does not provide is SKIPPED - never imported - so a
// WordPress-only pack costs a Cloudflare Pages target nothing.
//
// Why relevance beats a deny-list (`.packignore` alone):
//   - A deny-list FAILS OPEN: a newly-shipped pack runs on every target until
//     someone remembers to deny it there. `requires` FAILS CLOSED: a pack that
//     names a capability the target lacks skips by itself, no per-app upkeep.
//   - `requires` travels WITH the pack (a manifest field, so packstruct lints
//     it); a deny-list is a run-root file the pack cannot see.
//   - The skip is HONEST: named and tallied, never a silent green.
//
// The escape hatch (`ignore` / `.packignore`) stays for the case relevance
// cannot express: "my target COULD serve this, but I do not want it here"
// (dev noise, hobbyist speed). Ignore wins over relevance - explicit intent.
//
// Vocabulary is HOST-OWNED and free-form (packstruct SPEC section 2: the
// manifest never forks a shared fact). Tokens are matched by exact string
// equality; crashtest's own tokens are kebab-case.

const TOKEN_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Validate a token list (provides / ignore). Loud on anything but non-empty kebab strings. */
export function normalizeTokens(list, label) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new TypeError(`packs: "${label}" must be an array of capability tokens (got ${typeof list})`);
  }
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string' || !t.trim()) {
      throw new TypeError(`packs: "${label}" entries must be non-empty strings (got ${JSON.stringify(t)})`);
    }
    out.push(t.trim());
  }
  return out;
}

/**
 * Validate a pack manifest's optional `requires` - the capability tokens the
 * pack needs from the run root. Kebab-case, non-empty, unique. Absent = the
 * pack requires nothing (the quiet default, always relevant).
 */
export function validateRequires(requires, origin) {
  if (requires === undefined) return undefined;
  if (!Array.isArray(requires) || requires.some((t) => typeof t !== 'string' || !TOKEN_RE.test(t))) {
    throw new Error(`pack manifest at ${origin}: "requires" must be an array of kebab-case capability tokens (got ${JSON.stringify(requires)})`);
  }
  const seen = new Set();
  for (const t of requires) {
    if (seen.has(t)) throw new Error(`pack manifest at ${origin}: "requires" lists "${t}" twice`);
    seen.add(t);
  }
  return [...requires];
}

/**
 * Minimal glob for ignore tokens: `*` matches any run of characters, every
 * other character is literal. `wp-*` ignores every wp-* pack; `*` ignores all.
 * Deliberately tiny - an ignore list is a convenience, not a pattern language.
 */
export function globMatch(pattern, value) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(value);
}

/**
 * Parse a `.packignore` file body into tokens. One token per line; blank lines
 * and `#` comments are ignored; surrounding whitespace is trimmed. Tokens are
 * matched against a pack's manifest name, its origin (`public/<name>` /
 * `local/<name>`), and support `*` globs.
 */
export function parsePackignore(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Decide whether a pack is skipped, and why.
 * @param {{ name: string, origin: string, manifest: object }} pack
 * @param {{ provides?: string[], ignore?: string[] }} env
 * @returns {{ reason: 'ignored'|'unmet-requires', detail: string } | null} null = relevant
 */
export function relevanceSkip(pack, env = {}) {
  const provides = env.provides ?? [];
  const ignore = env.ignore ?? [];
  // Ignore wins over relevance: an explicit "not here" is never overridden by
  // "the target could serve it".
  for (const token of ignore) {
    if (globMatch(token, pack.name) || globMatch(token, pack.origin)) {
      return { reason: 'ignored', detail: `ignored by "${token}"` };
    }
  }
  const requires = pack.manifest?.requires;
  // Requires-filtering engages only once the run root DECLARES what it
  // provides (a non-empty `provides`). A run root that declares nothing is not
  // participating, so its behavior is unchanged from before this mechanism -
  // no silent skipping for configs that never opted in. Declare `provides`
  // once and every pack (including ones added later) filters itself forever.
  if (provides.length && Array.isArray(requires) && requires.length) {
    const provided = new Set(provides);
    const missing = requires.filter((t) => !provided.has(t));
    if (missing.length) {
      return {
        reason: 'unmet-requires',
        detail: `requires ${missing.join(', ')} - target provides ${provides.join(', ')}`,
      };
    }
  }
  return null;
}
