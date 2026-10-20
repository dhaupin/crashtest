/**
 * src/islands.js
 * ==============
 * Engine file -- copy once, never edit.
 *
 * Mounts dynamic React components into <pre-island> placeholders after
 * the main app hydrates. Each island is a hole punched through the
 * prerendered HTML: invisible to crawlers, filled for human visitors.
 *
 * Usage -- call mountIslands() in AppLayout's route-change effect after each
 * navigation. This ensures islands mount on both hard loads and SPA transitions.
 * The WeakSet prevents double-mounting if the same element is scanned twice.
 *
 *   import { mountIslands } from './islands.js'
 *   import { islands } from './AppIslands.jsx'
 *
 *   // Inside ScrollToTop's useEffect([pathname]):
 *   const t = setTimeout(() => mountIslands(islands), 0)
 *   return () => clearTimeout(t)
 *
 * Islands are declared in src/AppIslands.jsx as a name -> component map.
 * Each island in the HTML is a <pre-island> custom element:
 *
 *   <pre-island data-pre-island="recently-viewed"></pre-island>
 *   <pre-island data-pre-island="cart-widget" data-pre-load="visible"></pre-island>
 *   <pre-island data-pre-island="promo-banner" data-pre-load="idle"></pre-island>
 *
 * Load strategies (data-pre-load):
 *   eager   -- mount immediately. Default if omitted.
 *   visible -- mount when the element enters the viewport (IntersectionObserver).
 *   idle    -- mount during browser idle time (requestIdleCallback).
 *
 * Fallback content:
 *   Any children inside <pre-island> are shown before the island mounts.
 *   They are replaced when the React component renders.
 *
 *   <pre-island data-pre-island="cart-widget">
 *     <span class="island-loading">Loading cart...</span>
 *   </pre-island>
 *
 * SSR behavior:
 *   <pre-island> is a custom element. React's renderToString passes it
 *   through as plain HTML -- no guard needed. Fallback content renders
 *   in the static HTML and is visible to crawlers. The React component
 *   never runs at build time.
 *
 * Island components receive no props by default. To pass data, use
 * data attributes and read them from the element ref inside the component,
 * or pull from a global store / localStorage / fetch.
 */

import ReactDOM from 'react-dom/client'
import React    from 'react'

// Tracks elements that have already been mounted to prevent double createRoot
// calls when mountIslands is called again on SPA route change.
const mounted = new WeakSet()

function mount(el, Component) {
  if (mounted.has(el)) return
  mounted.add(el)
  el.innerHTML = ''
  ReactDOM.createRoot(el).render(React.createElement(Component))
}

function observe(el, Component) {
  if (mounted.has(el)) return
  const io = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        observer.unobserve(el)
        io.disconnect()  // Clean up the observer after use
        mount(el, Component)
      }
    }
  }, { rootMargin: '0px', threshold: 0.1 })
  io.observe(el)
}

function whenIdle(el, Component) {
  if (mounted.has(el)) return
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      // Guard against the element being removed from the DOM before the
      // callback fires (e.g. user navigated away within the idle window).
      if (el.isConnected) mount(el, Component)
    }, { timeout: 2000 })
  } else {
    // requestIdleCallback not available -- fall back to a short timeout
    setTimeout(() => { if (el.isConnected) mount(el, Component) }, 200)
  }
}

/**
 * mountIslands(registry)
 *
 * Scans the DOM for <pre-island> elements and mounts the matching
 * React component from the registry into each one.
 *
 * registry -- object mapping island names to React components:
 *   { 'recently-viewed': RecentlyViewed, 'cart-widget': CartWidget }
 *
 * Unregistered island names are skipped with a console warning.
 * Safe to call with an empty registry -- nothing happens.
 */
export function mountIslands(registry = {}) {
  if (typeof window === 'undefined') return

  const elements = document.querySelectorAll('pre-island[data-pre-island]')

  for (const el of elements) {
    const name      = el.dataset.preIsland
    const strategy  = el.dataset.preLoad || 'eager'
    const Component = registry[name]

    if (!Component) {
      console.warn(`[islands] no component registered for "${name}" -- skipping`)
      continue
    }

    if (strategy === 'visible') {
      observe(el, Component)
    } else if (strategy === 'idle') {
      whenIdle(el, Component)
    } else {
      mount(el, Component)
    }
  }
}
