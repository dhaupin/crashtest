import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './navItems.js'
import ThemeSwitch from './ThemeSwitch.jsx'

/**
 * The app shell (vant-dashboard shape): a fixed header and ONE slide-out
 * sidebar used at every viewport. Header order on the right: GitHub icon,
 * light/dark switch, then the menu (inline links + the same burger trigger).
 */

// The GitHub icon replaces the header's GitHub text link (the footer still
// carries the text link); Docs/npm stay as labeled links in the menu.
const HEADER_LINKS = NAV_ITEMS.filter(i => i.label !== 'GitHub')
export default function Nav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Route change closes the drawer (and Escape dismisses it).
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const cls = ({ isActive }) => (isActive ? 'active' : undefined)

  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand" onClick={() => setOpen(false)}>
            <img src="/icon.svg" alt="" className="brand-logo" aria-hidden="true" />
            <img src="/icon.svg" alt="" className="brand-logo" aria-hidden="true" />
            <span className="brand-accent">your</span>site
            <span className="brand-badge">beta</span>
          </Link>
          <div className="nav-right">
            <a
              className="nav-icon"
              href="https://github.com/your-org/your-site"
              target="_blank"
              rel="noreferrer"
              aria-label="Your site on GitHub"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
            <ThemeSwitch />
            <div className="nav-links">
              {HEADER_LINKS.map(item => (
                item.to
                  ? <NavLink key={item.label} to={item.to} end={item.end} className={cls}>{item.label}</NavLink>
                  : <a key={item.label} href={item.href} {...(item.group === 'out'
                      ? { target: '_blank', rel: 'noreferrer' } : {})}>{item.label}</a>
              ))}
            </div>
            <button
              className="nav-burger"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen(v => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {open
                  ? <path d="M6 6l12 12M6 18L18 6" />
                  : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <div className={'nav-overlay' + (open ? ' open' : '')} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={'nav-sidebar' + (open ? ' open' : '')} aria-hidden={!open}>
        <div className="nav-sidebar-title">Menu</div>
        <ul className="nav-sidebar-nav">
          {NAV_ITEMS.map(item => (
            <li key={item.label}>
              {item.to
                ? <NavLink to={item.to} end={item.end} className={cls} onClick={() => setOpen(false)}>{item.label}</NavLink>
                : <a href={item.href} target="_blank" rel="noreferrer">{item.label}</a>}
            </li>
          ))}
        </ul>
        <div className="nav-sidebar-title">Legal</div>
        <ul className="nav-sidebar-nav">
          <li><Link to="/terms" className={cls} onClick={() => setOpen(false)}>Terms</Link></li>
          <li><Link to="/privacy" className={cls} onClick={() => setOpen(false)}>Privacy</Link></li>
        </ul>
      </aside>
    </>
  )
}
