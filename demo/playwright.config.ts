import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end scenario checks against both ways the demo ships:
 *
 *   dev  - `vite` dev server (React development build, mock API as middleware)
 *   prod - production build served statically by `vite preview` (React profiling
 *          build, mock API from the Service Worker; no middleware)
 *
 * The prod build goes to node_modules/.e2e-dist so it never touches dist/.
 * Ports can be overridden with E2E_DEV_PORT / E2E_PROD_PORT.
 */
const DEV_PORT = Number(process.env.E2E_DEV_PORT ?? 5175)
const PROD_PORT = Number(process.env.E2E_PROD_PORT ?? 5176)
const PROD_OUT = 'node_modules/.e2e-dist'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Scenarios measure real main-thread timing; parallel workers would skew them.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'dev', use: { baseURL: `http://localhost:${DEV_PORT}/` } },
    { name: 'prod', use: { baseURL: `http://localhost:${PROD_PORT}/` } },
  ],
  webServer: [
    {
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npx vite build --outDir ${PROD_OUT} --emptyOutDir --logLevel warn && npx vite preview --outDir ${PROD_OUT} --port ${PROD_PORT} --strictPort`,
      url: `http://localhost:${PROD_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
