import { chromium, type FullConfig } from '@playwright/test'

/**
 * Loads every project's app once before the tests: a cold Vite dev server
 * transforms modules on the first request, and that one-off page-load cost
 * would otherwise land in whichever test happens to run first.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const browser = await chromium.launch()
  try {
    for (const project of config.projects) {
      const baseURL = project.use.baseURL
      if (!baseURL) continue
      const page = await browser.newPage()
      await page.goto(`${baseURL}#workspace`)
      await page.locator('.message-row').first().waitFor({ timeout: 60_000 })
      // Also pull in the Accessibility card's lazy chunks.
      await page.goto(`${baseURL}#lab`)
      await page.locator('article[data-scenario="a11y-issues"] [data-scenario-run]').click()
      await page.locator('article[data-scenario="a11y-issues"] .status-badge', { hasText: /found$/ }).waitFor({ timeout: 60_000 })
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
