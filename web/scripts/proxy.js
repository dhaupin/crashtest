/**
 * scripts/proxy.js
 * ================
 * Runtime bot-render proxy for VPS / Node.js deployment.
 *
 * What it does:
 *   - Receives all incoming requests.
 *   - Non-bots get a 302 redirect to the live site (siteUrl or targetUrl).
 *   - Bots get a Puppeteer-rendered snapshot of the target page.
 *   - Rendered HTML is cached to disk. Cache entries expire after cacheDuration ms.
 *   - A valid x-prestruct-refresh header (matching PRESTRUCT_SECRET) busts the
 *     cache for a specific path on demand.
 *
 * Deployment:
 *   1. Copy this file and ssr.config.js to your VPS.
 *   2. `npm install express puppeteer` (puppeteer downloads Chromium automatically).
 *   3. Set PRESTRUCT_SECRET env var to match config.proxy.secret.
 *   4. `node scripts/proxy.js` -- or use pm2 / systemd to keep it alive.
 *   5. Reverse-proxy port 3000 (or $PORT) with nginx/caddy for TLS.
 *
 * Browser pooling:
 *   A single Chromium instance is shared across all requests. Pages are opened
 *   and closed per request, but the browser process stays warm. This avoids the
 *   cold-start cost and OOM risk of launching a browser per request.
 *   On crash or unhandled error the browser reference is cleared and reopened
 *   on the next request.
 *
 * Cache key:
 *   SHA-256 of the full URL path + query string. Using a hash avoids any
 *   filesystem-unsafe characters from raw URL segments.
 *
 * Security:
 *   - Cache refresh requires a matching PRESTRUCT_SECRET. Without it, the header
 *     is ignored. An empty or null secret disables refresh entirely.
 *   - Only GET requests are processed. All others return 405.
 *   - Request URL is validated before being passed to Puppeteer.
 *
 * targetUrl vs siteUrl:
 *   Set config.proxy.targetUrl to point the proxy at a different origin than
 *   siteUrl. Useful when the proxy sits in front of a separate backend (WordPress,
 *   a staging URL, or localhost:5173 for local dev). Defaults to siteUrl.
 */

import express       from 'express'
import puppeteer     from 'puppeteer'
import fs            from 'fs'
import path          from 'path'
import crypto        from 'crypto'
import config        from '../ssr.config.js'

const {
  siteUrl,
  proxy: proxyConfig = {},
} = config

// Validate required siteUrl
if (!siteUrl) {
  console.error('[proxy] siteUrl is required in ssr.config.js')
  process.exit(1)
}

const TARGET_URL   = (proxyConfig.targetUrl || siteUrl).replace(/\/$/, '')

// Validate TARGET_URL is a valid URL
try {
  new URL(TARGET_URL)
} catch (err) {
  console.error('[proxy] Invalid targetUrl:', TARGET_URL)
  process.exit(1)
}

const CACHE_DIR    = path.resolve('.prestruct_cache')
const CACHE_TTL    = 1000 * 60 * 60 * 24   // 24 hours -- adjust if needed
const MAX_CACHE_SIZE = 500 * 1024 * 1024    // 500MB max cache size
const PORT         = parseInt(process.env.PORT || '3000', 10)
const SECRET       = process.env.PRESTRUCT_SECRET || null

// ── Bot detection ─────────────────────────────────────────────────────────────

const BOT_LIST = proxyConfig.botList || []

function isBot(ua) {
  if (!ua) return false
  const lower = ua.toLowerCase()
  return BOT_LIST.some(token => lower.includes(token))
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })

