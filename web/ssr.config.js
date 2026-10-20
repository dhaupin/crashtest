/**
 * ssr.config.js — crashtest site identity + route map.
 * Populates inject-brand.js SEO tags and prerender.js route generation.
 */
export default {
  siteUrl:  'https://crashtest.creadev.org',
  siteName: 'Crashtest',
  author:   'dhaupin',
  tagline:  'Adversarial QA your agent-built app survives, not passes.',
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
