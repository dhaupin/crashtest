import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// react-router v7 note (eyestruct#14 pull-in, crashtest#50): the engine now
// loads StaticRouter through the SAME vite SSR registry as the app, so the
// consumer-side router-interop.js shim is retired (app files import
// 'react-router-dom' directly; the engine's interop plugin rewrites the named
// imports). On this vite ^6.4.5 pin the engine's externalized default still
// splits the router into two instances ("useLocation() may be used only in the
// context of a <Router>"), so ssr.noExternal keeps the router in the registry
// and holds ONE instance. Verify with prestruct build: "Done. n/n pages
// rendered".

export default defineConfig({
  ssr: { noExternal: ['react-router-dom', 'react-router'] },
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Performance optimizations
    minify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Separate vendor chunk for better caching.
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
