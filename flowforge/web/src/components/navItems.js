/**
 * The site's nav vocabulary - ONE list that the header, the burger sidebar,
 * and the footer all render from. Probes (port the web-docs-consistency test
 * if you also ship docs) read this file to guarantee surfaces never drift.
 *
 * Group semantics: 'site' = internal route (NavLink-active), 'out' = external
 * surface (the GitHub icon in the header replaces this entry's label there;
 * the FOOTER still renders the text link - see Nav.jsx HEADER_LINKS).
 */
export const NAV_ITEMS = [
  // primary app routes - drop in yours
  { label: 'Home', to: '/', end: true, group: 'site' },
  { label: 'About', to: '/about', group: 'site' },
  // outbound surfaces
  { label: 'GitHub', href: 'https://github.com/your-org/your-site', group: 'out' },
]

/**
 * Footer-only extras (legal + provenance). Keep the LEGAL labels smaller than
 * the nav; provenance links belong in the footer, not the header.
 */
export const FOOTER_EXTRAS = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
]
