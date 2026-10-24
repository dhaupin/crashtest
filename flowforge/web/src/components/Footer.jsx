import { Link } from 'react-router-dom'
import { NAV_ITEMS, FOOTER_EXTRAS } from './navItems.js'

/**
 * The ONE footer - renders NAV_ITEMS (text links, incl. GitHub) plus
 * FOOTER_EXTRAS. All labels come from the shared nav vocabulary (never
 * hand-typed), so header/footer/sidebar cannot drift.
 */
export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-inner">
        <span>- a flowforge shell site</span>
        {NAV_ITEMS
          .filter(i => ['GitHub'].includes(i.label))
          .map(i => (
            <a key={i.label} href={i.href} target="_blank" rel="noreferrer">{i.label}</a>
          ))}
        {FOOTER_EXTRAS.map(i => (
          i.href.startsWith('/')
            ? <Link key={i.label} to={i.href}>{i.label}</Link>
            : <a key={i.label} href={i.href} target="_blank" rel="noreferrer">{i.label}</a>
        ))}
        <span>Made by <a href="https://your-site.example.com" rel="noopener" className="madeby">your org</a></span>
      </div>
    </footer>
  )
}
