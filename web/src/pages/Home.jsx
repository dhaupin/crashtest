import { Link } from '../router-interop.js'
import usePageMeta from '../hooks/usePageMeta.js'

const SITE_URL = 'https://crashtest.creadev.org'

export default function Home() {
  // Hook call lives in the COMPONENT BODY (prestruct's hook updates head tags
  // via its own effect). Calling it inside another effect was an invalid hook
  // call - React #321 in production tore the tree down (flash of theme, then
  // black screen) - found with headless Chromium on the live site.
  usePageMeta({ siteUrl: SITE_URL, path: '/', title: 'Crashtest - adversarial QA for agent-built apps', description: 'Seeded, in-process attack suite that produces a hardening ledger your CI fails on regressions.' })
  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">Every request is an in-process WHATWG Request</p>
          <h1>
            Attack code, not people.<br />
            <span className="accent">No sockets. Ever.</span>
          </h1>
          <p className="lede">
            Crashtest drives a seeded adversarial suite against your real handlers -
            routing, guards, state, volume - through a fake transport. The output is a
            hardening ledger your CI fails on new {'EXPLOITED'} findings or a{'\n'}            {'REFUSED->EXPLOITED'} regression. Same commit, same findings, forever.
          </p>
          <div className="cta-row">
            <a className="btn btn-primary" href="https://docs.creadev.org/crashtest/getting-started/quick-start">Read the quick start {'->'}</a>
            <a className="btn btn-ghost" href="/dashboard">See the ledger dashboard</a>
            <pre-island data-pre-island="version-badge" data-pre-load="visible">
              <a className="btn btn-ghost" href="https://www.npmjs.com/package/crashtest" target="_blank" rel="noreferrer">npm / crashtest</a>
            </pre-island>
            <a className="btn btn-ghost" href="/faq">FAQ</a>
            <a className="btn btn-ghost" href="https://github.com/dhaupin/crashtest" target="_blank" rel="noreferrer">View on GitHub</a>
            <a className="btn btn-ghost" href="https://docs.creadev.org/crashtest/">Full docs</a>
          </div>
          <pre className="code"><span className="cm"># 60 seconds - point it at your handlers</span>{'\n'}npx <span className="k">crashtest</span> <span className="k">init</span>{'\n'}<span className="cm"># edit crashtest.config.js - routes list your handlers, env the fake d1/kv/secrets</span>{'\n'}npx <span className="k">crashtest</span> <span className="k">run</span>{'\n'}<span className="cm">{'# -> labs/hardening.md / labs/crashledger.json / exit 0 = hold, exit 1 = a finding regressed'}</span>{'\n\n'}<span className="ok">🛡 EFF.</span> auth/secret-watermark  <span className="ok">🛡</span> guards/burst-wall      <span className="ok">🛡</span> state/enumeration-oracle{'\n'}<span className="bad">⚡</span> guards/hygiene-no-store <span className="dim">(2xx write with no Cache-Control - real findings look like this)</span></pre>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>The pipeline</h2>
          <p className="sub">How a run turns handlers into evidence.</p>
          <div className="pipeline">
            <div className="pipe-step"><span className="pipe-n">01</span><strong>Declare your surface</strong><span>name each handler or register a framework adapter - hono, express, fastify, or raw Node dispatch.</span></div>
            <div className="pipe-step"><span className="pipe-n">02</span><strong>The harness fires</strong><span>every request is an in-process <code>Request</code>; the fake d1/kv/env mirrors your backend. Nothing leaves the process.</span></div>
            <div className="pipe-step"><span className="pipe-n">03</span><strong>Scenario modules attack</strong><span>identity spoofing, secret watermarking, proto pollution, burst walls, storage fill, cost amplification - each returns REFUSED / EXPLOITED / BOUNDED / PASSED.</span></div>
            <div className="pipe-step"><span className="pipe-n">04</span><strong>The ledger remembers</strong><span>crashledger.json is your committed baseline. New exploited finding? Exit 1. Regressed refusal? Exit 1. Attach hardening.md to the PR.</span></div>
            <div className="pipe-step"><span className="pipe-n">05</span><strong>Share the attacks</strong><span>packs travel: <code>packs:</code> accepts any directory on disk - another repo's checkout, a vendored npm module - and a self-contained pack bundles its own imports, so adopting it is one config line.</span></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Why it exists</h2>
          <p className="sub">LLMs write programs fast. Programs that route, store, and spend budget need their own fire drill.</p>
          <div className="grid">
            <div className="card"><h3><span className="glyph">section </span>Fail at cause, loudly</h3><p>No swallowed errors, no phantom 200s - a handler that never ends its response is surfaced as a finding, not papered over.</p></div>
            <div className="card"><h3><span className="glyph">section </span>Deterministic attacks</h3><p>Seeded RNG from commit to commit. A scratch-run today reproduces bit-for-bit in CI tomorrow.</p></div>
            <div className="card"><h3><span className="glyph">section </span>Cost-aware from day one</h3><p>Every request is accounted in ops - amplification attacks get named per-request and bounded, not vibes.</p></div>
            <div className="card"><h3><span className="glyph">section </span>Fits CI, not just dev</h3><p>Zero runtime deps, plain Node, one command. Plus a composite GitHub Action to gate other repos.</p></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Questions people ask first</h2>
          <p className="sub">The short versions. Full answers on the <Link to="/faq">FAQ page</Link>.</p>
          <div className="grid">
            <div className="card"><h3>Is it safe on real code?</h3><p>Yes - that is the whole design. No socket, no network, no live server: your handlers receive in-process <code>Request</code> objects backed by a fake D1/KV/env. Nothing leaves the process.</p></div>
            <div className="card"><h3>How is it different from SAST or pentest tools?</h3><p>Scanners read code and never run it, so behavioral holes survive. Pentest tools need a live server and traffic. Crashtest runs the real handlers - in-process - before deploy.</p></div>
            <div className="card"><h3>What does CI actually gate on?</h3><p>Exit 1 only on a NEW EXPLOITED finding or a REFUSED-to-EXPLOITED regression. Accepted risks with an owner + bound never re-alarm. Undeclared routes degrade to skipped-REFUSED - never a false positive.</p></div>
            <div className="card"><h3>Can I write my own attacks?</h3><p>Yes - packs, and they travel. One ESM file matching a small contract in <code>packs/public/</code> (tracked) or <code>packs/local/</code> (gitignored); a self-contained pack's manifest can even bundle its own imports so adopting it takes <em>zero</em> config wiring. <code>run --module-plan</code> shows exactly what would fire.</p></div>
          </div>
        </div>
      </section>
    </>
  )
}
