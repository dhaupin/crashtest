import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

const MODULES = [
  {
    mod: 'auth',
    attacks: [
      ['identity-spoof-headers', 'Spoofs the whole 54-header identity matrix (x-is-admin, x-user-role, x-forwarded-for...) at a privileged route', 'any handler that reads identity straight from wire headers'],
      ['secret-watermark', 'Plants fake secrets in env, probes error paths - a leaked secret means some error string echoed it', 'handlers that template raw error text'],
      ['privilege-escalation', 'Replays owner-b claims over owner-a writes (writer/victim pairs)', 'routes that accept an owner field without checking the caller'],
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
    mod: 'input',
    attacks: [
      ['proto-pollution-body', 'Feeds __proto__/constructor keys through JSON bodies (JSON.stringify silently DROPS them - hostileSerialize is built to keep them on the wire)', 'recursive-merge handlers that spread untrusted bodies'],
      ['never-fail-mutations', '64 hostile bodies (huge ids, nested types, unicode tricks) - any failure mode past a 4xx is a finding', 'mutation routes without shaped rejection'],
      ['oversized-field', '1MB fields, deep nesting, giant arrays', 'handlers without a body limit'],
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
    ],
  },
]

export default function Attacks() {
  // Hook in the component body (see Home for the #321 flash-then-black lesson).
  usePageMeta({ siteUrl: SITE_URL, path: '/attacks', title: 'Attack catalog | Crashtest', description: 'Every shipped crashtest scenario module and attack, with the real findings the first external run produced.' })
  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <p className="eyebrow">Scenario catalog / v0.1</p>
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
        <p className="field-report">
          Field-report from the target we trust least: our own code. This repo
          dogfoods itself in CI - runs we did on ourselves. The committed ledger
          holds <span className="ok">13 REFUSED findings</span> on our own hardened demo
          app, and the self-site run paid for one real bug: the shipped version endpoint
          once answered a malformed registry payload with <span className="bad">200 and no
          version key</span>. Found, fixed, never regressing again - pinned by the
          site/registry-hostile-statuses probe in{' '}
          <a href="https://github.com/dhaupin/crashtest/blob/main/test/self-site.test.js" target="_blank" rel="noreferrer">test/self-site.test.js</a>.{' '}
          <span className="ok">That&apos;s the product working:</span> your handlers - ours -
          paying for their own bugs with hardening receipts.
        </p>
      </div>
    </section>
  )
}
