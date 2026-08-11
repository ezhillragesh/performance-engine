import { useEffect, useMemo, useRef, useState } from 'react'
import { useRenderTracker } from './useRenderTracker'
import './App.css'

type Message = {
  id: number
  sender: string
  subject: string
  preview: string
  body: string
  time: string
  unread: boolean
  starred: boolean
  category: 'Work' | 'Finance' | 'Ops' | 'Personal'
}

type Task = {
  id: number
  title: string
  done: boolean
  priority: 'Low' | 'Normal' | 'High'
}

const seedMessages: Message[] = [
  {
    id: 1,
    sender: 'Maya Chen',
    subject: 'Q2 launch checklist',
    preview: 'I attached the updated launch checklist and rollout notes.',
    body: 'The rollout checklist has the revised owners, the QA gates, and the fallback steps for the launch window.',
    time: '08:12',
    unread: true,
    starred: true,
    category: 'Work',
  },
  {
    id: 2,
    sender: 'Finance Desk',
    subject: 'Invoice batch ready',
    preview: 'The monthly invoice batch is ready for review.',
    body: 'Please review the invoice batch before 3 PM so we can release the payment run this afternoon.',
    time: '09:04',
    unread: true,
    starred: false,
    category: 'Finance',
  },
  {
    id: 3,
    sender: 'Ops Team',
    subject: 'Status page update',
    preview: 'A small status page update is scheduled for tonight.',
    body: 'The status page copy is being refreshed for the scheduled maintenance window at 11 PM.',
    time: '10:11',
    unread: false,
    starred: false,
    category: 'Ops',
  },
  {
    id: 4,
    sender: 'Noah',
    subject: 'Lunch next week?',
    preview: 'Are you around next Tuesday?',
    body: 'No pressure, just checking if you want to grab lunch next Tuesday when you are in the office.',
    time: '10:47',
    unread: false,
    starred: false,
    category: 'Personal',
  },
  {
    id: 5,
    sender: 'Support',
    subject: 'Ticket summary',
    preview: 'Three tickets were updated overnight.',
    body: 'The overnight summary shows three customer tickets moved to pending with notes from the support queue.',
    time: '11:32',
    unread: true,
    starred: false,
    category: 'Work',
  },
]

const seedTasks: Task[] = [
  { id: 1, title: 'Review launch checklist', done: false, priority: 'High' },
  { id: 2, title: 'Approve invoice batch', done: false, priority: 'Normal' },
  { id: 3, title: 'Update status page copy', done: true, priority: 'Low' },
]

type Telemetry = {
  events: number
  ui: number
  renders: number
  network: number
  insights: number
}

const EMPTY_TELEMETRY: Telemetry = { events: 0, ui: 0, renders: 0, network: 0, insights: 0 }

