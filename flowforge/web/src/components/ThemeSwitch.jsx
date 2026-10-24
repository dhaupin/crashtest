/**
 * src/components/ThemeSwitch.jsx
 * Light/dark toggle. Theme lives on <html data-theme> (CSS picks tokens) and
 * is persisted in localStorage. The button renders BOTH icons at all times;
 * a CSS rule per theme shows the relevant one - so the prerendered markup
 * and the hydrated markup agree (no hydration mismatch, no flash-of-wrong-icon)
 * and the prerendered HTML carries no JS-dependent first paint either way.
 * The inline bootstrap in index.html applies a persisted light theme before
 * first paint; this component only flips it.
 */
import { useEffect } from 'react'

const THEME_KEY = 'flowforge-theme'

function toggleTheme() {
  const el = document.documentElement
  const next = el.dataset.theme === 'light' ? 'dark' : 'light'
  el.dataset.theme = next
  try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode: live without persistence */ }
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', next === 'light' ? '#f5f6fa' : '#10131a')
}

export default function ThemeSwitch() {
  useEffect(() => {
    // Keep the meta theme-color honest if the bootstrap already flipped to light.
    if (document.documentElement.dataset.theme === 'light') {
      const meta = document.querySelector('meta[name="theme-color"]')
      if (meta) meta.setAttribute('content', '#f5f6fa')
    }
  }, [])
  return (
    <button type="button" className="theme-switch" onClick={toggleTheme} aria-label="Toggle light/dark mode">
      {/* sun: shown in dark mode - clicking goes light (icon = the action,
          the shell family convention); CSS picks */}
      <svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
      {/* moon: shown in light mode - clicking goes dark */}
      <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    </button>
  )
}
