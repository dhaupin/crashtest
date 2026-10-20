/**
 * scripts/proxy.worker.js
 * =======================
 * Cloudflare Worker version of the Prestruct render proxy.
 *
 * Uses Cloudflare's Browser Rendering API (@cloudflare/puppeteer) instead of
 * a local Chromium install. No VPS, no process management -- deploy as a Worker.
 *
 * Requirements:
 *   - Workers Paid plan (Browser Rendering is not available on the free tier).
 *   - `@cloudflare/puppeteer` bound as a Browser binding in wrangler.toml.
 *   - KV namespace bound as `CACHE` in wrangler.toml (for HTML cache storage).
 *   - PRESTRUCT_SECRET set as a Worker secret via `wrangler secret put`.
 *
 * wrangler.toml additions needed:
 *
 *   [[browser]]
 *   binding = "BROWSER"
 *
 *   [[kv_namespaces]]
 *   binding = "CACHE"
 *   id      = "your-kv-namespace-id"
 *
 *   [vars]
 *   PRESTRUCT_TARGET_URL = "https://yoursite.com"
 *   CACHE_TTL_SECONDS    = "86400"
 *
 * Deployment:
 *   1. Copy this file to your Worker project root (or a standalone Worker repo).
 *   2. `npm install @cloudflare/puppeteer wrangler`
 *   3. Update wrangler.toml with the bindings above.
 *   4. `wrangler secret put PRESTRUCT_SECRET`
 *   5. `wrangler deploy`
 *
 * Cache:
 *   Rendered HTML is stored in KV with a TTL. KV is eventually consistent --
 *   cache busts may take a few seconds to propagate globally.
 *
 * targetUrl vs siteUrl:
 *   Set PRESTRUCT_TARGET_URL in wrangler.toml [vars] to point the proxy at a
 *   different origin (WordPress, staging, localhost tunnel, etc.).
 *   Defaults to the `x-forwarded-host` of the incoming request if not set.
 *
 * Bot list:
 *   Maintained inline here. Sync with config.proxy.botList in ssr.config.js
 *   if you customise either. The Worker has no access to your build-time config.
 *
 * Security:
 *   - Cache refresh requires the PRESTRUCT_SECRET value in x-prestruct-refresh.
 *   - Only GET requests are processed. Others return 405.
 *   - Target URL is validated before passing to the browser.
 */

import puppeteer from '@cloudflare/puppeteer'

// Keep this in sync with config.proxy.botList in ssr.config.js
const BOT_LIST = [
  'googlebot',
  'bingbot',
  'slurp',
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'twitterbot',
  'facebookexternalhit',
  'discordbot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'whatsapp',
]

function isBot(ua) {
  if (!ua) return false
  const lower = ua.toLowerCase()
  return BOT_LIST.some(token => lower.includes(token))
}

function cacheKey(url) {
  // KV key: simple prefix + encoded path. Max 512 bytes, URL-safe.
  return `prestruct:${encodeURIComponent(url)}`
}

export default {
  async fetch(request, env) {
    // Only GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed.', { status: 405 })
    }

    const ua  = request.headers.get('user-agent') || ''
    const bot = isBot(ua)

    // Build target URL
    const TARGET_URL = (env.PRESTRUCT_TARGET_URL || '').replace(/\/$/, '')
    if (!TARGET_URL) {
      return new Response('[proxy] PRESTRUCT_TARGET_URL not configured.', { status: 500 })
    }

    const requestUrl = new URL(request.url)
    let targetFullUrl
    try {
      const parsed = new URL(`${TARGET_URL}${requestUrl.pathname}${requestUrl.search}`)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
      targetFullUrl = parsed.toString()
    } catch {
      return new Response('Invalid request URL.', { status: 400 })
    }

    // Non-bots redirect to the live site
    if (!bot) {
      return Response.redirect(targetFullUrl, 302)
    }

    // Cache refresh check
    const SECRET       = env.PRESTRUCT_SECRET || null
    const refreshToken = request.headers.get('x-prestruct-refresh')
    const forceRefresh = SECRET && refreshToken === SECRET

    const TTL = parseInt(env.CACHE_TTL_SECONDS || '86400', 10)
    const key = cacheKey(requestUrl.pathname + requestUrl.search)

    // Try KV cache first
    if (!forceRefresh) {
      const cached = await env.CACHE.get(key, { type: 'text' })
      if (cached) {
        return new Response(cached, {
          headers: {
            'Content-Type':            'text/html; charset=utf-8',
            'X-Prestruct-Cache':       'HIT',
          },
        })
      }
    }

    // Render via Browser Rendering API
    let html
    let browser
    let page
    try {
      browser = await puppeteer.launch(env.BROWSER)
      page    = await browser.newPage()
      await page.setViewport({ width: 1280, height: 800 })
      await page.setExtraHTTPHeaders({ 'X-Prestruct-Proxy': 'true' })
      await page.goto(targetFullUrl, { waitUntil: 'networkidle0', timeout: 30000 })
      html = await page.content()
    } catch (err) {
      console.error('[proxy:worker] Render failed:', err.message)
      // Fall through to live site on render failure
      return Response.redirect(targetFullUrl, 302)
    } finally {
      if (page) {
        try {
          await page.close()
        } catch {}
      }
      if (browser) {
        try {
          await browser.close()
        } catch {}
      }
    }

    // Store in KV with TTL
    await env.CACHE.put(key, html, { expirationTtl: TTL })

    return new Response(html, {
      headers: {
        'Content-Type':            'text/html; charset=utf-8',
        'X-Prestruct-Cache':       'MISS',
        'X-Prestruct-Rendered-At': new Date().toISOString(),
      },
    })
  },
}
