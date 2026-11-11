import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mockApiPlugin } from './server/mockApi'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), mockApiPlugin()],
  build: {
    // The Accessibility card lazily loads the two vendored rule engines (~0.6 MB each, raw source);
    // they are separate on-demand chunks, never part of the main bundle.
    chunkSizeWarningLimit: 800,
  },
  server: {
    fs: {
      // core/ is imported via a relative path outside the demo root.
      allow: ['..'],
    },
  },
})
