import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { NAV_ITEMS } from './navItems.js'

/**
 * The app shell (vant-dashboard shape): a fixed header (brand + actions +
 * burger) and ONE slide-out sidebar used at every viewport - desktop shows
 * the same links inline in the header, mobile collapses to burger + sidebar.
 * Growing into a bigger app = move the sidebar to a permanent rail without
 * changing any page code (AppLayout owns the layout class).
 */
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
          <Link to="/" className="brand" onClick={() => setOpen(false)}>
            <span className="brand-crash">crash</span>test
            <span className="brand-badge">v0.1</span>
          </Link>
          <div className="nav-links">
            {NAV_ITEMS.map(item => (
              item.to
                ? <NavLink key={item.label} to={item.to} end={item.end} className={cls}>{item.label}</NavLink>
                : <a key={item.label} href={item.href} {...(item.group === 'out'
                    ? { target: '_blank', rel: 'noreferrer' } : {})}>{item.label}</a>
            ))}
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
