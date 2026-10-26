import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

const MODULES = [
  {
    mod: 'auth',
    attacks: [
      ['identity-spoof-headers', 'Fires 54 spoof variants - 9 identity headers (x-is-admin, x-user-role, x-forwarded-user...) each claiming 6 privilege values - at a privileged route', 'any handler that reads identity straight from wire headers'],
      ['secret-watermark', 'Plants fake secrets in env, probes error paths - a leaked secret means some error string echoed it', 'handlers that template raw error text'],
      ['privilege-escalation', 'Replays owner-b claims over owner-a writes (writer/victim pairs)', 'routes that accept an owner field without checking the caller'],
    ],
  },
  {
    mod: 'authz',
    attacks: [
      ['method-matrix-privileged', 'Fires the privileged route on every HTTP method (GET/POST/PUT/PATCH/DELETE, bare and with bodies) - the gate must deny method-blind; a gate that trips only on the tested method is a finding', 'gates keyed to one request method'],
      ['role-body-spoof-family', 'The role-word field family (role, isAdmin, is_admin, admin, scope, permissions, nested user.role) fired in bodies at the privileged route must never flip a deny - identity lives in what the server derives, not in what the attacker declares', 'handlers that trust body-declared roles'],
      ['handler-alias-confusion', 'A second route performing the same privileged action (the dev/debug leftover) must deny identically - unauthenticated AND under identity-header spoofing; an alias that honors what the primary ignores is the trapdoor', 'leftover debug/alias routes with weaker gates'],
    ],
  },
  {
    mod: 'guards',
    attacks: [
      ['hygiene-no-store', 'Every 2xx write must carry store class (no-store / private / explicit immutable) - mandated by HTTP cache semantics', 'handlers that write without cache directives'],
      ['burst-wall', '50-request burst; measures 5xx/429/timeout and the Retry-After wall', 'routes exposed to sustained load'],
    ],
  },
  {
    mod: 'governance',
    attacks: [
      ['succession-trust-floor', 'A designated successor at trust L inherits only capabilities >= L - the deep-private half stays locked below the floor; a breach resolves ALLOW below the level', 'successor caches that inherit the whole capability map'],
      ['succession-single-heir', 'Two successor declarations for one role must resolve deterministically by declared precedence - never arrival order or randomness', 'role maps keyed by insertion order'],
      ['succession-revocation-carry', 'Revoking an heir propagates into a session opened AFTER the revocation, including any cached capability map - a still-allowed ask is the carry gap', 'capability caches consulted without checking revocation'],
      ['escrow-two-key-release', 'An escrowed operation releases only under TWO independent approvals - one principal self-signing twice must never release', 'approval flows that count signatures, not principals'],
      ['escrow-expiry-is-fail-closed', 'An escrow past its TTL releases nothing and answers typed - silent past-TTL release is the classic class', 'expiry checks that only run on read paths'],
      ['escrow-refusal-is-typed', 'Denied releases answer with a typed reason naming the blocker - raw 5xx or blank errors are findings', 'refusal paths that fault instead of refusing'],
      ['grant-conflict-deterministic', 'Two conflicting grants (allow/deny) resolve by declared precedence regardless of insertion order', 'grant tables without a precedence rule'],
      ['capability-no-sideways', 'A grant scoped to brain/namespace A must not authorize writes into B even when the objects share a parent', 'scope checks that stop at the parent prefix'],
      ['lock-ttl-honesty', 'A lock past TTL behaves exactly as the app documents it (declare the documented ttlMode) - the disagreement between claim and behavior is the finding', 'locks whose advertised TTL is aspiration'],
      ['lock-owner-fencing', 'A stale holder writing through an expired fence token is refused loudly - a deleted-token write that succeeds is the fencing gap', 'fence tokens checked only at acquire time'],
    ],
  },
  {
    mod: 'input',
    attacks: [
      ['proto-pollution-body', 'Feeds __proto__/constructor keys through JSON bodies (JSON.stringify silently DROPS them - hostileSerialize is built to keep them on the wire)', 'recursive-merge handlers that spread untrusted bodies'],
      ['never-fail-mutations', '64 hostile bodies (huge ids, nested types, unicode tricks) - any failure mode past a 4xx is a finding', 'mutation routes without shaped rejection'],
      ['oversized-field', '1MB fields, deep nesting, giant arrays', 'handlers without a body limit'],
    ],
  },
  {
    mod: 'memory',
    attacks: [
      ['drift-silent-overwrite', 'Two writers update the same fact without revision bumps - the read must surface the conflict or keep both provenance lines, never a silent blend', 'note stores without revision discipline'],
      ['drift-stale-poisons-fresh', 'A fact written by a retired writer must not outrank the current writer for the same key - staleness beats recency = the poison', 'read paths without writer-identity ranking'],
      ['drift-contradiction-carry', 'A note whose body contradicts its own declared summary must be flagged by the read path - carried silently is the honesty gap', 'read layers that trust the header blindly'],
      ['hallucinated-fact-probe', 'A claim referencing a note id that never existed (deterministic ghost key) must be detectable on read-back', 'note stores that accept any reference'],
      ['citation-drift', 'A note citing a deleted anchor is a dangling claim - the read path must refuse it loudly, never serve it resolved', 'citation graphs without liveness checks'],
      ['phantom-scope', 'A private-scoped note must not inherit a wider scope when its content claims public provenance - scope lives in the field, not in prose', 'merges that let content widen scope'],
      ['identity-merge-collision', 'Two agent identities that wrote the same fact keep BOTH provenance lines through the merge - one vanished author is silent loss', 'merges that overwrite attribution'],
      ['resolution-order-stability', 'Resolving N conflicting facts must be a deterministic function of declared inputs - same inputs twice, same winner, twice', 'resolvers with side-effect timing'],
      ['delete-is-loud', 'Pruning deletes leave traceable residue (tombstone/prune traces) - a forget-claim with no tombstone erases history', 'prunes that drop rows outright'],
    ],
  },
  {
    mod: 'proto-hygiene',
    attacks: [
      ['head-get-parity', 'Sweeps every declared route: HEAD must be the cheap mirror of GET - no throw, no status drift where GET answered 2xx (only an honest 405 is excusable); HEAD body bytes are an INFO note, not a finding', 'handlers that never considered HEAD'],
      ['request-shape-flood', 'Bare geometry attacks before payloads: duplicate query keys, malformed separators, control bytes, dot-segment paths, header casings - no 5xx, no throw, and answers must not change when only the spelling did', 'param handlers that dereference what the URL never carried'],
    ],
  },
  {
    mod: 'recursion',
    attacks: [
      ['deep-nest-stack-overflow', 'A JSON structure nested many thousands deep meets the handler - V8 JSON.parse survives, so any recursive WALK over it (merges, flatteners, normalizers) is where the call stack detonates; an uncaught RangeError is a finding, a depth-capped 4xx refusal holds', 'recursive JSON walkers without a depth guard'],
      ['redos-catastrophic-pattern', 'Validation regexes behind attacker-controlled strings must backtrack linearly - evil/benign pairs differing only in their last character self-control the timing ratio on the SAME handler, so no host clock decides (the library\'s one timing-relative probe by design)', 'nested-quantifier / alternation patterns on unanchored input'],
    ],
  },
  {
    mod: 'upload',
    attacks: [
      ['filename-traversal-family', 'Attacker-shaped filenames (traversal, percent-dots, null splits, double extensions, dotfiles) through multipart POST - the verdict reads the STORE; any derived key that escapes the safe-name grammar is a finding', 'storage code keyed by the raw client filename'],
      ['mime-polyglot-family', 'Content types that lie - an SVG with a script and a text/html document are canonical XSS carriers; stored verbatim is a finding, refused with an honest 4xx holds', 'handlers without a content-type allow-list'],
    ],
  },
  {
    mod: 'race',
    attacks: [
      ['double-submit-idempotency', 'N concurrent POSTs with the SAME idempotency key must land exactly one side effect - two acknowledged charges or an uncaught same-key throw (a storage wall the wire never shaped) is the double-charge class; one row + shaped 409s holds', 'read-then-insert with an await gap (TOCTOU)'],
      ['concurrent-write-lost-update', 'Two concurrent field-split writers must both survive: after both land, every submitted field is present in the store - a record holding only the last writer (or a writer lost to an uncaught conflict) is the silent stomp', 'whole-record writes that replace what a concurrent writer just stored'],
    ],
  },
  {
    mod: 'state',
    attacks: [
      ['enumeration-oracle', 'Arms mustDenyIds, probes each - 200s (or content ripples) mean foreign rows leak by guessable id', 'GET-by-id without ownership checks'],
      ['id-collision-alias', 'Two owners claim the same id; the env snapshot diff decides - owner-a\'s row silently overwritten in place is a finding', 'write routes without unique constraints'],
    ],
  },
  {
    mod: 'volume',
    attacks: [
      ['credential-stuffing', '60 staged credential attempts across the route', 'unbounded auth surfaces'],
      ['storage-fill', '30 rounds of 8KB unique writes; tracks op cost AND storage growth per round', 'kv-writing routes without a fill budget'],
      ['cost-amplification', '40 identical replays; maxWall sets the accepted ceiling - under it, REFUSED with the measured ops/request', 'handlers doing table scans per request'],
    ],
  },
  {
    mod: 'taxonomy',
    attacks: [
      ['abuse-not-5xx', '10 abuse shapes (garbage/truncated JSON, wrong or absent content types, oversized canary strings) - every one must land as an honest 4xx; a 5xx or an uncaught throw is a finding', 'mutation routes with no shaped sad path'],
      ['errors-stay-impersonal', 'Sad-path bodies must not echo attacker canaries (values or field names) or leak stack frames (node:internal, at fn(...), file:line:col)', 'error handlers that template raw input or debug text'],
    ],
  },
  {
    mod: 'session',
    attacks: [
      ['cookie-hygiene', 'The login transition must mint a Set-Cookie carrying Secure, HttpOnly, and a SameSite policy - any missing flag is a finding; a cookie-less login honestly skips (bearer-token auth is out of scope by design)', 'handlers that mint session cookies without the full flag set'],
      ['session-fixation', 'Two logins must mint different session ids, and a forged canary sid must never authenticate - a shared sid across the privilege transition is the fixation classic', 'logins that reissue a static sid or honor unknown cookies'],
      ['logout-invalidates', 'A logged-out sid must be dead on arrival: me() with the pre-logout cookie must deny (4xx class) - still-200 is a finding', 'logouts that clear the client cookie but not the server session'],
      ['token-replay-deny', 'Four logins (account A, B, A again, C) must mint pairwise-distinct sids and the A-again re-login must not resurrect its original sid - a reused sid makes every expired-but-known token replayable forever', 'sessions that recycle or re-issue token values'],
    ],
  },
]

