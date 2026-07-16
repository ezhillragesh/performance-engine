import { useEffect, useMemo, useState } from 'react'
import { trackRender } from '../../core/index'
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

function App() {
  trackRender('App')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<'All' | Message['category']>('All')
  const [messages, setMessages] = useState(seedMessages)
  const [tasks, setTasks] = useState(seedTasks)
  const [selectedId, setSelectedId] = useState(seedMessages[0]?.id ?? 1)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [syncTick, setSyncTick] = useState(0)

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

  useEffect(() => {
    if (visibleMessages.length === 0) {
      return
    }

    const selectionStillVisible = visibleMessages.some((message) => message.id === selectedId)
    if (!selectionStillVisible) {
      setSelectedId(visibleMessages[0].id)
    }
  }, [visibleMessages, selectedId])

  const selectedMessage = visibleMessages.find((message) => message.id === selectedId) ?? visibleMessages[0]

  const unreadCount = useMemo(() => {
    let total = 0
    for (const message of messages) {
      total += message.unread ? 1 : 0
      for (let i = 0; i < 1800; i += 1) {
        Math.sqrt(i + total)
      }
    }
    return total
  }, [messages, syncTick])

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
          {['Inbox', 'Tasks', 'Archive', 'Team'].map((item) => (
            <button type="button" key={item} className={item === 'Inbox' ? 'nav-item active' : 'nav-item'}>
              {item}
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
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="search-shell">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search mail, people, or subjects"
              aria-label="Search mail"
            />
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
                  {tasks.map((task) => (
                    <li key={task.id} className={task.done ? 'task done' : 'task'}>
                      <label>
                        <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                        <span>{task.title}</span>
                      </label>
                      <span className="priority">{task.priority}</span>
                    </li>
                  ))}
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