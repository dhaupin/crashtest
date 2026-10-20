import { useMemo, useState } from 'react'
import usePageMeta from '../hooks/usePageMeta.js'
import { parseArtifact, prettyDate, VERDICTS } from '../lib/ledgerModel.js'
import { dogfood }      from '../lib/dogfoodSnapshot.js'

const SITE_URL = 'https://crashtest.creadev.org'

/**
 * src/pages/Dashboard.jsx — "the ledger, rendered."
 *
 * The page is fully static at prerender (default view = the committed dogfood
 * baseline) and hydrates like any other route; all state lives client-side.
 * There is no backend be here: the ledger bridge (src/lib/ledgerModel.js) is a
 * pure module, data gets in by bundled snapshot / paste / file / user URL.
 */

function initialModel() {
  return parseArtifact(dogfood.ledger, {
    sourceLabel: `crashtest dogfood baseline · v${dogfood.meta.version} · seed ${dogfood.meta.seed}`,
    // the ledger file has no cost numbers — they live in hardening.md,
    // so the snapshot generator ships them as a sidecar blob.
    cost: dogfood.cost,
  })
}

function GateBanner({ gate }) {
  const pass = gate.status === 'pass'
  const pieces = [
    gate.newExploited.length > 0 && `${gate.newExploited.length} new exploited (${gate.newExploited.map((r) => r.id).join(', ')})`,
    gate.regressed.length > 0 && `${gate.regressed.length} regressed (${gate.regressed.map((r) => r.id).join(', ')})`,
    gate.acceptedHits.length > 0 && `${gate.acceptedHits.length} accepted-risk hit(s) — reported, not failed`,
  ].filter(Boolean)
  return (
    <div className={`dash-gate ${pass ? 'is-pass' : 'is-fail'}`}>
      <span className="dash-gate-glyph" aria-hidden="true">{pass ? '🛡' : '⚡'}</span>
      <div>
        <div className="dash-gate-title">
          {pass ? 'CI hold — exit 0' : 'CI gate trips — exit 1'}
          <span className="dash-gate-chip">{pass ? 'PASS' : 'FAIL'}</span>
        </div>
        <div className="dash-gate-sub">
          {pieces.length > 0 ? pieces.join(' · ') : (gate.note ?? 'No new EXPLOITED findings, no REFUSED→EXPLOITED regressions.')}
          {' '}— same rule the CLI applies via <code>exit(diff)</code>.
        </div>
      </div>
    </div>
  )
}

function StatStrip({ counts, cost, meta }) {
  const items = [
    { label: 'attacks', value: counts.total },
    { label: '🛡 refused', value: counts.refused },
    { label: '⚡ exploited', value: counts.exploited },
    { label: '🔒 bounded', value: counts.bounded },
  ]
  if (cost?.totals) {
    items.push({ label: 'backend ops', value: cost.totals.ops })
    items.push({ label: 'in-process requests', value: cost.totals.requests })
  }
  return (
    <div className="dash-stats">
      {items.map((it) => (
        <div className="dash-stat" key={it.label}>
          <b>{it.value}</b>
          <span>{it.label}</span>
        </div>
      ))}
      {meta && (
        <div className="dash-stat dash-stat-meta">
          <b>{meta.cutLabel}</b>
          <span>{meta.sourceLabel}</span>
        </div>
      )}
    </div>
  )
}

function FindingRow({ f, acceptedById }) {
  const v = VERDICTS[f.verdict]
  const accepted = acceptedById?.get(f.id)
  return (
    <div className="dash-row">
      <span className={v.cls} aria-hidden="true">{v.glyph}</span>
      <div className="dash-row-body">
        <span className="dash-row-id">{f.id}</span>
        {f.unknownVerdict && <span className="dash-row-flag">unknown verdict</span>}
        {accepted && <span className="dash-row-flag dash-row-flag-owner">accepted · owner {accepted.owner}{accepted.bound != null ? `, bound ${accepted.bound}` : ''}</span>}
        {f.detail && <span className="dash-row-detail">{f.detail}</span>}
      </div>
    </div>
  )
}

