/**
 * pages/What.jsx - the concrete surface: the attack catalog, the verdict
 * vocabulary, and the ledger/exit contract. Deep reference lives in
 * docs/reference/.
 */
import { Link } from '../router-interop.js'
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

export default function What() {
  usePageMeta({
    siteUrl: SITE_URL,
    path: '/what',
    title: 'What | Crashtest',
    description:
      'A CLI that fires 49 seeded attacks across 14 modules at your real handlers in-process, returns REFUSED / EXPLOITED / BOUNDED / PASSED, and writes a committed ledger your CI gates.',
  })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">what</p>
          <h1>
            One CLI, <span className="accent">a seeded attack suite.</span>
          </h1>
          <p className="lede">
            Crashtest is a command-line test runner with a security harness.
            Point it at your handlers, and it fires seeded attacks in your own
            Node process, then writes a hardening ledger.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/attacks">The attack catalog</Link>
            <a className="btn btn-ghost" href="https://docs.creadev.org/crashtest/reference/cli">CLI reference</a>
            <a className="btn btn-ghost" href="https://github.com/dhaupin/crashtest">See the repo</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The verbs</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Init the ledger, run the suite, lint the packs, gate CI.
          </p>
          <pre className="code"><span className="cm"># write the ledger + scenario config</span>{'\n'}<span className="k">crashtest</span> <span className="k">init</span>{'\n'}{'\n'}<span className="cm"># fire the seeded attacks at your handlers</span>{'\n'}<span className="k">crashtest</span> <span className="k">run</span>{'\n'}{'\n'}<span className="cm"># CI: fail on a NEW EXPLOITED or a REFUSED-&gt;EXPLOITED regression</span>{'\n'}<span className="k">crashtest</span> <span className="k">run</span> --ci</pre>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The verdicts</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Every attack returns exactly one verdict:{' '}
            <span className="ok">REFUSED</span> (your defense held),{' '}
            <span className="bad">EXPLOITED</span> (you got hit),{' '}
            <span className="warn">BOUNDED</span> (a known risk with an owner and
            a bound), or <span className="ok">PASSED</span> (the safe path held -
            evidence, never a finding).
          </p>
          <p className="lede" style={{ marginTop: 8 }}>
            The catalog is 49 attacks across 14 modules: identity spoofing,
            privilege-decision probes, prototype pollution, session fixation and
            replay, request-shape floods, stack and backtracking probes,
            multipart uploads, same-key bursts, concurrent write races,
            credential stuffing, memory discipline, and governance probes.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The ledger and the exit contract</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            <code>labs/crashledger.json</code> records every attack id and its
            verdict. CI fails ONLY on a new EXPLOITED finding or a
            REFUSED-to-EXPLOITED regression. Accepted risks, with an owner and a
            bound on file, never re-alarm. That is the whole exit contract.
          </p>
          <p className="lede" style={{ marginTop: 8 }}>
            The ledger travels: the packs are self-contained and ride the same
            grammar as <a href="https://github.com/dhaupin/poststruct">poststruct</a>'s
            checker packs, so a scenario written once runs in any repo that
            adopts it.
          </p>
          <p style={{ marginTop: 22 }}>
            <Link to="/about" className="btn btn-ghost">Next: about the project</Link>
          </p>
        </div>
      </section>
    </>
  )
}
