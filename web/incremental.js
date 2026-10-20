/* eslint-disable no-unused-vars */
// incremental.js
// Raw incremental prerender - cache HTML per route
// 
// Usage:
//   node scripts/prerender.js --force    # rebuild all
//   node scripts/prerender.js --clean  # clear cache

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = join(ROOT, '.prestruct/cache')
const CACHE_FILE = join(CACHE_DIR, 'routes.json')

const args = process.argv.slice(2)
const FORCE = args.includes('--force')
const CLEAN = args.includes('--clean')

function readCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function writeCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

// Clear cache
if (CLEAN) {
  writeCache({})
  console.log('[prerender] Cache cleared')
  process.exit(0)
}

// Main incremental logic:
// - readCache() loads { "/path": { html, time } }
// - For each route in ssr.config.js:
//   - If in cache && !FORCE: skip (use cached HTML)
//   - If not in cache || FORCE: render fresh
// - writeCache() saves result
//
// Usage in prerender.js:
//   const cache = readCache()
//   for (const route of routes) {
//     if (cache[route.path] && !FORCE) {
//       console.log(`[prerender] ${route.path} (cached)`)
//       writeFile(join(distDir, route.path, 'index.html'), cache[route.path].html)
//       continue
// }
//     const html = await render(route)  // your existing render logic
//     cache[route.path] = { html, time: Date.now() }
//   }
//   writeCache(cache)

console.log('[prerender] incremental loaded')
console.log('  --force  : rebuild all')
console.log('  --clean  : clear cache')