import { expect, test } from '@playwright/test'
import { now, openTab, readInsights, watchConsole, type InsightSummary } from './helpers'

/**
 * Count-only render rules (no cost threshold) note any click that re-renders 6+ components,
 * or keystroke that re-renders 3+, at low/medium severity even when it takes a few ms.
 * The control surface must not produce anything beyond those notes.
 */
const COUNT_ONLY = new Set(['interaction-induced-render-burst', 'keystroke-render-loop'])
function costly(insights: InsightSummary[]): InsightSummary[] {
  return insights.filter((i) => !COUNT_ONLY.has(i.issueType) || i.severity === 'high' || i.severity === 'critical')
}

test.describe('Workspace (the control surface)', () => {
  test('loads mail from the mock API; using it costs nothing measurable', async ({ page }) => {
    const console = watchConsole(page)
    await openTab(page, 'workspace')
    const rows = page.locator('.message-row')
    await expect(rows.first()).toBeVisible()
    expect(await rows.count()).toBe(10) // 12 seeded messages, 2 archived
    const since = await now(page)

    await rows.nth(2).click()
    await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true')

    await page.getByRole('searchbox', { name: 'Search mail' }).fill('metrics')
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(rows).toHaveCount(10)

    await page.getByRole('group', { name: 'Filter by category' }).getByRole('button', { name: 'Finance' }).click()
    await page.getByRole('navigation', { name: 'Workspace views' }).getByRole('button', { name: /Tasks/ }).click()
    await page.getByRole('textbox', { name: 'New follow-up' }).fill('Ship the demo')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Ship the demo')).toBeVisible()

    // Let an analysis tick (1.5s) run over everything above.
    await page.waitForTimeout(2_500)
    const fromUse = (await readInsights(page)).filter((i) => i.windowEnd === null || i.windowEnd >= since)
    expect(costly(fromUse)).toEqual([])
    expect(console.errors).toEqual([])
  })

  test('tab switches keep state and do not create insights', async ({ page }) => {
    await openTab(page, 'workspace')
    await expect(page.locator('.message-row').first()).toBeVisible()
    const tabs = page.getByRole('tablist', { name: 'Sections' })

    await tabs.getByRole('tab', { name: 'Scenario Lab' }).click()
    await expect(page).toHaveURL(/#lab$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Reproduce every rule on demand' })).toBeVisible()

    // Keyboard: arrows move between tabs (WAI-ARIA tabs pattern).
    await tabs.getByRole('tab', { name: 'Scenario Lab' }).press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: 'About' })).toBeFocused()
    await expect(page.getByRole('heading', { level: 1, name: 'How the demo works' })).toBeVisible()

    await page.keyboard.press('1')
    await expect(tabs.getByRole('tab', { name: 'Workspace' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.message-row').first()).toBeVisible()

    await page.waitForTimeout(2_500)
    expect(await readInsights(page)).toEqual([])
  })
})
