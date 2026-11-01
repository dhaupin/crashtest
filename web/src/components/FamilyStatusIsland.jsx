/**
 * components/FamilyStatusIsland.jsx - the family status island.
 *
 * The family status contract (family-status@1, crashtest#47 adaptation of
 * eyestruct's worked example): every member of the struct family serves a
 * status.json at the FIXED path /status.json on its site, generated from its
 * own committed ledgers, and every member's status surface reads the others'
 * files with the same schema.
 *
 * Honest-data rule (same as the dashboard's ledger model): every number is
 * fetched at load from the sibling's served status.json. A sibling that is
 * not serving the dialect yet shows ITS row as "not serving the dialect" -
 * never a guessed row, never a default PASS. One bad sibling degrades only
 * its own row.
 */
import { useEffect, useState } from 'react'

const SIBLINGS = [
  { name: 'eyestruct', origin: 'https://eyestruct.creadev.org', page: 'https://eyestruct.creadev.org/status' },
  { name: 'poststruct', origin: 'https://poststruct.creadev.org', page: 'https://poststruct.creadev.org/status' },
  { name: 'packstruct', origin: 'https://packstruct.creadev.org', page: 'https://packstruct.creadev.org/status' },
  { name: 'govstruct', origin: 'https://govstruct.creadev.org', page: 'https://govstruct.creadev.org/status' },
  { name: 'monoforge', origin: 'https://monoforge.creadev.org', page: 'https://monoforge.creadev.org/status' },
]

function legSummary(legs) {
  // One line per leg: "crashtest 49 PASS", built from the file's own
  // numbers - the island never derives a count of its own.
  return legs.map((l) => `${l.leg} ${l.cases} ${l.verdict}`)
}

export default function FamilyStatusIsland() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      const settled = await Promise.all(
        SIBLINGS.map(async (s) => {
          try {
            const res = await fetch(`${s.origin}/status.json`, { signal: ctrl.signal })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            if (data.schema !== 1 || data.contract !== 'family-status@1') {
              throw new Error(`unsupported dialect${data && data.contract ? ` (${data.contract})` : ''}`)
            }
            return { name: s.name, page: (data.site || s.page), ok: true, data }
          } catch (err) {
            if (ctrl.signal.aborted) return null
            return { name: s.name, page: s.page, ok: false, error: String(err.message || err) }
          }
        }),
      )
      if (ctrl.signal.aborted) return
      setState({ status: 'ok', rows: settled.filter(Boolean) })
    })()
    return () => ctrl.abort()
  }, [])

  if (state.status === 'loading') {
    return (
      <p className="island-loading">
        Reading the family's served status files (each origin's /status.json)...
      </p>
    )
  }

  return (
    <>
      <p className="sub">
        Same dialect, same fixed file: every family member serves its committed-ledger
        verdicts at <code>/status.json</code> and reads the others. Each row below is
        that member's own file, fetched live - a red row means the member's own ledgers
        say RED, not that this page thinks so. crashtest's own status served here is{' '}
        <a href="https://crashtest.creadev.org/status.json">/status.json</a>.
      </p>
      <div className="table-wrap">
        <table className="family-status">
        <thead>
          <tr>
            <th>repo</th>
            <th>legs (cases, verdict)</th>
            <th>packs</th>
            <th>as of</th>
            <th>page</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              {row.ok ? (
                <>
                  <td>
                    {legSummary(row.data.legs).map((line, i) => (
                      <span key={i}>
                        <code>{line}</code>
                        {i < row.data.legs.length - 1 && ' · '}
                      </span>
                    ))}
                  </td>
                  <td>
                    {row.data.packs.length === 0 ? (
                      <em>none declared</em>
                    ) : (
                      <span>
                        {row.data.packs.map((p) => p.name).join(', ')}
                        {' '}{row.data.packs.reduce((n, p) => n + (p.cases || 0), 0)} cases
                      </span>
                    )}
                  </td>
                  <td><code>{row.data.asOf || 'unknown'}</code></td>
                </>
              ) : (
                <td colSpan="3">
                  <em>
                    not serving the dialect yet ({row.error}) - the row stays
                    empty, never guessed
                  </em>
                </td>
              )}
              <td><a href={row.page || `${row.origin}/`}>{row.name}</a></td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  )
}
