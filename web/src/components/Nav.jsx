import { Link, NavLink } from 'react-router-dom'

export default function Nav() {
  const cls = ({ isActive }) => (isActive ? 'active' : undefined)
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link to="/" className="brand">
          <span className="brand-crash">crash</span>test
          <span className="brand-badge">v0.1</span>
        </Link>
        <div className="nav-links">
          <NavLink to="/" className={cls} end>Home</NavLink>
          <NavLink to="/attacks" className={cls}>Attacks</NavLink>
          <NavLink to="/dashboard" className={cls}>Dashboard</NavLink>
          <a href="https://docs.creadev.org/crashtest/">Docs</a>
          <a href="https://github.com/dhaupin/crashtest" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://www.npmjs.com/package/crashtest" target="_blank" rel="noreferrer">npm</a>
        </div>
      </div>
    </nav>
  )
}
