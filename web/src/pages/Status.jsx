/**
 * pages/Status.jsx - the family-status page (crashtest#47 follow-up): the
 * fam table moved OUT of the dashboard onto its own /status route, so every
 * member reads the same shape at the same path. The dashboard stays the
 * ledger renderer (findings, gate, cost economics); /status is the family
 * surface. Same honest-data rule: the island fetches the siblings' served
 * /status.json at load, no server, no guessed numbers. Refresh to re-read.
 */
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'
const RAW = 'https://github.com/dhaupin/crashtest/blob/main'

export default function Status() {
  usePageMeta({
    siteUrl: SITE_URL,
    path: '/status',
    title: 'Family status | Crashtest',
    description:
      'The family-status@1 dialect: every struct-family member serves its committed-ledger verdicts at /status.json, generated on every web build, and reads the others with the same schema.',
  })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">one dialect, every member</p>
          <h1>
            The family, <span className="accent">one status.</span>
          </h1>
          <p className="lede">
            crashtest serves its own adversarial verdicts at{' '}
            <code>/status.json</code>, generated from the committed ledger on
            every web build. This page reads its own file and the family's the
            way a fresh agent session would - no server, no numbers fresher
            than the commits. Refresh to re-read.
          </p>
          <div className="cta-row">
            <a className="btn btn-ghost" href="/status.json">/status.json</a>
            <a className="btn btn-ghost" href={`${RAW}/labs/crashledger.json`}>labs/crashledger.json</a>
            <a className="btn btn-ghost" href="https://github.com/dhaupin/crashtest/actions/workflows/test.yml">CI runs</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>The family, one dialect</h2>
          <p className="sub">
            Every member serves the same status contract: one schema, one
            fixed path, ledger-derived numbers only.
          </p>
          <pre-island data-pre-island="family-status" data-pre-load="idle">
            <span className="island-loading">Reading the family's served status files...</span>
          </pre-island>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>What you are looking at</h2>
          <p className="sub">
            Each number is a receipt from a CI leg, not a marketing claim.
          </p>
          <div className="grid">
            <div className="card">
              <h3><span className="glyph">◉</span> the dogfood ledger</h3>
              <p>The committed verdict ledger (<code>labs/crashledger.json</code>):
              crashtest eating its own cooking - the seeded attack run over the
              hardened demo app. A new EXPLOITED fails CI; a verdict change fails
              until re-baselined.</p>
            </div>
            <div className="card">
              <h3><span className="glyph">⇄</span> packs shipped</h3>
              <p>The packstruct@1 packs this repo exports, each with its declared
              attack count read from the pack bank itself. A pack the campaign
              never fires is refused, never served as zero.</p>
            </div>
            <div className="card">
              <h3><span className="glyph">✗</span> one bad sibling</h3>
              <p>A member not serving the dialect yet renders its own honest
              "not serving" row - never a guessed number, never a default PASS.
              One bad sibling degrades only its own row.</p>
            </div>
            <div className="card">
              <h3><span className="glyph">✓</span> exploited, ever</h3>
              <p>The only number that should always read 0. If it does not, the
              next CI run is red and the fix comes before any release post cites
              these ledgers again.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