export default function Attacks() {
  // Hook in the component body (see Home for the #321 flash-then-black lesson).
  usePageMeta({ siteUrl: SITE_URL, path: '/attacks', title: 'Attack catalog | Crashtest', description: 'Every shipped crashtest scenario module and attack, with the real findings the first external run produced.' })
  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <p className="eyebrow">Scenario catalog / v1.1</p>
        <h2>All shipped attacks</h2>
        <p className="sub">
          Drop extra modules into <code>labs/scenarios/</code> (or any dir via config
          <code> scenarioDirs</code>); each returns REFUSED 🛡 / EXPLOITED ⚡ / BOUNDED 🔒. BOUNDED requires an owner+bound or it demotes to EXPLOITED - loud, per the PRD principle.
        </p>
        <div className="table-wrap">
          <table className="attacks">
            <thead>
              <tr><th>Scenario</th><th>What it does</th><th>Fault class it targets</th></tr>
            </thead>
            <tbody>
              {MODULES.flatMap((m) =>
                m.attacks.map(([name, what, why]) => (
                  <tr key={`${m.mod}/${name}`}>
                    <td className="mod">{m.mod}/{name}</td>
                    <td><span className="what">{what}</span></td>
                    <td><span className="why">{why}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <h3 style={{ marginTop: 40 }}>Shipped packs ride the same ledger</h3>
        <p className="sub">
          Beyond the 49 library attacks above, eight public packs ship - 36
          pack attacks total - and load wherever <code>packs:</code> points.
          Seven of them ride the npm package under{' '}
          <code>packs/public/</code>; the eighth, <code>crashtest-site</code>,
          stays repo-bound (18 attacks - the release self-check that dogfoodes
          this website end to end and once caught our own version endpoint
          answering a malformed payload with a 200). The npm-carried seven:{' '}
          <code>cve-feed</code> (2 attacks - <code>kev-banner-audit</code> and{' '}
          <code>kev-version-range-audit</code>, reading a curated, committed
          KEV/NVD snapshot instead of the network - the snapshot shape, its
          27-row budget, and the word-boundary grammar of its match tokens
          are pinned in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/cve-feed.test.js" target="_blank" rel="noreferrer">test/cve-feed.test.js</a>),{' '}
          <code>qs-shapes</code> (2 attacks - <code>qs-bracket-canary</code> and{' '}
          <code>qs-depth-floor</code>, firing bracket-notation shapes at the
          qs-style parser wire, pinned in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/qs-shapes.test.js" target="_blank" rel="noreferrer">test/qs-shapes.test.js</a>),{' '}
          <code>vite-dev-shapes</code> (2 attacks - the vite dev-file wire's
          bypass grammar differential plus the env-family content-shape
          oracle, pinned in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/vite-shapes.test.js" target="_blank" rel="noreferrer">test/vite-shapes.test.js</a>),
          <code>next-middleware-shapes</code> (2 attacks - the middleware
          subrequest header's known bypass grammar plus a value-blindness
          canary that must never unlock a gated route, pinned in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/next-mw-shapes.test.js" target="_blank" rel="noreferrer">test/next-mw-shapes.test.js</a>),{
          ' '}
          and the three WordPress packs over the v0.3 subprocess wire{' '}
          (NDJSON over stdio - a wire format, not a transport):
          <code>wp-stock-smoke</code> (4 attacks - the stock-WordPress smoke:
          dispatch, real-SQL metering, call/option gates),{' '}
          <code>wp-money-shapes</code> (3 attacks - the armedByKey option
          ceremony), and <code>wp-roles</code> (3 attacks, experimental -
          role/capability shapes). Pack oracles are pinned where their teeth
          live: the per-pack files linked above, the shared census in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/pack-fixtures.test.js" target="_blank" rel="noreferrer">test/pack-fixtures.test.js</a>, and the tarball-shape pins in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/packaging.test.js" target="_blank" rel="noreferrer">test/packaging.test.js</a>.
          Same verdicts, same ledger, still zero sockets.
        </p>
        <p className="field-report">
          Field-report from the target we trust least: our own code. This repo
          dogfoods itself in CI - runs we did on ourselves. The committed ledger
          holds <span className="ok">49 REFUSED findings</span> on our own hardened demo
          app, and the self-site run paid for one real bug: the shipped version endpoint
          once answered a malformed registry payload with <span className="bad">200 and no
          version key</span>. Found, fixed, never regressing again - pinned by the
          version-grammar probe (plus the session probes: a cookie-less site
          must mint zero cookies, and a forged cookie is never adopted) pinned in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/site-pack.test.js" target="_blank" rel="noreferrer">test/site-pack.test.js</a>.{' '}
          <span className="ok">That&apos;s the product working:</span> your handlers - ours -
          paying for their own bugs with hardening receipts.
        </p>
      </div>
    </section>
  )
}
