import { useEffect } from 'react'
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

const MODULES = [
  {
    mod: 'auth',
    attacks: [
      ['identity-spoof-headers', 'Spoofs the whole 54-header identity matrix (x-is-admin, x-user-role, x-forwarded-for…) at a privileged route', 'any handler that reads identity straight from wire headers'],
      ['secret-watermark', 'Plants fake secrets in env, probes error paths — a leaked secret means some error string echoed it', 'handlers that template raw error text'],
      ['privilege-escalation', 'Replays owner-b claims over owner-a writes (writer/victim pairs)', 'routes that accept an owner field without checking the caller'],
    ],
  },
  {
    mod: 'guards',
    attacks: [
      ['hygiene-no-store', 'Every 2xx write must carry store class (no-store / private / explicit immutable) — mandated by HTTP cache semantics', 'handlers that write without cache directives'],
      ['burst-wall', '50-request burst; measures 5xx/429/timeout and the Retry-After wall', 'routes exposed to sustained load'],
    ],
  },
  {
    mod: 'input',
    attacks: [
      ['proto-pollution-body', 'Feeds __proto__/constructor keys through JSON bodies (JSON.stringify silently DROPS them — hostileSerialize is built to keep them on the wire)', 'recursive-merge handlers that spread untrusted bodies'],
      ['never-fail-mutations', '64 hostile bodies (huge ids, nested types, unicode tricks) — any failure mode past a 4xx is a finding', 'mutation routes without shaped rejection'],
      ['oversized-field', '1MB fields, deep nesting, giant arrays', 'handlers without a body limit'],
    ],
  },
  {
    mod: 'state',
    attacks: [
      ['enumeration-oracle', 'Arms mustDenyIds, probes each — 200s (or content ripples) mean foreign rows leak by guessable id', 'GET-by-id without ownership checks'],
      ['id-collision-alias', 'Two owners claim the same id; the env snapshot diff decides — owner-a\'s row silently overwritten in place is a finding', 'write routes without unique constraints'],
    ],
  },
  {
    mod: 'volume',
    attacks: [
      ['credential-stuffing', '60 staged credential attempts across the route', 'unbounded auth surfaces'],
      ['storage-fill', '30 rounds of 8KB unique writes; tracks op cost AND storage growth per round', 'kv-writing routes without a fill budget'],
      ['cost-amplification', '40 identical replays; maxWall sets the accepted ceiling — under it, REFUSED with the measured ops/request', 'handlers doing table scans per request'],
    ],
  },
]

export default function Attacks() {
  useEffect(() => {
    usePageMeta({ siteUrl: SITE_URL, path: '/attacks', title: 'Attack catalog | Crashtest', description: 'Every shipped crashtest scenario module and attack, with the real findings the first external run produced.' })
  }, [])
  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="wrap">
        <p className="eyebrow">Scenario catalog · v0.1</p>
        <h2>All shipped attacks</h2>
        <p className="sub">
          Drop extra modules into <code>labs/scenarios/</code> (or any dir via config
          <code> scenarioDirs</code>); each returns REFUSED 🛡 / EXPLOITED ⚡ / BOUNDED 🔒. BOUNDED requires an owner+bound or it demotes to EXPLOITED — loud, per the PRD principle.
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
          Field-report from the first external target (a real, unaudited repo —{' '}
          <a href="https://github.com/dhaupin/vant" target="_blank" rel="noreferrer">vant&apos;s raw http server</a>):
          the suite produced <span className="bad">five real findings</span> — 2xx writes shipping with{' '}
          <span className="bad">no Cache-Control</span> (<a href="https://github.com/dhaupin/vant/issues/214" target="_blank" rel="noreferrer">vant #214</a>),{' '}
          abuse landing as <span className="bad">500s instead of honest refusals</span> ({' '}
          <a href="https://github.com/dhaupin/vant/issues/215" target="_blank" rel="noreferrer">vant #215</a>: burst, hostile bodies, stuffing, sustained fills){' '}
          — while every foreign-id oracle, oversized-body (413), and secret-watermark probe held. <span className="ok">That&apos;s the product working:</span> your handlers paying for their own bugs with hardening receipts.
        </p>
      </div>
    </section>
  )
}
