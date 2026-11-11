import { expect, type Locator, type Page } from '@playwright/test'

export interface InsightSummary {
  issueType: string
  source: string
  severity: string
  /** `performance.now()` end of the insight's window, when it has one. */
  windowEnd: number | null
}

/** Insights currently reported by the demo's engine session (`window.__perfSession`). */
export function readInsights(page: Page): Promise<InsightSummary[]> {
  return page.evaluate(() => {
    const session = (globalThis as unknown as { __perfSession: { getInsights(): Array<{ issueType: string; source: string; severity: string; metadata?: Record<string, unknown> }> } }).__perfSession
    return session.getInsights().map((insight) => {
      const end = insight.metadata?.timeWindowEnd ?? insight.metadata?.timeWindowStart
      return { issueType: insight.issueType, source: insight.source, severity: insight.severity, windowEnd: typeof end === 'number' ? end : null }
    })
  })
}

export function now(page: Page): Promise<number> {
  return page.evaluate(() => performance.now())
}

/** Collects console errors and uncaught exceptions; `allow` filters expected ones. */
export function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return { errors }
}

/** Opens a tab by hash and waits until React has committed it. */
export async function openTab(page: Page, tab: 'workspace' | 'lab' | 'about'): Promise<void> {
  await page.goto(`./#${tab}`)
  await expect(page.locator(`#app-panel-${tab}`)).toBeVisible()
}

/** The card's status badge (cards may contain other live regions, e.g. an <output>). */
export function badge(scenario: Locator): Locator {
  return scenario.locator('.status-badge')
}

export function card(page: Page, id: string): Locator {
  return page.locator(`article[data-scenario="${id}"]`)
}

export async function setFixed(scenario: Locator): Promise<void> {
  const toggle = scenario.getByRole('button', { name: 'Fixed version' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
}

/** Clicks the card's Run button and checks the run actually started. */
export async function run(scenario: Locator, startTimeoutMs = 2_000): Promise<void> {
  await scenario.locator('[data-scenario-run]').click()
  await expect(scenario).not.toHaveAttribute('data-status', 'idle', { timeout: startTimeoutMs })
}
