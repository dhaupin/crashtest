/**
 * pages/About.jsx - who builds crashtest, the family it belongs to, and the
 * license and provenance terms. The legal pages carry the surface facts.
 */
import { Link } from '../router-interop.js'
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

export default function About() {
  usePageMeta({
    siteUrl: SITE_URL,
    path: '/about',
    title: 'About | Crashtest',
    description:
      'Who builds crashtest, the struct family it belongs to, the dogfood stance, and the MIT license and provenance terms.',
  })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">about</p>
          <h1>
            Built in the open, <span className="accent">hardened by its own attacks.</span>
          </h1>
          <p className="lede">
            Crashtest is one arm of the struct family: a set of small tools that
            keep a suite of repos honest about itself. It is authored and
            maintained in public.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="https://github.com/dhaupin/crashtest">See the repo</a>
            <a className="btn btn-ghost" href="https://docs.creadev.org/crashtest/about/principles">Read the principles</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">Who builds it</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Crashtest is built by{' '}
            <a href="https://creadev.org" target="_blank" rel="noreferrer">Rook @ Creadev.org</a>{' '}
            and by AI agents working in the open. Every change lands through a
            pull request with its gates run, and the repo history keeps the
            receipts.
          </p>
          <p className="lede" style={{ marginTop: 8 }}>
            The target we trust least is our own code. The repo dogfoods itself
            in CI: the committed ledger holds 49 REFUSED findings on our own
            hardened demo app, and that run has already paid for real bugs.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">The struct family</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Crashtest does not stand alone. The spec is{' '}
            <a href="https://github.com/dhaupin/packstruct">packstruct</a>; the
            artifact audit is{' '}
            <a href="https://github.com/dhaupin/poststruct">poststruct</a>; the
            visual memory is{' '}
            <a href="https://github.com/dhaupin/eyestruct">eyestruct</a>; the
            governance layer is{' '}
            <a href="https://github.com/dhaupin/govstruct">govstruct</a>; the
            factory is{' '}
            <a href="https://github.com/dhaupin/monoforge">monoforge</a>. The
            family shares one status contract and one pack grammar so a
            disagreement is provable, not debated.
          </p>
          <p style={{ marginTop: 22 }}>
            <Link to="/status" className="btn btn-ghost">See the family status</Link>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="section-title">License and provenance</h2>
          <p className="lede" style={{ marginTop: 8 }}>
            Crashtest is MIT-licensed. The tool and the site are both open
            source, so the honest summary is: read the code. The{' '}
            <Link to="/terms">terms</Link> and <Link to="/privacy">privacy</Link>{' '}
            pages carry the surface facts in plain language.
          </p>
        </div>
      </section>
    </>
  )
}
