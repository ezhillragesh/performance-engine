import { fileURLToPath } from 'node:url'
import { defineConfig, type Alias } from 'vite'
import react from '@vitejs/plugin-react'
import { mockApiPlugin } from './server/mockApi'

/**
 * Build-time knobs (environment variables):
 *
 *   DEMO_BASE=/performance-engine/   public path for hosting under a sub-path (GitHub Pages).
 *   DEMO_REACT_PROFILING=0           ship React's plain production build. By default the
 *                                    build uses React's profiling build so render durations
 *                                    (slow-component) are real, as they are in `npm run dev`.
 */
function basePath(): string {
  const trimmed = (process.env.DEMO_BASE ?? '').trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}

const profilingBuild = !['0', 'false', 'no'].includes((process.env.DEMO_REACT_PROFILING ?? '').trim().toLowerCase())

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const isBuild = command === 'build'
  const aliases: Alias[] = [
    // The demo consumes core the way an app would, by package name, but from source
    // (no core build step; HMR follows edits in ../core). Mirrored in tsconfig.app.json `paths`.
    { find: /^performance-engine$/, replacement: fileURLToPath(new URL('../core/index.ts', import.meta.url)) },
  ]
  // Same API as react-dom/client, plus fiber timing (actualDuration) in production.
  if (isBuild && profilingBuild) aliases.push({ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' })

  return {
    base: basePath(),
    plugins: [react(), mockApiPlugin()],
    resolve: { alias: aliases },
    define: {
      /** Whether React records render durations in this build (dev or profiling). */
      __REACT_RENDER_TIMING__: JSON.stringify(!isBuild || profilingBuild),
    },
    build: {
      // The Accessibility card lazily loads the two vendored rule engines (~0.6 MB each, raw source);
      // they are separate on-demand chunks, never part of the main bundle.
      chunkSizeWarningLimit: 800,
      rolldownOptions: {
        // Keep component names readable in insights (the engine reports React component names).
        output: { keepNames: true },
      },
    },
    server: {
      fs: {
        // core/ lives outside the demo root.
        allow: ['..'],
      },
    },
  }
})