function cacheKey(url) {
  return crypto.createHash('sha256').update(url).digest('hex')
}

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.html`)
}

function cacheRead(key) {
  const p = cachePath(key)
  if (!fs.existsSync(p)) return null
  const stat = fs.statSync(p)
  if (Date.now() - stat.mtimeMs > CACHE_TTL) return null
  return { html: fs.readFileSync(p, 'utf8'), cachedAt: stat.mtime.toISOString() }
}

function cacheWrite(key, html) {
  fs.writeFileSync(cachePath(key), html, 'utf8')
  // Cleanup if cache exceeds limit
  cleanupCache()
}

// Cleanup old/large cache files
let lastCleanup = 0
function cleanupCache() {
  const now = Date.now()
  // Only run cleanup once per minute max
  if (now - lastCleanup < 60000) return
  lastCleanup = now
  
  try {
    const files = fs.readdirSync(CACHE_DIR).map(f => {
      const p = path.join(CACHE_DIR, f)
      const stat = fs.statSync(p)
      return { path: p, size: stat.size, mtime: stat.mtimeMs }
    })
    
    // Calculate total size
    let totalSize = files.reduce((sum, f) => sum + f.size, 0)
    
    // If over limit, remove oldest files
    if (totalSize > MAX_CACHE_SIZE) {
      files.sort((a, b) => a.mtime - b.mtime)
      while (totalSize > MAX_CACHE_SIZE * 0.8 && files.length > 0) {
        const oldest = files.shift()
        fs.unlinkSync(oldest.path)
        totalSize -= oldest.size
      }
      console.log('[proxy] Cache cleaned up, removed', files.length, 'files')
    }
  } catch (err) {
    console.warn('[proxy] Cache cleanup failed:', err.message)
  }
}

// ── Browser pool (single shared instance) ────────────────────────────────────

let browser = null

async function getBrowser() {
  if (browser) return browser
  browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // avoids /dev/shm OOM on Linux containers
      '--disable-gpu',
    ],
    headless: true,
  })
  browser.on('disconnected', () => {
    // Clear the reference so the next request spawns a fresh instance
    console.warn('[proxy] Browser disconnected -- will reopen on next request')
    browser = null
  })
  return browser
}

// ── Render ────────────────────────────────────────────────────────────────────

async function render(targetFullUrl) {
  const b    = await getBrowser()
  const page = await b.newPage()
  try {
    await page.setViewport({ width: 1280, height: 800 })
    // Tag the request so origin servers can identify proxy traffic
    await page.setExtraHTTPHeaders({ 'X-Prestruct-Proxy': 'true' })
    await page.goto(targetFullUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    return await page.content()
  } finally {
    // Always close the page to free memory, even on error
    await page.close().catch(() => {})
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express()

// Limit concurrent rendering requests to prevent overwhelming the system
const MAX_CONCURRENT = 5
let activeRenders = 0
const renderQueue = []

async function withRenderLimit(fn) {
  if (activeRenders < MAX_CONCURRENT) {
    activeRenders++
    try {
      return await fn()
    } finally {
      activeRenders--
      // Process next in queue
      if (renderQueue.length > 0) {
        const next = renderQueue.shift()
        next()
      }
    }
  }
  // Queue the request
  return new Promise((resolve) => {
    renderQueue.push(() => fn().then(resolve))
  })
}

// Only GET -- proxying other methods through Puppeteer is meaningless
app.all('*', (req, res, next) => {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed.')
  next()
})

app.get('*', async (req, res) => {
  const ua  = req.headers['user-agent'] || ''
  const bot = isBot(ua)

  // Validate and build the target URL. Reject anything that produces a non-HTTP scheme.
  let targetFullUrl
  try {
    const parsed = new URL(`${TARGET_URL}${req.url}`)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol')
    targetFullUrl = parsed.toString()
  } catch {
    return res.status(400).send('Invalid request URL.')
  }

  // Non-bots redirect to the live site -- no rendering needed
  if (!bot) {
    return res.redirect(302, targetFullUrl)
  }

  // Cache refresh -- only honoured when a secret is configured and matches
  const refreshHeader = req.headers['x-prestruct-refresh']
  const forceRefresh  = SECRET && refreshHeader === SECRET

  const key    = cacheKey(req.url)
  const cached = forceRefresh ? null : cacheRead(key)

  if (cached) {
    res.setHeader('X-Prestruct-Cache',       'HIT')
    res.setHeader('X-Prestruct-Rendered-At', cached.cachedAt)
    res.setHeader('Content-Type',            'text/html; charset=utf-8')
    return res.send(cached.html)
  }

  try {
    const html = await withRenderLimit(() => render(targetFullUrl))
    cacheWrite(key, html)
    res.setHeader('X-Prestruct-Cache',       'MISS')
    res.setHeader('X-Prestruct-Rendered-At', new Date().toISOString())
    res.setHeader('Content-Type',            'text/html; charset=utf-8')
    return res.send(html)
  } catch (err) {
    console.error('[proxy] Render failed:', err.message)
    // Fall through to the live site rather than serving an error page to the bot
    return res.redirect(302, targetFullUrl)
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[proxy] Prestruct proxy listening on port ${PORT}`)
  console.log(`[proxy] Target: ${TARGET_URL}`)
  if (!SECRET) {
    console.warn('[proxy] PRESTRUCT_SECRET not set -- cache refresh disabled')
  }
})

// Pre-warm the browser so the first bot request doesn't cold-start Chromium
getBrowser().then(() => {
  console.log('[proxy] Browser ready')
}).catch(err => {
  console.error('[proxy] Browser pre-warm failed:', err.message)
})
