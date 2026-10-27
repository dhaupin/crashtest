import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// react-router v7 note (three-way loader agreement; keep this comment as
// long as the version pair stays):
// The full story lives in web/src/router-interop.js - the short version is
// that NO config side-aims (aliases to the ESM dist, ssr.noExternal,
// module-sync conditions) measure up: each one either splits the router
// into two instances (killing the prerender context handoff) or trips
// vite's externalized-CSS analyzer. The single-file shape that works: the
// app imports the router ONLY through web/src/router-interop.js, whose
// namespace/default fallback keeps every lane landing on ONE native
// instance. If you bump react-router or vite: rerun the build and keep a
// 6/6 prerender green - that is the gate that guards this pairing.

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Performance optimizations
    minify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Separate vendor chunk for better caching. NOTE: the app files use
        // the router only via src/router-interop.js, so chunk membership is
        // by module id; listing the specifier here keeps the manual chunk
        // stable without caring which leaf got resolved.
        manualChunks: {
          'vendor': ['react', 'react-dom'],
        },
      },
    },
  },
  // Hint to browsers about preloaded resources
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
})
