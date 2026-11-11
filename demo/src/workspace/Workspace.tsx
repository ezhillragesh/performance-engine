import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { runDetached } from 'performance-engine'
import { useHeavyMode } from '../scenarios/useHeavyMode'
import { PanelIcon } from '../shell/Icons'
import { Toggle } from '../shell/Toggle'
import { FilterBar } from './FilterBar'
import { MessageDetail } from './MessageDetail'
import { MessageList } from './MessageList'
import {
  createIncomingMessage,
  fetchMessages,
  filterMessages,
  SEED_TASKS,
  type CategoryFilter,
  type LoadState,
  type Message,
  type Task,
  type TaskPriority,
  type WorkspaceView,
} from './model'
import { SearchBar } from './SearchBar'
import { Sidebar } from './Sidebar'
import { StatTiles } from './StatTiles'
import { TaskPanel } from './TaskPanel'

const SYNC_INTERVAL_MS = 4000

/**
 * Applies a state update the user did not cause (page-load data, background
 * sync) synchronously and outside any live trace. Otherwise React renders it
 * in a later task, inside whatever click or keystroke happens to be in flight,
 * and the engine would count those renders as that interaction's work.
 */
function applyUntraced(update: () => void): void {
  runDetached(() => flushSync(update))
}
const MAX_MESSAGES = 60

const VIEW_COPY: Record<WorkspaceView, { title: string; lede: string }> = {
  inbox: { title: 'Inbox', lede: 'Everything that still needs your attention.' },
  starred: { title: 'Starred', lede: 'Messages you flagged to come back to.' },
  tasks: { title: 'Tasks', lede: 'Follow-ups captured from your mail.' },
  archive: { title: 'Archive', lede: 'Handled and filed away.' },
}

export function Workspace() {
  const [messages, setMessages] = useState<Message[]>([])
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [view, setView] = useState<WorkspaceView>('inbox')
  const [category, setCategory] = useState<CategoryFilter>('All')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [syncOn, setSyncOn] = useState(false)
  const [tasks, setTasks] = useState<Task[]>(SEED_TASKS)
  const nextTaskId = useRef(SEED_TASKS.length + 1)
  const heavy = useHeavyMode()

  // Initial load (and retry). State is only set from the promise callbacks.
  useEffect(() => {
    const controller = new AbortController()
    fetchMessages(controller.signal).then(
      (data) =>
        applyUntraced(() => {
          setMessages(data)
          setLoad({ status: 'ready' })
        }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ status: 'error', message: error instanceof Error ? error.message : 'Network error' })
      },
    )
    return () => controller.abort()
  }, [reloadKey])

  // Opt-in background sync: prepends one new message every few seconds.
  // It never touches existing messages (the old demo re-marked message 0 unread).
  useEffect(() => {
    if (!syncOn) return
    let sequence = 0
    const interval = window.setInterval(() => {
      const incoming = createIncomingMessage(sequence, Date.now())
      sequence += 1
      applyUntraced(() => setMessages((current) => [incoming, ...current].slice(0, MAX_MESSAGES)))
    }, SYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [syncOn])

  const retry = useCallback(() => {
    setLoad({ status: 'loading' })
    setReloadKey((key) => key + 1)
  }, [])

  const visible = useMemo(() => filterMessages(messages, view, category, query), [messages, view, category, query])
  const selected = visible.find((message) => message.id === selectedId) ?? visible[0] ?? null

  const counts = useMemo(() => {
    let unread = 0
    let starred = 0
    let archived = 0
    for (const message of messages) {
      if (message.archived) {
        archived += 1
        continue
      }
      if (message.unread) unread += 1
      if (message.starred) starred += 1
    }
    const openTasks = tasks.reduce((total, task) => total + (task.done ? 0 : 1), 0)
    return { unread, starred, archived, openTasks }
  }, [messages, tasks])

  const updateMessage = useCallback((id: number, patch: (message: Message) => Partial<Message>) => {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, ...patch(message) } : message)))
  }, [])

  const selectMessage = useCallback(
    (id: number) => {
      setSelectedId(id)
      updateMessage(id, () => ({ unread: false }))
    },
    [updateMessage],
  )

  const toggleStar = useCallback((id: number) => updateMessage(id, (m) => ({ starred: !m.starred })), [updateMessage])
  const toggleRead = useCallback((id: number) => updateMessage(id, (m) => ({ unread: !m.unread })), [updateMessage])
  const toggleArchive = useCallback((id: number) => updateMessage(id, (m) => ({ archived: !m.archived })), [updateMessage])

  const addTask = useCallback((title: string, priority: TaskPriority = 'Normal') => {
    // Ids come from a monotonic counter, not `tasks.length + 1` (which collided after deletes).
    const id = nextTaskId.current
    nextTaskId.current += 1
    setTasks((current) => [...current, { id, title, done: false, priority }])
  }, [])

  const toggleTask = useCallback((id: number) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }, [])

  const removeTask = useCallback((id: number) => {
    setTasks((current) => current.filter((task) => task.id !== id))
  }, [])

  const addFollowUp = useCallback((message: Message) => addTask(`Follow up: ${message.subject}`, 'Normal'), [addTask])

  const showDetail = detailsOpen && view !== 'tasks'
  const copy = VIEW_COPY[view]

  return (
    <div className="workspace">
      <Sidebar view={view} onViewChange={setView} counts={counts} />

      <section className="workspace__main" aria-labelledby="workspace-title">
        <header className="workspace__header">
          <div className="workspace__heading">
            <h1 id="workspace-title" className="page-title">
              {copy.title}
            </h1>
            <p className="page-lede">{copy.lede}</p>
          </div>
          <div className="workspace__tools">
            {view !== 'tasks' ? <SearchBar value={query} onChange={setQuery} /> : null}
            <div className="workspace__switches">
              <Toggle pressed={syncOn} onChange={setSyncOn} label="Background sync" hint="New mail every ~4s" />
              {view !== 'tasks' ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={detailsOpen}
                  aria-label={detailsOpen ? 'Hide details pane' : 'Show details pane'}
                  title={detailsOpen ? 'Hide details pane' : 'Show details pane'}
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  <PanelIcon />
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <StatTiles unread={counts.unread} starred={counts.starred} openTasks={counts.openTasks} showing={visible.length} />

        {view === 'tasks' ? (
          <TaskPanel tasks={tasks} onAdd={addTask} onToggle={toggleTask} onRemove={removeTask} variant="full" />
        ) : (
          <>
            <FilterBar value={category} onChange={setCategory} />
            <div className="workspace__content" data-detail={showDetail ? 'open' : 'closed'}>
              <MessageList
                messages={visible}
                selectedId={selected?.id ?? null}
                load={load}
                onSelect={selectMessage}
                onRetry={retry}
                heavy={heavy}
                emptyHint={query ? 'Try a different search.' : 'Nothing here right now.'}
              />
              {showDetail ? (
                <aside className="workspace__detail" aria-label="Message details">
                  <MessageDetail
                    message={selected}
                    onToggleStar={toggleStar}
                    onToggleRead={toggleRead}
                    onToggleArchive={toggleArchive}
                    onAddFollowUp={addFollowUp}
                  />
                  <TaskPanel tasks={tasks} onAdd={addTask} onToggle={toggleTask} onRemove={removeTask} variant="compact" />
                </aside>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
