/**
 * The site's nav vocabulary - ONE list that the header, the burger sidebar,
 * and the footer all render from, and that the docs-consistency probe reads
 * to guarantee /web and /docs never drift apart on labels/hrefs.
 * Group semantics: 'site' = internal route (NavLink-active), 'out' = external surface.
 */
export const NAV_ITEMS = [
  // primary app routes
  { label: 'Home', to: '/', end: true, group: 'site' },
  { label: 'Attacks', to: '/attacks', group: 'site' },
  { label: 'Dashboard', to: '/dashboard', group: 'site' },
  { label: 'Status', to: '/status', group: 'site' },
  { label: 'FAQ', to: '/faq', group: 'site' },
  // outbound surfaces (same labels as docs nav + footer)
  { label: 'Docs', href: 'https://docs.creadev.org/crashtest/', group: 'out' },
  { label: 'GitHub', href: 'https://github.com/dhaupin/crashtest', group: 'out' },
  { label: 'npm', href: 'https://www.npmjs.com/package/crashtest', group: 'out' },
]

/** Footer-only extras (legal + provenance). Terms/Privacy also live in the docs nav - same labels, site-internal hrefs. */
export const FOOTER_EXTRAS = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Provenance', href: 'https://search.sigstore.dev/?logIndex=3329750463' },
]
