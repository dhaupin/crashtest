/**
 * scripts/inject-brand.js
 * =======================
 * Post-build script. Runs after `vite build` via `npm run build`.
 * Reads ssr.config.js and injects all head meta into dist/index.html:
 *   - <title>
 *   - <meta name="description">
 *   - <meta name="author">
 *   - <meta name="keywords">
 *   - <link rel="canonical">
 *   - Open Graph tags (og:type, og:url, og:title, og:description, og:image, og:site_name)
 *   - Twitter Card tags
 *   - JSON-LD structured data (from config.buildJsonLd())
 *   - <meta name="deploy-id"> with build identifier
 *
 * If config.proxy.url is set, also updates dist/_headers to add the proxy
 * origin to connect-src. This is done precisely: it finds the existing
 * connect-src directive and appends only if the origin isn't already there.
 * Running the build twice is safe -- no duplicate entries.
 *
 * Fails gracefully -- exits 0 on any error so a bad config never blocks deployment.
 * The site will still deploy as a working SPA without prerendered meta.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

const distDir  = resolve('dist')
const htmlPath = join(distDir, 'index.html')

// Generate deploy ID from git commit hash + short timestamp
function getDeployId() {
  try {
    const hash = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf8' }).trim()
    const ts = Date.now().toString(36).slice(-4)
    return `${hash}-${ts}`
  } catch {
    return `dev-${Date.now().toString(36).slice(-6)}`
  }
}

if (!existsSync(htmlPath)) {
  console.warn('[inject-brand] dist/index.html not found -- skipping')
  process.exit(0)
}

let config
try {
  config = (await import('../ssr.config.js')).default
} catch (err) {
  console.warn('[inject-brand] Could not load ssr.config.js -- skipping:', err.message)
  process.exit(0)
}

const {
  // Platform detection for host-specific config generation
  // Default: cloudflare (backward compatible)
  platform = 'cloudflare',
  // Site identity
  siteUrl, siteName, author, tagline, ogImage, keywords,
  routes = [], buildJsonLd, proxy = {},
} = config

// Validate required siteUrl
if (!siteUrl) {
  console.warn('[inject-brand] siteUrl is required in ssr.config.js -- skipping')
  process.exit(0)
}

// Only generate Cloudflare-specific files (_headers, _redirects)
// Future: vercel gets vercel.json, netlify gets netlify.toml
if (platform === 'cloudflare') {
  // _headers and _redirects are copied from init/public/ at build time
  // This section reserved for any CF-specific injection logic
}

const toReplaceSafe = (value) => (value == null ? '' : String(value).replace(/\$/g, '$$$$'))

// Homepage meta as the global description fallback
const homeRoute   = routes.find(r => r.path === '/') || {}
const title       = siteName ? (tagline ? `${siteName} | ${tagline}` : siteName) : 'Site'
const description = homeRoute.meta?.description || null
const canonical   = `${siteUrl}/`

const titleSafe       = toReplaceSafe(title)
const descriptionSafe = toReplaceSafe(description)
const authorSafe      = toReplaceSafe(author)
const keywordsSafe    = toReplaceSafe(keywords)
const canonicalSafe   = toReplaceSafe(canonical)
const ogImageSafe     = toReplaceSafe(ogImage)
const siteNameSafe    = toReplaceSafe(siteName)

let html = readFileSync(htmlPath, 'utf8')

// ── Deploy ID ───────────────────────────────────────────────────────────────────

const deployId = getDeployId()
console.log(`  Deploy ID: ${deployId}`)

// Remove previously injected deploy-id (safe to run on rebuild)
html = html.replace(/<meta name="deploy-id"[^>]*>/g, '')

// Inject deploy-id meta tag
html = html.replace('</head>', `  <meta name="deploy-id" content="${deployId}" />
</head>`)

// ── Primary meta ──────────────────────────────────────────────────────────────

html = html.replace(/<title>.*?<\/title>/s,
  `<title>${titleSafe}</title>`)

if (description) {
  html = html.replace(/<meta name="description"[^>]*>/,
    `<meta name="description" content="${descriptionSafe}" />`)
}

html = html.replace(/<meta name="author"[^>]*>/,
  `<meta name="author" content="${authorSafe}" />`)

if (keywords) {
  html = html.replace(/<meta name="keywords"[^>]*>/,
    `<meta name="keywords" content="${keywordsSafe}" />`)
}

html = html.replace(/<link rel="canonical"[^>]*>/,
  `<link rel="canonical" href="${canonicalSafe}" />`)

// ── Remove previously injected OG / JSON-LD blocks (safe to run on rebuild) ──

html = html.replace(/\n\s*<!-- Open Graph -->[\s\S]*?<\/script>\s*/g, '\n  ')

