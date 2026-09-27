import { useEffect, useState } from 'react'
import { About } from './about/About'
import { ScenarioLab } from './scenarios/ScenarioLab'
import { TopBar, type AppTab } from './shell/TopBar'
import { Workspace } from './workspace/Workspace'

const TAB_KEYS: Record<string, AppTab> = { '1': 'workspace', '2': 'lab', '3': 'about' }
const TAB_ORDER: AppTab[] = ['workspace', 'lab', 'about']

function readInitialTab(): AppTab {
  const hash = window.location.hash.replace('#', '')
  return TAB_ORDER.find((tab) => tab === hash) ?? 'workspace'
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function App() {
  const [tab, setTab] = useState<AppTab>(readInitialTab)

  const changeTab = (next: AppTab) => {
    setTab(next)
    window.history.replaceState(null, '', `#${next}`)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return
      const next = TAB_KEYS[event.key]
      if (!next) return
      event.preventDefault()
      setTab(next)
      window.history.replaceState(null, '', `#${next}`)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar tab={tab} onTabChange={changeTab} />
      <main id="main" className="app__main" tabIndex={-1}>
        <div id={`app-panel-${tab}`} className="app__panel" role="tabpanel" aria-labelledby={`app-tab-${tab}`}>
          {tab === 'workspace' ? <Workspace /> : null}
          {tab === 'lab' ? <ScenarioLab /> : null}
          {tab === 'about' ? <About /> : null}
        </div>
      </main>
    </div>
  )
}
