import { memo, useId, useState, type FormEvent } from 'react'
import { PlusIcon } from '../shell/Icons'
import type { Task, TaskPriority } from './model'
import { TaskRow } from './TaskRow'

interface TaskPanelProps {
  tasks: Task[]
  onAdd: (title: string, priority: TaskPriority) => void
  onToggle: (id: number) => void
  onRemove: (id: number) => void
  variant: 'compact' | 'full'
}

const PRIORITIES: TaskPriority[] = ['Low', 'Normal', 'High']

export const TaskPanel = memo(function TaskPanel({ tasks, onAdd, onToggle, onRemove, variant }: TaskPanelProps) {
  const [draft, setDraft] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('Normal')
  const titleId = useId()
  const inputId = useId()
  const open = tasks.filter((task) => !task.done).length

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    onAdd(title, priority)
    setDraft('')
  }

  return (
    <section className={`card task-panel task-panel--${variant}`} aria-labelledby={titleId}>
      <header className="card__header">
        <h2 id={titleId} className="card__title">
          Follow-ups
        </h2>
        <span className="text-secondary tabular">
          {open} open · {tasks.length - open} done
        </span>
      </header>

      <form className="task-form" onSubmit={submit}>
        <label htmlFor={inputId} className="visually-hidden">
          New follow-up
        </label>
        <input
          id={inputId}
          className="input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a follow-up…"
          autoComplete="off"
        />
        <select className="select" value={priority} aria-label="Priority" onChange={(event) => setPriority(event.target.value as TaskPriority)}>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button type="submit" className="button button--primary button--sm" disabled={!draft.trim()}>
          <PlusIcon width={14} height={14} />
          Add
        </button>
      </form>

      {tasks.length === 0 ? (
        <p className="empty-state__text task-panel__empty">No follow-ups yet. Add one above.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={onToggle} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  )
})
