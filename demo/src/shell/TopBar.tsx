import { DevtoolsHint } from './DevtoolsHint'
import { EngineStatus } from './EngineStatus'
import { BrandMark } from './Icons'
import { SegmentedControl, type Segment } from './SegmentedControl'

export type AppTab = 'workspace' | 'lab' | 'about'

// Hoisted: a tab switch re-renders TopBar, and stable elements keep that from reaching these.
const BRAND_MARK = <BrandMark />
const ENGINE_STATUS = <EngineStatus />
const DEVTOOLS_HINT = <DevtoolsHint />

const TABS: Segment<AppTab>[] = [
  { value: 'workspace', label: 'Workspace' },
  { value: 'lab', label: 'Scenario Lab' },
  { value: 'about', label: 'About' },
]

export function TopBar({ tab, onTabChange }: { tab: AppTab; onTabChange: (tab: AppTab) => void }) {
  return (
    <header className="topbar">
      {/* First in tab order, inside the banner landmark. */}
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          // Move focus without replacing the tab hash in the URL.
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <div className="topbar__inner">
        <a
          className="brand"
          href="#workspace"
          onClick={(event) => {
            event.preventDefault()
            onTabChange('workspace')
          }}
        >
          {BRAND_MARK}
          <span className="brand__name">Northstar</span>
          <span className="brand__tag">Perf Engine</span>
        </a>

        <SegmentedControl
          className="topbar__tabs"
          label="Sections"
          mode="tabs"
          idPrefix="app"
          segments={TABS}
          value={tab}
          onChange={onTabChange}
        />

        <div className="topbar__actions">
          {ENGINE_STATUS}
          {DEVTOOLS_HINT}
        </div>
      </div>
    </header>
  )
}
