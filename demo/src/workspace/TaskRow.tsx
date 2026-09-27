import { memo } from 'react'
import { CloseIcon } from '../shell/Icons'
import type { Task } from './model'

interface TaskRowProps {
  task: Task
  onToggle: (id: number) => void
  onRemove: (id: number) => void
}

export const TaskRow = memo(function TaskRow({ task, onToggle, onRemove }: TaskRowProps) {
  const checkboxId = `task-${task.id}`
  return (
    <li className="task-row" data-done={task.done ? 'true' : undefined}>
      <input id={checkboxId} className="checkbox" type="checkbox" checked={task.done} onChange={() => onToggle(task.id)} />
      <label htmlFor={checkboxId} className="task-row__title truncate">
        {task.title}
      </label>
      <span className={`tag tag--priority-${task.priority.toLowerCase()}`}>{task.priority}</span>
      <button type="button" className="icon-button icon-button--sm" aria-label={`Remove “${task.title}”`} onClick={() => onRemove(task.id)}>
        <CloseIcon width={12} height={12} />
      </button>
    </li>
  )
})
