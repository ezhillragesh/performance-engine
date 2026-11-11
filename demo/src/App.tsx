import { useEffect, useState, type ReactNode } from 'react'
import { trackAction } from 'performance-engine'
import { About } from './about/About'
import { ScenarioLab } from './scenarios/ScenarioLab'
import { TopBar, type AppTab } from './shell/TopBar'
import { Workspace } from './workspace/Workspace'

const TAB_ORDER: AppTab[] = ['workspace', 'lab', 'about']
const TAB_KEYS: Record<string, AppTab> = { '1': 'workspace', '2': 'lab', '3': 'about' }
const TAB_NAMES: Record<AppTab, string> = { workspace: 'Workspace', lab: 'Scenario Lab', about: 'About' }

/*
 * Every page stays mounted; switching tabs only toggles `hidden`. That keeps
 * Workspace and Lab state across tabs, and a tab switch re-renders just the
 * top bar instead of mounting a whole page inside the click's trace (which the
 * engine would rightly report as a render burst). Hoisted elements are
 * referentially stable, so App re-renders never reach the pages.
 */
const PAGES: Record<AppTab, ReactNode> = {
  workspace: <Workspace />,
  lab: <ScenarioLab />,
  about: <About />,
}

function tabFromHash(): AppTab | null {
  const hash = window.location.hash.replace('#', '')
  return TAB_ORDER.find((tab) => tab === hash) ?? null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(() => tabFromHash() ?? 'workspace')

  /*
   * Navigation is an app action, so it gets its own named trace in DevTools
   * ("action "Open Scenario Lab""), whichever click, shortcut or hash change
   * caused it. Without `newTrace` the renders would belong to the triggering
   * event, and a keyboard shortcut would read like typing that re-renders the app.
   */
  const navigate = (next: AppTab, updateHash: boolean) => {
    trackAction(`Open ${TAB_NAMES[next]}`, () => setTab(next), { newTrace: true })
    if (updateHash) window.history.replaceState(null, '', `#${next}`)
  }
  const changeTab = (next: AppTab) => navigate(next, true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      const next = TAB_KEYS[event.key]
      if (!next) return
      event.preventDefault()
      navigate(next, true)
    }
    // Links such as `#about` and manual hash edits; other hashes (in-page anchors) are ignored.
    const onHashChange = () => {
      const next = tabFromHash()
      if (next) navigate(next, false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])

  return (
    <div className="app">
      <TopBar tab={tab} onTabChange={changeTab} />
      <main id="main" className="app__main" tabIndex={-1}>
        {TAB_ORDER.map((page) => (
          <div
            key={page}
            id={`app-panel-${page}`}
            className="app__panel"
            role="tabpanel"
            aria-labelledby={`app-tab-${page}`}
            hidden={page !== tab}
          >
            {PAGES[page]}
          </div>
        ))}
      </main>
    </div>
  )
}
