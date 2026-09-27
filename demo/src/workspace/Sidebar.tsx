import { memo } from 'react'
import type { WorkspaceView } from './model'
import { NavList } from './NavList'

interface SidebarProps {
  view: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  counts: { unread: number; starred: number; archived: number; openTasks: number }
}

/** Vertical navigation on desktop; collapses to a horizontal segmented nav under 900px (CSS). */
export const Sidebar = memo(function Sidebar({ view, onViewChange, counts }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Mailboxes">
      <p className="sidebar__label">Mailboxes</p>
      <NavList view={view} onViewChange={onViewChange} counts={counts} />
      <div className="sidebar__account">
        <span className="avatar avatar--sm" aria-hidden="true">
          AK
        </span>
        <span className="sidebar__account-text">
          <span className="truncate">Alex Kim</span>
          <span className="truncate text-secondary">alex@northstar.app</span>
        </span>
      </div>
    </aside>
  )
})