function ModuleCards({ groupings, acceptedRisks }) {
  const acceptedById = new Map(acceptedRisks.map((a) => [a.id, a]))
  return (
    <div className="dash-modules">
      {groupings.map((g) => (
        <div className="card" key={g.module}>
          <h3>
            <span className="glyph">§</span>
            {g.module}
            <span className="dash-module-count">{g.items.length}</span>
          </h3>
          <div className="dash-rows">
            {g.items.map((f) => <FindingRow key={f.id} f={f} acceptedById={acceptedById} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function CostBars({ cost }) {
  if (!cost?.perAttack?.length) return null
  const max = Math.max(...cost.perAttack.map((p) => p.ops), 1)
  return (
    <>
      <p className="sub">
        Cost economics — every request is accounted in backend ops. Amplification is bounded by config, not vibes.
      </p>
      <div className="dash-cost">
        {cost.perAttack.map((p) => (
          <div className="dash-cost-row" key={p.id}>
            <span className="dash-cost-id">{p.id}</span>
            <span className="dash-bar" role="img" aria-label={`${p.ops} of ${max} ops`}>
              <i style={{ width: `${Math.max((p.ops / max) * 100, p.ops > 0 ? 2 : 0)}%` }} />
            </span>
            <span className="dash-cost-num">{p.ops} ops · {p.requests} req</span>
          </div>
        ))}
      </div>
    </>
  )
}

function AcceptedRisks({ risks }) {
  if (!risks.length) {
    return <p className="sub">No accepted risks on file — nothing finds its way around an owner + bound.</p>
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Attack</th><th>Owner</th><th>Bound</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <tr key={r.id}>
              <td><code>{r.id}</code></td>
              <td>{r.owner ?? '—'}</td>
              <td>{r.bound ?? '—'}</td>
              <td>{r.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Loader({ onSnapshot, onParse, onError }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [urlText, setUrlText] = useState('')
  const [busy, setBusy] = useState(false)

  const tryParse = (textOrObj, label) => {
    try {
      let obj = textOrObj
      if (typeof obj === 'string') {
        // The CLI writes markdown next to the ledger — refuse it with a pointer
        // to the JSON file, never silently mis-read it.
        if (obj.trimStart().startsWith('#') || /https:\/\/schema\.json/.test(obj)) {}
        obj = JSON.parse(obj)
      }
      onParse(obj, label)
    } catch (err) {
      onError(err)
    }
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => tryParse(String(reader.result), file.name)
    reader.onerror = () => onError(new Error(`Could not read ${file.name}`))
    reader.readAsText(file)
    e.target.value = '' // allow re-loading the same file
  }

  const onUrl = async (e) => {
    e.preventDefault()
    if (!urlText.trim() || busy) return
    setBusy(true)
    try {
      const target = urlText.trim()
      // raw.githubusercontent serves with CORS enabled; the fetch goes straight
      // from the browser to the repo's file — no proxy, nothing server-side.
      const res = await fetch(target)
      if (!res.ok) throw new Error(`Fetch returned HTTP ${res.status}`)
      const text = await res.text()
      tryParse(text, target)
    } catch (err) {
      onError(new Error(`${err.message} — CORS-enabled raw JSON URLs work best (e.g. the raw.githubusercontent form)`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dash-load">
      <button type="button" className="btn btn-ghost" onClick={onSnapshot}>Dogfood baseline</button>
      <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen((o) => !o)}>
        {pasteOpen ? 'Close paste' : 'Paste JSON'}
      </button>
      <label className="btn btn-ghost dash-file-btn">
        Upload JSON file
        <input type="file" accept="application/json,.json" onChange={onFile} hidden />
      </label>
      {pasteOpen && (
        <div className="dash-paste">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Paste the contents of labs/crashledger.json (or a run blob) here…'}
            rows={8}
            spellCheck="false"
          />
          <button type="button" className="btn btn-primary" onClick={() => tryParse(pasteText, 'pasted JSON')}>
            Render this ledger
          </button>
        </div>
      )}
      <form className="dash-urlform" onSubmit={onUrl}>
        <input
          type="url"
          placeholder="https://raw.githubusercontent.com/you/you-repo/main/labs/crashledger.json"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          spellCheck="false"
        />
        <button type="submit" className="btn btn-ghost" disabled={busy}>
          {busy ? 'Fetching…' : 'Fetch URL'}
        </button>
      </form>
    </div>
  )
}

export default function Dashboard() {
  usePageMeta({
    siteUrl: SITE_URL,
    path: '/dashboard',
    title: 'Ledger dashboard | Crashtest',
    description: 'Render any crashtest ledger or run: the §7 CI gate verdict, findings by module, cost economics — in your browser, against real JSON, no backend.',
  })

  const [model, setModel] = useState(initialModel)
  const [error, setError] = useState(null)

  const setParsed = (obj, label) => {
    setError(null)
    try {
      setModel(parseArtifact(obj, { sourceLabel: label }))
    } catch (err) {
      setError(err)
    }
  }

  // Derived corner data — memoized on model only (pure transform).
  const cutLabel = useMemo(() => prettyDate(model.generatedAt), [model])

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">The ledger, rendered</p>
          <h1>
            Findings, not vibes.<br />
            <span className="accent">Rendered from your real JSON.</span>
          </h1>
          <p className="lede">
            Point this dashboard at any <code>labs/crashledger.json</code> (or a run blob from a CI
            artifact): it normalizes the artifact, computes the §7 gate with the exact functions the CLI
            uses, breaks findings down by module, and draws the cost-economics bars. All of it runs in
            your browser against a JSON the CLI wrote — the CLI collects nothing and makes no calls,
            and neither does the dashboard.
          </p>
          <GateBanner gate={model.gate} />
          <StatStrip
            counts={model.counts}
            cost={model.cost}
            meta={model.kind === 'ledger' ? { cutLabel, sourceLabel: model.sourceLabel } : null}
          />
          <Loader
            onSnapshot={() => { setError(null); setModel(initialModel()) }}
            onParse={setParsed}
            onError={(err) => setError(err)}
          />
          {error && (
            <div className="dash-error" role="alert">
              Could not render that artifact — {error.message}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Findings by module</h2>
          <p className="sub">
            {model.counts.exploited > 0
              ? 'Rows marked ⚡ are hit-grade. BOUNDED rows carry owner + bound.'
              : 'Every row below is a receipt of an attack that did not land.'}
          </p>
          <ModuleCards groupings={model.groupings} acceptedRisks={model.acceptedRisks} />
        </div>
      </section>

      {model.cost && (
        <section className="section">
          <div className="wrap">
            <h2>Cost economics</h2>
            <CostBars cost={model.cost} />
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap">
          <h2>Accepted risks</h2>
          <p className="sub">Owner + bound on file. Accepted risks never re-alarm — they are reported, not failed.</p>
          <AcceptedRisks risks={model.acceptedRisks} />
          <p className="sub" style={{ marginTop: 20 }}>
            Want the gate in CI instead of on a page? That is the same verdict, computed inside
            {' '}<code>npx crashtest run</code> — see the{' '}
            <a href="https://docs.creadev.org/crashtest/reference/exit-rules">exit rules</a> and the{' '}
            <a href="https://docs.creadev.org/crashtest/reference/ledger">ledger format</a>.
          </p>
        </div>
      </section>
    </>
  )
}