// ── Open Graph + Twitter Card ─────────────────────────────────────────────────

// Only include image tags if ogImage is provided
const imageMeta = ogImage ? `
    <meta property="og:image"        content="${ogImageSafe}" />
    <meta name="twitter:image"       content="${ogImageSafe}" />` : ''

const ogTags = `
    <!-- Open Graph -->
    <meta property="og:type"         content="website" />
    <meta property="og:url"          content="${canonicalSafe}" />
    <meta property="og:title"        content="${titleSafe}" />
    <meta property="og:description"  content="${descriptionSafe}" />${imageMeta}
    <meta property="og:locale"       content="en_US" />
    <meta property="og:site_name"    content="${siteNameSafe}" />

    <!-- Twitter / X Card -->
    <meta name="twitter:card"        content="summary_large_image" />
    <meta name="twitter:title"       content="${titleSafe}" />
    <meta name="twitter:description" content="${descriptionSafe}" />`

// ── JSON-LD ───────────────────────────────────────────────────────────────────

let jsonLdBlock = ''
if (typeof buildJsonLd === 'function') {
  const jsonLdData = buildJsonLd.call(config)
  if (Array.isArray(jsonLdData) && jsonLdData.length > 0) {
    // Wrap in @graph if multiple objects, or use directly if single
    const payload = jsonLdData.length === 1
      ? jsonLdData[0]
      : { '@context': 'https://schema.org', '@graph': jsonLdData }
    jsonLdBlock = `
    <!-- JSON-LD Structured Data -- generated from ssr.config.js -->
    <script type="application/ld+json">
    ${JSON.stringify(payload, null, 2)}
    </script>`
  }
}

const jsonLdBlockSafe = toReplaceSafe(jsonLdBlock)

html = html.replace('</head>', `${ogTags}\n${jsonLdBlockSafe}\n  </head>`)

writeFileSync(htmlPath, html, 'utf8')

console.log('[inject-brand] injection complete')
console.log(`  Title:     ${title}`)
console.log(`  Canonical: ${canonical}`)

// ── CSP update for proxy origin ───────────────────────────────────────────────
// Only runs when config.proxy.url is set.
// Appends the proxy origin to the connect-src directive in dist/_headers.
// Safe to run multiple times -- checks for existing entry before appending.

const headersPath = join(distDir, '_headers')

if (proxy?.url && existsSync(headersPath)) {
  try {
    const proxyOrigin = new URL(proxy.url).origin

    let headers = readFileSync(headersPath, 'utf8')

    // Match the full connect-src value up to (but not including) the semicolon
    const connectSrcRegex = /(Content-Security-Policy:[^\n]*connect-src\s+)([^;]+)/

    const match = headers.match(connectSrcRegex)
    if (!match) {
      console.warn('[inject-brand] connect-src not found in _headers -- skipping CSP update')
    } else {
      const existing = match[2]
      if (existing.includes(proxyOrigin)) {
        console.log(`[inject-brand] CSP already contains proxy origin (${proxyOrigin}) -- skipping`)
      } else {
        // Append the proxy origin cleanly, trimming any trailing whitespace first
        headers = headers.replace(connectSrcRegex, `$1${existing.trimEnd()} ${proxyOrigin}`)
        writeFileSync(headersPath, headers, 'utf8')
        console.log(`[inject-brand] CSP connect-src updated with proxy origin: ${proxyOrigin}`)
      }
    }
  } catch (err) {
    // A bad proxyUrl is a config mistake, not a build-blocker
    console.warn('[inject-brand] CSP update failed:', err.message)
  }
}
