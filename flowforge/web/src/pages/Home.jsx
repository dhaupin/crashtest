/**
 * pages/Home.jsx - the shell's placeholder landing. Replace the copy, keep
 * the structure: the terminal block shows the shared token classes (.k/.cm)
 * that match the docs Rouge output; the switch + palette come from styles.css.
 */
export default function Home() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="eyebrow">flowforge shell</p>
        <h1 className="hero">
          One repo, two sites, <span className="accent">zero styling drift.</span>
        </h1>
        <p className="lede">
          This is the flowforge rig: landing + docs + CI/release plumbing, with your
          brand as data. Replace the tokens, the nav vocabulary, and the copy - the
          shell carries the paid-for correctness (prerender, hydration parity,
          light/dark switch, search, pagefind, deploy workflows).
        </p>
        <pre className="code"><span className="cm"># 60 seconds - the shell is real pages, not a prototype</span>{'\n'}npx prestruct build{'\n'}<span className="cm"># {'>'} dist/, one directory per route, hydrates with zero mismatch</span></pre>
        <div className="hero-actions">
          <a className="btn-primary" href="https://github.com/your-org/your-site">See the repo</a>
          <a className="btn-ghost" href="/docs/">Read the docs</a>
        </div>
      </div>
    </section>
  )
}
