/**
 * VersionBadge island — runs in the browser only (never at prerender).
 * Reads /api/version (Cloudflare Pages Function proxying the npm registry).
 * On failure it leaves the fallback markup alone — nothing fake is ever
 * shown; an unreachable API just keeps the static fallback.
 */
import { useEffect, useState } from 'react'

export default function VersionBadge() {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    let alive = true
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { if (alive) setInfo(data) })
      .catch(() => { /* keep static fallback — the site never fakes a version */ })
    return () => { alive = false }
  }, [])

  if (!info?.version) return (
    <a href="https://www.npmjs.com/package/crashtest" target="_blank" rel="noreferrer" className="btn btn-ghost">
      npm · crashtest
    </a>
  )
  return (
    <a href="https://www.npmjs.com/package/crashtest" target="_blank" rel="noreferrer" className="btn btn-ghost">
      npm · crashtest v{info.version}{info.provenance ? ' · provenance ✓' : ''}
    </a>
  )
}
