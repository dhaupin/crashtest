/**
 * ssr.config.js - site identity + route map.
 * Fills the prestruct engine (inject-brand + prerender, via `prestruct build`)
 * with the site's SEO tags and route list. Fill the identity block once; add
 * one entry per Route in AppLayout.jsx.
 */
export default {
  siteUrl:  'https://your-site.example.com',
  siteName: 'Your Site',
  author:   'your-org',
  tagline:  'One sentence, plain, no hype.',
  ogImage:  'https://your-site.example.com/og-image.png',
  keywords: 'your, keywords, here',

  routes: [
    {
      path: '/',
      priority: '1.0',
      changefreq: 'monthly',
      meta: {
        title: 'Your Site - the one-line pitch',
        description: 'Plain two-sentence description of what this site shows and who it is for.',
      },
    },
    // add more routes per AppLayout.jsx
  ],
}
