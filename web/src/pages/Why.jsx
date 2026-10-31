/**
 * pages/Why.jsx - why crashtest exists: agent-built apps ship fast and ship
 * holes, and a pentest or a SAST read cannot catch a behavioral one. The
 * landing face of the doctrine; the deep rules live in docs/about/principles.
 */
import { Link } from '../router-interop.js'
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

export default function Why() {
  usePageMeta({
    siteUrl: SITE_URL,
    path: '/why',
    title: 'Why | Crashtest',
    description:
      'Agent-built apps ship fast and ship holes. Why behavioral attacks - in-process, seeded, ledgered - catch what a SAST read or a live pentest cannot.',
  })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">why</p>
          <h1>
            Attack code, <span className="accent">not people.</span>
          </h1>
          <p className="lede">
            An agent can build a working app in an afternoon and ship a
            privilege hole in the same commit. The code runs; nothing looked at
            what it does when someone lies to it.
          </p>
          <div className="cta-row">
            <Link className="btn btn-primary" to="/what">What crashtest is</Link>
            <a className="btn btn-ghost" href="https://docs.creadev.org/crashtest/about/principles">Read the principles</a>
            <a className="btn btn-ghost" href="https://github.com/dhaupin/crashtest">See the repo</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The problem: code that runs is not code that holds</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            SAST tools read your code and never run it, so a behavioral hole
            survives review. Live pentest tools need a server and network
            traffic, which is the wrong shape for a solo dev or an agent loop
            and gets throttled by hosts. Neither one answers the question that
            matters: what does this handler do when a request lies about who it
            is.
          </p>
          <p className="lede" style={{ marginTop: 8 }}>
            Crashtest answers that by running the code, in-process, with seeded
            attacks and cost accounting. It is behavioral QA before deploy, not
            a read of the source.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The thesis: no sockets, and receipts that fail</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Every request is an in-process WHATWG <code>Request</code> handed to
            a registered handler. The fake transport is the product:
            deterministic, fast, safe to point anywhere, and impossible to ban
            because no firewall ever sees a packet. Same commit, same findings,
            forever.
          </p>
          <p className="lede" style={{ marginTop: 8 }}>
            The run produces a committed ledger, and CI fails only on a new{' '}
            <span className="bad">EXPLOITED</span> finding or a{' '}
            <span className="bad">REFUSED-to-EXPLOITED</span> regression - things
            that held yesterday and broke today. Findings are receipts, never a
            verdict about the humans who wrote the code.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">Who it is for</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Anyone shipping an app they cannot fully test: the solo dev who has
            no security team, the agent loop that needs a wall before deploy,
            and the CI that has to fail the commit that reopened a closed hole.
          </p>
          <p style={{ marginTop: 22 }}>
            <Link to="/what" className="btn btn-ghost">Next: what crashtest is</Link>
          </p>
        </div>
      </section>
    </>
  )
}
