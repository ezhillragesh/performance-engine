import type { ReactNode } from 'react'
import { ArchiveIcon, CheckIcon, InboxIcon, StarIcon } from '../shell/Icons'
import type { WorkspaceView } from './model'

interface NavListProps {
  view: WorkspaceView
  onViewChange: (view: WorkspaceView) => void
  counts: { unread: number; starred: number; archived: number; openTasks: number }
}

export function NavList({ view, onViewChange, counts }: NavListProps) {
  const items: Array<{ value: WorkspaceView; label: string; icon: ReactNode; count: number }> = [
    { value: 'inbox', label: 'Inbox', icon: <InboxIcon />, count: counts.unread },
    { value: 'starred', label: 'Starred', icon: <StarIcon />, count: counts.starred },
    { value: 'tasks', label: 'Tasks', icon: <CheckIcon />, count: counts.openTasks },
    { value: 'archive', label: 'Archive', icon: <ArchiveIcon />, count: counts.archived },
  ]

  return (
    <nav className="nav-list" aria-label="Workspace views">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="nav-list__item"
          aria-current={item.value === view ? 'page' : undefined}
          onClick={() => onViewChange(item.value)}
        >
          <span className="nav-list__icon">{item.icon}</span>
          <span className="nav-list__label truncate">{item.label}</span>
          {item.count > 0 ? <span className="nav-list__count tabular">{item.count}</span> : null}
        </button>
      ))}
    </nav>
  )
}
