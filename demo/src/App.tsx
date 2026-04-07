import { useEffect, useMemo, useState } from 'react'
import { trackRender } from '../../core/index'
import './App.css'

type Product = {
  id: number
  name: string
  category: string
  price: number
  score: number
}

const initialProducts: Product[] = Array.from({ length: 48 }, (_, index) => {
  const categories = ['Analytics', 'Checkout', 'Search', 'Profile', 'Feed']
  return {
    id: index + 1,
    name: `Module ${index + 1}`,
    category: categories[index % categories.length],
    price: 40 + (index % 7) * 12,
    score: Math.round(50 + ((index * 13) % 50)),
  }
})

const initialEvents = Array.from({ length: 14 }, (_, index) => ({
  id: index + 1,
  title: `Interaction #${index + 1}`,
  detail: 'Click triggered data refresh and component updates.',
}))

function App() {
  trackRender('App')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [count, setCount] = useState(0)
  const [pulse, setPulse] = useState(0)
  const [autoPulse, setAutoPulse] = useState(true)
  const [events, setEvents] = useState(initialEvents)
  const [loading, setLoading] = useState(false)
  const [burstSeed, setBurstSeed] = useState(0)

  useEffect(() => {
    if (!autoPulse) {
      return
    }

    const id = window.setInterval(() => {
      setPulse((value) => value + 1)
    }, 450)

    return () => window.clearInterval(id)
  }, [autoPulse])

  const filtered = initialProducts.filter((product) => {
    const matchesText = product.name.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = filter === 'All' || product.category === filter
    return matchesText && matchesCategory
  })

  const expensiveScore = filtered.reduce((total, product) => {
    let jitter = 0
    for (let i = 0; i < 2500; i += 1) {
      jitter += Math.sin(i + product.score)
    }
    return total + product.score + jitter
  }, 0)

  const totalImpact = useMemo(() => {
    return Math.round(expensiveScore * 1.3)
  }, [expensiveScore])

  const triggerBurst = () => {
    for (let i = 0; i < 8; i += 1) {
      setBurstSeed((value) => value + 1)
    }
  }

  const simulateSlowNetwork = async () => {
    setLoading(true)
    const start = performance.now()

    try {
      await fetch('https://httpstat.us/200?sleep=1200')
      const duration = Math.round(performance.now() - start)
      setEvents((prev) => [
        {
          id: prev.length + 1,
          title: 'Slow network response',
          detail: `Response arrived after ${duration}ms.`,
        },
        ...prev,
      ])
    } catch (error) {
      setEvents((prev) => [
        {
          id: prev.length + 1,
          title: 'Network error',
          detail: 'Failed to reach the demo endpoint.',
        },
        ...prev,
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleCountClick = () => {
    const start = performance.now()
    while (performance.now() - start < 14) {
      // Intentional sync work to create interaction latency.
    }
    setCount((value) => value + 1)
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Frontend Performance Intelligence</p>
          <h1>Observability Lab</h1>
          <p className="subtitle">
            Stress the engine with intentional render bursts, noisy inputs, and
            slow networks.
          </p>
        </div>
        <div className="hero-card">
          <div>
            <p className="label">UI Pulse</p>
            <h2>{pulse}</h2>
            <p className="muted">Auto pulse updates the entire tree.</p>
          </div>
          <button
            className={autoPulse ? 'toggle active' : 'toggle'}
            onClick={() => setAutoPulse((value) => !value)}
          >
            {autoPulse ? 'Pause pulse' : 'Resume pulse'}
          </button>
        </div>
      </header>

      <section className="grid">
        <SearchPanel
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          onBurst={triggerBurst}
          burstSeed={burstSeed}
        />
        <MetricsPanel
          count={count}
          onCount={handleCountClick}
          totalImpact={totalImpact}
        />
        <NetworkPanel loading={loading} onSlowFetch={simulateSlowNetwork} />
        <ActivityPanel events={events} />
      </section>

      <ResultsList
        items={filtered}
        pulse={pulse}
        search={search}
        filter={filter}
      />
    </div>
  )
}

type SearchPanelProps = {
  search: string
  filter: string
  onSearch: (value: string) => void
  onFilter: (value: string) => void
  onBurst: () => void
  burstSeed: number
}

function SearchPanel({
  search,
  filter,
  onSearch,
  onFilter,
  onBurst,
  burstSeed,
}: SearchPanelProps) {
  trackRender('SearchPanel')
  const categories = ['All', 'Analytics', 'Checkout', 'Search', 'Profile', 'Feed']

  return (
    <div className="panel">
      <h3>Interaction Playground</h3>
      <p className="muted">
        Typing below re-renders multiple panels. It is intentionally unoptimized
        to trigger render bursts.
      </p>
      <label className="field">
        <span>Search modules</span>
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Type fast to trigger re-renders"
        />
      </label>
      <label className="field">
        <span>Filter category</span>
        <select value={filter} onChange={(event) => onFilter(event.target.value)}>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <button className="action" onClick={onBurst}>
        Trigger render burst ({burstSeed})
      </button>
    </div>
  )
}

type MetricsPanelProps = {
  count: number
  totalImpact: number
  onCount: () => void
}

function MetricsPanel({ count, totalImpact, onCount }: MetricsPanelProps) {
  trackRender('MetricsPanel')
  const cards = [
    { label: 'Interaction Count', value: count },
    { label: 'Impact Score', value: totalImpact },
    { label: 'Layout Shifts', value: 18 + (count % 7) },
  ]

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Live Metrics</h3>
        <button className="ghost" onClick={onCount}>
          Add interaction
        </button>
      </div>
      <div className="card-grid">
        {cards.map((card) => (
          <div className="metric" key={card.label}>
            <p className="label">{card.label}</p>
            <h2>{card.value}</h2>
          </div>
        ))}
      </div>
    </div>
  )
}

type NetworkPanelProps = {
  loading: boolean
  onSlowFetch: () => void
}

function NetworkPanel({ loading, onSlowFetch }: NetworkPanelProps) {
  trackRender('NetworkPanel')
  return (
    <div className="panel">
      <h3>Network Stress</h3>
      <p className="muted">
        This button calls a slow endpoint so the engine can correlate a slow
        network response with UI updates.
      </p>
      <button className="action" onClick={onSlowFetch} disabled={loading}>
        {loading ? 'Fetching...' : 'Trigger slow request'}
      </button>
    </div>
  )
}

type ActivityPanelProps = {
  events: { id: number; title: string; detail: string }[]
}

function ActivityPanel({ events }: ActivityPanelProps) {
  trackRender('ActivityPanel')
  return (
    <div className="panel">
      <h3>Activity Feed</h3>
      <ul className="feed">
        {events.slice(0, 6).map((event) => (
          <li key={event.id}>
            <strong>{event.title}</strong>
            <span>{event.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type ResultsListProps = {
  items: Product[]
  pulse: number
  search: string
  filter: string
}

function ResultsList({ items, pulse, search, filter }: ResultsListProps) {
  trackRender('ResultsList')
  return (
    <section className="results">
      <div className="results-header">
        <div>
          <h2>Modules</h2>
          <p className="muted">
            {items.length} items • filter: {filter} • query: {search || 'all'}
          </p>
        </div>
        <div className="pulse-chip">Pulse {pulse}</div>
      </div>
      <div className="results-grid">
        {items.map((item) => (
          <div key={item.id} className="tile">
            <p className="label">{item.category}</p>
            <h3>{item.name}</h3>
            <p className="muted">Priority score {item.score}</p>
            <div className="tile-footer">
              <span>${item.price}</span>
              <button className="ghost">Inspect</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default App
