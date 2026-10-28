import { Link } from '../router-interop.js'
import usePageMeta from '../hooks/usePageMeta.js'

const FAQS = [
  {
    q: 'What does crashtest actually do?',
    a: <>It fires seeded attacks (identity spoofing, privilege decision probes, prototype pollution, session fixation and replay windows, request-shape floods, stack-overflow and backtracking probes, multipart upload shapes, same-key bursts and concurrent write races, credential stuffing, memory-discipline and governance probes - 49 across 14 modules) at your <strong>real</strong> route handlers inside your own Node process. Each attack returns one verdict: REFUSED (your defense held), EXPLOITED (you got hit), BOUNDED (a known risk with an owner and a bound), or PASSED (the safe path held - evidence, never a finding). Everything lands in a machine ledger your CI diffs against.</>,
  },
  {
    q: 'Is it safe to run on my real codebase?',
    a: <>Yes - that is the point. There is no socket, no network traffic, no live server. The harness hands your handlers in-process WHATWG <code>Request</code> objects backed by a fake D1/KV/env backend. Nothing leaves your machine, and nothing in the ledger can be a false positive from a flaky network, because there is no network.</>,
  },
  {
    q: 'How does it avoid ban waves and Cloudflare rate limits?',
    a: <>It cannot get banned: every request is an in-process function call, never a socket. Probe the same handler 8000 times and no firewall ever sees a packet. This is also why runs are deterministic and fast (the PRD metric is &lt;60s on a small API).</>,
  },
  {
    q: 'How is this different from a pentest or a SAST scanner?',
    a: <>SAST tools (semgrep, CodeQL) read your code but never run it, so behavioral holes survive review. Pentest tools (ffuf, nuclei, ZAP) need a live server and network traffic - the wrong shape for a solo dev or an agent loop, and hosts throttle them. Crashtest is behavioral QA <em>before</em> deploy: it runs the code, in-process, with cost accounting and a regression ledger.</>,
  },
  {
    q: 'What is the ledger and why does CI care about it?',
    a: <><code>labs/crashledger.json</code> records every attack id and its verdict. CI fails ONLY on a NEW EXPLOITED finding or a REFUSED-to-EXPLOITED regression - things that were fine yesterday that broke today. Accepted risks (with an owner and a bound on file) never re-alarm. That is the whole exit contract.</>,
  },
  {
    q: 'What is an accepted risk (BOUNDED)?',
    a: <>A risk you decided is worth taking, recorded with a named owner and an explicit bound ("rate-limiting deferred to the paid tier", bound = the limit value). A BOUNDED without owner + bound is demoted to EXPLOITED - an accepted risk without accountability is a finding, not a shrug.</>,
  },
  {
    q: 'Can I write my own attacks?',
    a: <>Yes - that is the pack system. An attack is an ESM module matching a small contract: <code>{'{ name, description, attacks: [{ name, run(harness, ctx) }] }'}</code>. Drop it in <code>packs/public/</code> (tracked, sharable) or <code>packs/local/</code> (gitignored, private). The seeded context is deterministic so your pack is reproducible like everything else.</>,
  },
  {
    q: 'Does it work with my framework?',
    a: <>Shipped adapters: Cloudflare Pages Functions shape (plain handlers), Hono (<code>app.request()</code>), Express (<code>app.handle()</code>), Fastify (<code>app.inject()</code>), raw <code>http.createServer</code> handlers, and a WordPress subprocess spike (NDJSON over stdio - still no sockets). Multiple routes on one dispatching app? Use routeAliases. Playbooks per framework are in the <a href="https://docs.creadev.org/crashtest/playbooks/">docs</a>.</>,
  },
  {
    q: 'What backends does the fake env support?',
    a: <>D1-style SQL (a real SQL-subset engine in-process - tables, uniques, seeds, D1-shaped error messages other attacks chain on), KV namespaces, secrets, and vars. You seed it with the shape of your real schema so the attacks exercise the real branching, and plant FAKE secrets to verify nothing ever echoes them.</>,
  },
  {
    q: 'Can I attack with community attacks, not just the built-ins?',
    a: <>One extension surface, three ways in - all one contract, one campaign. A <strong>pack</strong> is a bundle in your repo (<code>packs/public/</code> tracked, <code>packs/local/</code> gitignored) with a manifest entry. A pack can also be <strong>self-contained</strong>: its manifest lists bundled <code>plugins</code> imports (npm packages or files the pack itself ships), so adopting it takes zero config wiring. And a <strong>config-direct</strong> <code>plugins: ['&lt;npm-package&gt;', './shims/wallet-profile.js']</code> knob imports scenario modules that belong to no pack. A broken/unresolvable import fails the run loudly naming the file wherever it came from. Docs: <a href="https://docs.creadev.org/crashtest/reference/packs">packs</a> and <a href="https://docs.creadev.org/crashtest/reference/plugins">plugin imports</a>.</>,
  },
  {
    q: 'Do packs have to live in the repo under attack?',
    a: <>No - and a pack can be fully self-contained. A pack's <code>pack.json</code> can list bundled imports (<code>"plugins": ["./extra.js", "some-npm-pack"]</code>) resolved against the pack's own directory, so it ships its whole attack surface - entry + imports - with <strong>zero config wiring</strong> for whoever adopts it. And <code>packs:</code> in the config accepts any directory on disk: another repo's checked-out <code>packs/</code>, a vendored npm module, or a single pack dir. The module plan still labels which pack (and which repo) every row came from. Docs: <a href="https://docs.creadev.org/crashtest/reference/packs">packs</a>.</>,
  },
  {
    q: 'Does it help me adopt an agent-builder export (Lovable, Bolt, Replit)?',
    a: <><code>crashtest preset lovable|bolt|replit --root &lt;dir&gt;</code> generates a starter config from what the repo ACTUALLY contains - Supabase Edge Function layouts, TanStack Start markers, the .replit run command, package.json shape. It never guesses a handler from the builder name: if the export has no server handlers (a static SPA) it says so, and anything it cannot resolve lands in warnings naming the exact files to wire by hand. Docs: <a href="https://docs.creadev.org/crashtest/reference/presets">presets</a>.</>,
  },
  {
    q: 'What do exit codes mean in CI?',
    a: <>0: baseline held. 1: a NEW EXPLOITED finding, or a previously-REFUSED surface that regressed. 2: configuration problem (missing or malformed config/baseline) - the run is untrustworthy, which is different from "your app is weak". Never a false positive on undeclared routes: those degrade to skipped-REFUSED.</>,
  },
  {
    q: 'Does it know about known CVEs?',
    a: <>Yes - through the shipped <strong>cve-feed</strong> pack. It cross-references a curated, committed KEV/NVD snapshot (currently 27 entries from the actively-exploited list and their NVD ranges) against what your surface actually discloses: <code>kev-banner-audit</code> sweeps every declared route for banner and stack-tell disclosure, and <code>kev-version-range-audit</code> checks any disclosed version against the snapshot&apos;s vulnerable ranges. It is deliberately offline: run time reads only the committed snapshot file - no sockets, no CVE feed subscriptions - so runs stay deterministic (same commit, same verdicts) and finding freshness is a maintainer-side sync you control. Match tokens are word-boundary-safe (the token <code>ws</code> never matches inside the word <code>answer</code>).</>,
  },
  {
    q: 'Who builds with this?',
    a: <>Agent developers who want a hardening pass as part of "done" (the primary audience - it is built to run in the agent loop), solo and small-OSS maintainers who cannot afford a pentest, and security-minded teams as a first-pass filter before human review.</>,
  },
  {
    q: 'How much does it cost?',
    a: <>Nothing. MIT-licensed, zero runtime dependencies, no account, no telemetry, no network. The npm package ships with signed provenance you can verify.</>,
  },
]

export default function FAQ() {
  usePageMeta({ path: '/faq', title: 'FAQ | Crashtest', description: 'Crashtest FAQ: what it does, safety on real code, how it differs from pentest/SAST tools, the ledger and CI exit contract, BOUNDED risks, writing your own attack packs, framework support.' })
  return (
    <section className="section" style={{ paddingTop: 56 }}>
      <div className="wrap legal">
        <p className="eyebrow">Straight answers</p>
        <h2>Frequently asked questions</h2>
        <p className="sub">If a question is missing here, the <a href="https://docs.creadev.org/crashtest/">docs</a> go deeper - this page is the short version.</p>

        {FAQS.map((f, i) => (
          <div key={i} style={{ marginBottom: 22 }}>
            <h3 style={{ marginBottom: 6 }}>{f.q}</h3>
            <p style={{ marginTop: 0 }}>{f.a}</p>
          </div>
        ))}

        <p style={{ marginTop: 26 }}>
          <Link to="/attacks" className="btn btn-ghost">See the attack catalog</Link>
          {' '}
          <Link to="/dashboard" className="btn btn-ghost">Render your first ledger</Link>
        </p>
      </div>
    </section>
  )
}