/** Live read-out of what the perf engine is capturing right now. */
function TelemetryBar() {
  const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY)

  useEffect(() => {
    const read = () => {
      const session = window.__perfSession
      if (!session) {
        return
      }

      const events = session.getEvents()
      let ui = 0
      let renders = 0
      let network = 0
      for (const event of events) {
        if (event.type === 'ui') ui += 1
        else if (event.type === 'render') renders += 1
        else network += 1
      }

      setTelemetry((prev) => {
        const next: Telemetry = {
          events: events.length,
          ui,
          renders,
          network,
          insights: session.getInsights().length,
        }
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      })
    }

    read()
    const id = window.setInterval(read, 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="telemetry" aria-label="Live engine telemetry">
      <div className="telemetry-head">
        <span className="telemetry-pulse" aria-hidden="true" />
        <span className="telemetry-title">Perf Engine</span>
      </div>
      <div className="telemetry-grid">
        <div className="telemetry-item">
          <span className="telemetry-value">{telemetry.events}</span>
          <span className="telemetry-label">events</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-value">{telemetry.ui}</span>
          <span className="telemetry-label">ui</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-value">{telemetry.renders}</span>
          <span className="telemetry-label">renders</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-value">{telemetry.network}</span>
          <span className="telemetry-label">network</span>
        </div>
        <div className="telemetry-item">
          <span className="telemetry-value">{telemetry.insights}</span>
          <span className="telemetry-label">insights</span>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<'All' | Message['category']>('All')
  const [messages, setMessages] = useState(seedMessages)
  const [tasks, setTasks] = useState(seedTasks)
  const [selectedId, setSelectedId] = useState(seedMessages[0]?.id ?? 1)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncTick, setSyncTick] = useState(0)

  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/') {
        return
      }
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return
      }
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useRenderTracker('App', {
    search,
    activeCategory,
    selectedId,
    drawerOpen,
    autoRefresh,
    messageCount: messages.length,
    taskCount: tasks.length,
    syncTick,
  })

  useEffect(() => {
    if (!autoRefresh) {
      return
    }

    const id = window.setInterval(() => {
      setSyncTick((value) => value + 1)
      setMessages((current) => {
        const next = [...current]
        if (next.length > 0) {
          next[0] = { ...next[0], unread: true }
        }
        return next
      })
    }, 1200)

    return () => window.clearInterval(id)
  }, [autoRefresh])

  const visibleMessages = useMemo(() => {
    const query = search.toLowerCase()
    return messages.filter((message) => {
      const matchesCategory = activeCategory === 'All' || message.category === activeCategory
      const matchesQuery =
        message.sender.toLowerCase().includes(query) ||
        message.subject.toLowerCase().includes(query) ||
        message.preview.toLowerCase().includes(query)

      return matchesCategory && matchesQuery
    })
  }, [messages, search, activeCategory])

  const effectiveSelectedId = useMemo(() => {
    if (visibleMessages.some((message) => message.id === selectedId)) {
      return selectedId
    }
    return visibleMessages[0]?.id
  }, [visibleMessages, selectedId])

  const selectedMessage =
    visibleMessages.find((message) => message.id === effectiveSelectedId) ?? visibleMessages[0]

  const unreadCount = useMemo(() => {
    let total = 0
    for (const message of messages) {
      total += message.unread ? 1 : 0
      for (let i = 0; i < 1800; i += 1) {
        Math.sqrt(i + total)
      }
    }
    return total
  }, [messages])

  const taskSummary = useMemo(() => {
    const done = tasks.filter((task) => task.done).length
    const pending = tasks.length - done
    return { done, pending }
  }, [tasks])

  const markRead = (id: number) => {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, unread: false } : message)))
  }

  const toggleStar = (id: number) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, starred: !message.starred } : message)),
    )
  }

  const addTask = () => {
    setTasks((current) => [
      ...current,
      {
        id: current.length + 1,
        title: `Follow up on ${selectedMessage?.subject ?? 'message'}`,
        done: false,
        priority: 'Normal',
      },
    ])
  }

  const toggleTask = (id: number) => {
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)))
  }

  return (
    <div className="workspace">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Northstar Workspace</p>
          <h1>Inbox</h1>
          <p className="muted">Unified view for mail, tasks, and quick follow-ups.</p>
        </div>

        <nav className="nav">
          {[
            { name: 'Inbox', badge: unreadCount },
            { name: 'Tasks', badge: taskSummary.pending },
            { name: 'Archive' },
            { name: 'Team' },
          ].map((item) => (
            <button type="button" key={item.name} className={item.name === 'Inbox' ? 'nav-item active' : 'nav-item'}>
              <span>{item.name}</span>
              {item.badge !== undefined && item.badge > 0 ? <span className="nav-badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="summary-card">
          <span className="summary-label">Unread</span>
          <strong>{unreadCount}</strong>
          <span className="muted">Updated by background sync</span>
        </div>

        <div className="summary-card subtle">
          <span className="summary-label">Tasks</span>
          <strong>{taskSummary.pending} open</strong>
          <span className="muted">{taskSummary.done} completed today</span>
        </div>

        <div className="sidebar-spacer" />
        <TelemetryBar />
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="search-shell">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mail, people, or subjects"
              aria-label="Search mail"
            />
            {search ? (
              <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setSearch('')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ) : null}
            <kbd className="search-hint">/</kbd>
          </div>

          <div className="controls">
            <button
              type="button"
              className={drawerOpen ? 'chip active' : 'chip'}
              onClick={() => setDrawerOpen((value) => !value)}
            >
              Details {drawerOpen ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className={autoRefresh ? 'chip active' : 'chip'}
              onClick={() => setAutoRefresh((value) => !value)}
            >
              Sync {autoRefresh ? 'on' : 'off'}
            </button>
          </div>
        </header>

        <section className="status-strip" aria-label="Workspace status">
          <article className="status-card">
            <span className="summary-label">Visible Messages</span>
            <strong>{visibleMessages.length}</strong>
          </article>
          <article className="status-card">
            <span className="summary-label">Unread</span>
            <strong>{unreadCount}</strong>
          </article>
          <article className="status-card">
            <span className="summary-label">Open Tasks</span>
            <strong>{taskSummary.pending}</strong>
          </article>
        </section>

        <section className="filters">
          {(['All', 'Work', 'Finance', 'Ops', 'Personal'] as const).map((category) => (
            <button
              key={category}
              type="button"
              className={category === activeCategory ? 'filter active' : 'filter'}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </section>

        <section className="mail-layout">
          <div className="mail-list panel">
            <div className="panel-header">
              <h2>Messages</h2>
              <span className="muted">{visibleMessages.length} visible</span>
            </div>

            <div className="list">
              {visibleMessages.length === 0 ? (
                <div className="empty-state">
                  <h3>No matching messages</h3>
                  <p className="muted">Try changing the search query or selecting another category filter.</p>
                </div>
              ) : (
                visibleMessages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    className={message.id === selectedMessage?.id ? 'mail-row active' : 'mail-row'}
                    onClick={() => setSelectedId(message.id)}
                  >
                    <div className="mail-row-top">
                      <div>
                        <strong>{message.sender}</strong>
                        <p>{message.subject}</p>
                      </div>
                      <div className="mail-badges">
                        {message.starred ? <span>★</span> : null}
                        {message.unread ? <span className="dot" /> : null}
                      </div>
                    </div>
                    <p className="muted">{message.preview}</p>
                    <div className="mail-row-bottom">
                      <span>{message.time}</span>
                      <span>{message.category}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {drawerOpen ? (
            <div className="detail-column">
              <section className="panel detail-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Selected</p>
                    <h2>{selectedMessage?.subject ?? 'No message selected'}</h2>
                  </div>
                  <div className="detail-actions">
                    {selectedMessage ? (
                      <>
                        <button type="button" className="chip" onClick={() => markRead(selectedMessage.id)}>
                          Mark read
                        </button>
                        <button type="button" className="chip" onClick={() => toggleStar(selectedMessage.id)}>
                          {selectedMessage.starred ? 'Unstar' : 'Star'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {selectedMessage ? (
                  <>
                    <div className="message-meta">
                      <span>{selectedMessage.sender}</span>
                      <span>{selectedMessage.time}</span>
                    </div>
                    <p className="body-copy">{selectedMessage.body}</p>
                    <p className="muted">
                      This message is surfaced in the main inbox and intentionally keeps the UI busy with category
                      changes, star toggles, and unread syncing.
                    </p>
                  </>
                ) : null}
              </section>

              <section className="panel task-panel">
                <div className="panel-header">
                  <h2>Follow-ups</h2>
                  <button type="button" className="chip" onClick={addTask}>
                    Add task
                  </button>
                </div>

                <ul className="task-list">
                  {tasks.length === 0 ? (
                    <li className="task empty">
                      <span className="muted">No follow-ups yet — add one to get going.</span>
                    </li>
                  ) : (
                    tasks.map((task) => (
                      <li key={task.id} className={task.done ? 'task done' : 'task'}>
                        <label>
                          <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                          <span>{task.title}</span>
                        </label>
                        <span className="priority">{task.priority}</span>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

export default App