/**
 * ssr.config.js
 * =============
 * Copy this file to your project root as ssr.config.js, then customize.
 * 
 * The platform field determines which hosting provider generates host-specific
 * config files (_headers, _redirects for Cloudflare; vercel.json for Vercel; 
 * netlify.toml for Netlify). Default is Cloudflare.
 * 
 * IMPORTANT: This file is gitignored. It's your environment-specific config.
 * Copy ssr.config.example.js to ssr.config.js and customize for your site.
 * 
 * Platform options:
 *   - cloudflare  = default, generates _headers and _redirects
 *   - vercel      = generates vercel.json
 *   - netlify     = generates netlify.toml
 */

export default {
  // === Platform ===
  // platform: 'cloudflare',  // 'netlify' | 'vercel' | 'cloudflare' (default)

  // === Site Identity ===
  siteUrl:    'https://example.com',
  siteName:   'Your Site Name',
  author:     'Your Name',
  tagline:   'Your tagline - keeps it short',
  ogImage:    'https://example.com/og-image.png',
  keywords:  'keyword1, keyword2, keyword3',

  // === App ===
  // Path to your AppLayout component (no BrowserRouter, only Routes)
  appLayoutPath: '/src/AppLayout.jsx',

  // === Deploy ID ===
  // Inject a deploy ID meta tag for debugging (visible in page source).
  // Set deployIdFooter: true to also show in the footer (requires client-side JS).
  // deployId: true,        // inject <meta name="deploy-id"> (default: true)
  // deployIdFooter: false, // show in footer (default: false)

  // === Routes ===
  // Each route gets prerendered to static HTML at build time.
  // Add your routes here. The home route (/) is required.
  routes: [
    {
      path:       '/',
      priority:   '1.0',
      changefreq: 'monthly',
      meta: {
        title:       'Your Site Name',
        description: 'Your site description for search engines.',
        // ogImage:     'https://example.com/og-image.png',  // route-specific OG image
      },
    },
    // {
    //   path:       '/about',
    //   priority:   '0.8',
    //   changefreq: 'monthly',
    //   meta: {
    //     title:       'About | Your Site Name',
    //     description: 'Learn more about what we do.',
    //   },
    // },
    // {
    //   path:       '/blog',
    //   priority:   '0.7',
    //   changefreq: 'weekly',
    //   meta: {
    //     title:       'Blog | Your Site Name',
    //     description: 'Latest updates and articles.',
    //   },
    // },
  ],

  // === Dynamic Routes (CMS) ===
  // Optional async hook for routes from a headless CMS.
  // Runs at build time only - no runtime overhead.
  // fetchRoutes() merges with static routes above.
  // Static routes take precedence on duplicates.
  // async fetchRoutes() {
  //   const posts = await fetch('https://your-cms.com/api/routes')
  //     .then(r => r.json())
  //   return posts.map(post => ({
  //     path: `/blog/${post.slug}`,
  //     priority: '0.6',
  //     meta: {
  //       title: post.title,
  //       description: post.excerpt,
  //     },
  //   }))
  // },

  // === JSON-LD Structured Data ===
  // Optional function returning schema.org structured data.
  // Return a single object or array of objects.
  // buildJsonLd() {
  //   return [
  //     {
  //       '@context':           'https://schema.org',
  //       '@type':              'WebSite',
  //       name:                 'Your Site Name',
  //       url:                  'https://example.com',
  //       author: {
  //         '@type': 'Person',
  //         name:  'Your Name',
  //         url:   'https://github.com/yourname',
  //       },
  //     },
  //   ]
  // },

  // === 404 Page ===
  // Custom 404 page content. Prerendered with noindex meta.
  notFound: {
    heading:    'Page not found',
    body:       "That page doesn't exist.",
    primaryCta: { label: 'Go home', href: '/' },
  },

  // === Bot Proxy (optional) ===
  // Proxy renders dynamic routes not in the prerender list.
  // Works with Node.js/Puppeteer (VPS) or Cloudflare Worker.
  // proxy: {
  //   // Your proxy server URL (set as env: PRESTRUCT_PROXY_URL)
  //   url:      'https://your-proxy.example.com',
  //   // Shared secret (set as env: PRESTRUCT_SECRET)
  //   secret:  'your-secret',
  //   // Render a different origin than siteUrl (for local dev, staging)
  //   targetUrl: 'https://staging.example.com',
  //   // Bot list for proxy - customize if needed
  //   botList: [
  //     'Googlebot',
  //     'Google-Extended',
  //     'Bingbot',
  //     'BingPreview',
  //     'DuckDuckBot',
  //     'Slurp',
  //   ],
  // },
}