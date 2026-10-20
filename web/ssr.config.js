/**
 * ssr.config.js — crashtest site identity + route map.
 * Populates inject-brand.js SEO tags and prerender.js route generation.
 */
export default {
  siteUrl:  'https://crashtest.creadev.org',
  siteName: 'Crashtest',
  author:   'dhaupin',
  tagline:  'Adversarial QA your agent-built app survives, not passes.',
  ogImage:  'https://crashtest.creadev.org/og-image.png',
  keywords: 'crashtest, adversarial testing, agent security, LLM app hardening, QA harness, prototype pollution, in-process attack testing',

  routes: [
    {
      path: '/',
      priority: '1.0',
      changefreq: 'monthly',
      meta: {
        title: 'Crashtest — adversarial QA for agent-built apps',
        description: 'Crashtest drives a seeded, in-process attack suite against real server handlers and produces a hardening ledger that CI fails on regressions — no sockets, no redeploy loop.',
      },
    },
    {
      path: '/attacks',
      priority: '0.9',
      changefreq: 'monthly',
      meta: {
        title: 'Attack catalog | Crashtest',
        description: 'Every shipped crashtest scenario module and attack: auth spoof matrices, prototype pollution, burst walls, id-collision aliasing, volume economics — and real findings they produced.',
      },
    },
    {
      path: '/dashboard',
      priority: '0.7',
      changefreq: 'weekly',
      meta: {
        title: 'Ledger dashboard | Crashtest',
        description: 'Render any crashtest ledger or run: the §7 CI gate verdict, findings by module, cost economics — computed in your browser with the CLI\'s own rule, no backend.',
      },
    },
    {
      path: '/faq',
      priority: '0.8',
      changefreq: 'monthly',
      meta: {
        title: 'FAQ | Crashtest',
        description: 'Crashtest FAQ: what it does, safety on real code, how it differs from pentest and SAST tools, the ledger and CI exit contract, BOUNDED accepted risks, packs and plugins, builder presets for Lovable/Bolt/Replit exports, framework support.',
      },
    },
    {
      path: '/terms',
      priority: '0.3',
      changefreq: 'yearly',
      meta: {
        title: 'Terms of Use | Crashtest',
        description: 'Plain-language terms: what crashtest is for, what it is not for, no warranties, MIT open source.',
      },
    },
    {
      path: '/privacy',
      priority: '0.3',
      changefreq: 'yearly',
      meta: {
        title: 'Privacy | Crashtest',
        description: 'The CLI collects nothing, runs stay on your machine, and the site keeps no hidden tracking.',
      },
    },
  ],

  buildJsonLd() {
    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Crashtest',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js',
      url: 'https://crashtest.creadev.org',
      author: { '@type': 'Person', name: 'dhaupin', url: 'https://github.com/dhaupin' },
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', url: 'https://www.npmjs.com/package/crashtest' },
    };
  },

  notFound: {
    heading: 'Route not declared',
    body: "Like an undeclared route in a crashtest run, this URL isn't on the manifest.",
    primaryCta: { label: 'Back to the harness', href: '/' },
  },
};
