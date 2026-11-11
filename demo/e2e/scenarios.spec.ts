import { expect, test, type Page } from '@playwright/test'
import { badge, card, now, openTab, readInsights, run, setFixed, watchConsole, type InsightSummary } from './helpers'

/**
 * Every Scenario Lab card, both variants, on a fresh page each:
 * the problem version must produce the card's issue type, the Fixed version must not.
 * Each check reads the card badge (`data-status`) and the engine session itself.
 */
interface Case {
  id: string
  issueTypes: string[]
  /** Restricts which insights count (matched against `source`), like the card's own expectation. */
  source?: RegExp
  /** Prepare the Fixed run the way a user would (e.g. hover to prefetch). */
  beforeFixedRun?: (page: Page) => Promise<void>
}

const CASES: Case[] = [
  { id: 'render-burst', issueTypes: ['interaction-induced-render-burst'] },
  { id: 'keystroke-loop', issueTypes: ['keystroke-render-loop'] },
  { id: 'slow-handler', issueTypes: ['interaction-render-latency', 'slow-interaction', 'long-task'] },
  {
    id: 'slow-network',
    issueTypes: ['network-blocking-render'],
    beforeFixedRun: async (page) => {
      // Hovering the button prefetches; a user reads the label before clicking.
      const prefetched = page.waitForResponse((response) => response.url().includes('api/slow'))
      await card(page, 'slow-network').locator('[data-scenario-run]').hover()
      await prefetched
    },
  },
  { id: 'state-thrash', issueTypes: ['state-thrashing'], source: /ThrashMeter/ },
  { id: 'wasted-renders', issueTypes: ['wasted-render'], source: /ExpensiveChart/ },
  { id: 'slow-component', issueTypes: ['slow-component'], source: /SlowWidget/ },
  { id: 'request-failure', issueTypes: ['network-blocking-render', 'budget-exceeded'], source: /api\/slow|networkRequestMs/ },
]

/** Insights of the expected kind produced after `since`. Budget insights have no window: any one counts. */
function relevant(insights: InsightSummary[], scenario: Case, since: number): InsightSummary[] {
  return insights.filter(
    (insight) =>
      scenario.issueTypes.includes(insight.issueType) &&
      (!scenario.source || scenario.source.test(insight.source)) &&
      (insight.windowEnd === null || insight.windowEnd >= since),
  )
}

test.describe('Scenario Lab', () => {
  for (const scenario of CASES) {
    test(`${scenario.id}: problem version is detected`, async ({ page }) => {
      const console = watchConsole(page)
      await openTab(page, 'lab')
      const target = card(page, scenario.id)
      const since = await now(page)
      await run(target)
      await expect(target).toHaveAttribute('data-status', 'detected', { timeout: 15_000 })
      expect(relevant(await readInsights(page), scenario, since).length).toBeGreaterThan(0)
      // The only expected console error is the deliberate HTTP 500.
      expect(console.errors.filter((error) => !/status of 500/.test(error))).toEqual([])
    })

    test(`${scenario.id}: Fixed version is clean`, async ({ page }) => {
      const console = watchConsole(page)
      await openTab(page, 'lab')
      const target = card(page, scenario.id)
      await setFixed(target)
      await scenario.beforeFixedRun?.(page)
      const since = await now(page)
      await run(target)
      // "missed" on a Fixed card is the success state: the run timed out with no matching insight.
      await expect(target).toHaveAttribute('data-status', 'missed', { timeout: 15_000 })
      await expect(badge(target)).toHaveText(/Fixed · no insight/)
      expect(relevant(await readInsights(page), scenario, since)).toEqual([])
      expect(console.errors).toEqual([])
    })
  }

  test('healthy control produces zero insights', async ({ page }) => {
    const console = watchConsole(page)
    await openTab(page, 'lab')
    const target = card(page, 'healthy')
    await run(target)
    await expect(target).toHaveAttribute('data-status', 'clean', { timeout: 15_000 })
    expect(await readInsights(page)).toEqual([])
    expect(console.errors).toEqual([])
  })

  test('accessibility card: issues found, Fixed version has no errors or warnings', async ({ page }) => {
    test.slow() // loads two rule engines (~1.3 MB) on first run
    await openTab(page, 'lab')
    const target = card(page, 'a11y-issues')
    const status = badge(target)

    await run(target, 15_000)
    await expect(status).toHaveText(/\d+ issues found$/, { timeout: 30_000 })
    await expect(target).toHaveAttribute('data-status', 'detected')

    // Toggling re-audits the new markup; the pointer stays on the card, as a user's would.
    await setFixed(target)
    await expect(status).toHaveText('No issues ✓', { timeout: 30_000 })
    await expect(target).toHaveAttribute('data-status', 'clean')
  })
})

test('Run all scenarios: every card reaches its expected state', async ({ page }) => {
  test.setTimeout(120_000)
  const console = watchConsole(page)
  await openTab(page, 'lab')
  await page.getByRole('button', { name: 'Run all scenarios' }).click()
  await expect(page.getByText('All scenarios ran.')).toBeVisible({ timeout: 90_000 })

  for (const scenario of CASES) {
    await expect(card(page, scenario.id), scenario.id).toHaveAttribute('data-status', 'detected', { timeout: 15_000 })
  }
  await expect(card(page, 'healthy')).toHaveAttribute('data-status', 'clean', { timeout: 15_000 })
  await expect(badge(card(page, 'a11y-issues'))).toHaveText(/\d+ issues found$/, { timeout: 30_000 })
  expect(console.errors.filter((error) => !/status of 500/.test(error))).toEqual([])
})
