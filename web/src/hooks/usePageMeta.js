/**
 * src/hooks/usePageMeta.js
 * ========================
 * Updates route-specific head tags on client-side navigation.
 *
 * SSR (prerender.js) bakes correct tags into each route's HTML at build time --
 * bots without JS and initial page loads see those tags directly.
 * This hook keeps them in sync when the user navigates within the SPA,
 * covering JS-enabled bots (Googlebot, social crawlers) and the browser tab.
 *
 * Tags updated on each navigation:
 *   <title>
 *   <meta name="description">
 *   <link rel="canonical">
 *   <meta property="og:url">
 *   <meta property="og:title">
 *   <meta property="og:description">
 *   <meta name="twitter:title">
 *   <meta name="twitter:description">
 *
 * Tags intentionally NOT updated (same on every page):
 *   og:image, og:type, og:locale, og:site_name, twitter:card, twitter:image
 *
 * NO external dependencies -- does not import from ssr.config.js or any app file.
 * siteUrl is passed as a prop or read from VITE_SITE_URL env.
 *
 * Usage (explicit siteUrl):
 *   usePageMeta({
 *     siteUrl:     'https://yoursite.com',
 *     path:        '/about',
 *     title:       'About | Your Site',
 *     description: 'About page description.',
 *   })
 *
 * Usage (env-driven, set VITE_SITE_URL in .env or vite.config.js define):
 *   usePageMeta({ path: '/about', title: '...', description: '...' })
 *
 * Tip: wrap in your own hook to avoid repeating siteUrl:
 *   // src/hooks/useMeta.js
 *   import usePageMeta from './usePageMeta.js'
 *   const SITE_URL = import.meta.env.VITE_SITE_URL || 'https://yoursite.com'
 *   export default (args) => usePageMeta({ siteUrl: SITE_URL, ...args })
 */

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function usePageMeta({ title, description, path, siteUrl }) {
  const base = siteUrl || import.meta.env?.VITE_SITE_URL || ''
  const location = useLocation()

  useEffect(() => {
    const canonical = `${base}${path === '/' ? '' : path}`

    const set = (selector, attr, value) => {
      const el = document.querySelector(selector)
      if (el && value) el.setAttribute(attr, value)
    }

    if (title)       document.title = title
    if (description) set('meta[name="description"]',             'content', description)
    if (canonical) {
      set('link[rel="canonical"]',                               'href',    canonical)
      set('meta[property="og:url"]',                            'content', canonical)
    }
    if (title) {
      set('meta[property="og:title"]',                          'content', title)
      set('meta[name="twitter:title"]',                         'content', title)
    }
    if (description) {
      set('meta[property="og:description"]',                    'content', description)
      set('meta[name="twitter:description"]',                   'content', description)
    }
  }, [title, description, path, base, location])
}
