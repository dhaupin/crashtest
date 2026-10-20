import { Link } from 'react-router-dom'
import usePageMeta from '../hooks/usePageMeta.js'

export default function Privacy() {
  usePageMeta({ path: '/privacy', title: 'Privacy | Crashtest', description: 'What crashtest and this site collect: the CLI collects nothing, runs stay on your machine, and the site tracks nothing hidden.' })
  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="wrap legal">
        <p className="eyebrow">The short version first</p>
        <h2>Privacy</h2>
        <p className="sub">
          The CLI collects <strong>nothing</strong>. Runs are in-process, so
          your source and findings never leave your machine. This site keeps
          its own honesty standard: no hidden state and no silent tracking — just docs.
        </p>

        <h3>The crashtest tool</h3>
        <ul>
          <li><strong>No telemetry</strong> — the CLI collects zero data, makes no network calls, phones no home</li>
          <li><strong>Your findings stay yours</strong> — reports and ledgers are files in your repo, under your control</li>
          <li><strong>Never a secret</strong> — fake values arm the watermark probes; the docs, not the source, matter</li>
          <li><strong>npm install traffic</strong> — npm's own registry logging applies, as with any package; we see none of it</li>
        </ul>

        <h3>This website</h3>
        <ul>
          <li><strong>No accounts, no forms, no in-browser state</strong> — information isn't collected about you</li>
          <li><strong>Standard hosting logs</strong> — Cloudflare Pages may keep request logs (IP, timestamp); we neither buy, query, nor sell them</li>
          <li><strong>Analytics</strong> — none configured; if a hosting-added beacon is ever enabled by zone policy, it will be listed here rather than hiding</li>
          <li><strong>Cookies</strong> — none set by us; the site dwells in cookie-free simplicity</li>
        </ul>

        <h3>Third parties, named</h3>
        <p>
          This site runs on <a href="https://pages.cloudflare.com" target="_blank" rel="noopener">Cloudflare Pages</a>; the
          npm package lives on <a href="https://www.npmjs.com" target="_blank" rel="noopener">npmjs.com</a>; releases are signed through <a href="https://www.sigstore.dev" target="_blank" rel="noopener">Sigstore</a>.
          Their own policies govern their own logging. No other third parties
          are involved.
        </p>

        <h3>Data retention</h3>
        <p>
          Nothing of yours to retain. Permanent artifacts stay in your repos,
          not ours.
        </p>

        <h3>Questions</h3>
        <p>
          Open an issue on the <a href="https://github.com/dhaupin/crashtest" target="_blank" rel="noopener">repository</a> — it's
          checked. If you want to inspect rather than ask: the CLI and the
          site are both open source, so treat this page as a summary of code
          you can go read.
        </p>

        <p style={{ marginTop: 26 }}>
          <Link to="/" className="btn btn-ghost">Back to the harness</Link>
        </p>
      </div>
    </section>
  )
}
