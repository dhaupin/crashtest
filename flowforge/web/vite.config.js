import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Performance optimizations
    minify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Separate vendor chunk for better caching
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  // Hint to browsers about preloaded resources
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
})
