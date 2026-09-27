import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { busyWait } from './busyWork'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const RUN_MS = 5000
const TICK_MS = 200

/** Module-level constant: the chart's props are referentially identical on every tick. */
const SERIES: readonly number[] = [12, 18, 14, 22, 19, 27, 24, 31, 28, 35, 30, 38, 34, 41, 37, 44]

function buildPath(series: readonly number[], width: number, height: number): string {
  const max = Math.max(...series)
  const min = Math.min(...series)
  const step = width / (series.length - 1)
  return series
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - min) / (max - min || 1)) * (height - 4) - 2
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * INTENTIONAL PROBLEM: ~4ms of work per render and not memoized, so it
 * re-renders on every parent tick even though its props never change.
 */
function ExpensiveChart({ series, label }: { series: readonly number[]; label: string }) {
  busyWait(4)
  const path = buildPath(series, 240, 56)
  return (
    <figure className="sparkline">
      <svg viewBox="0 0 240 56" preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <figcaption className="stage-caption">{label}</figcaption>
    </figure>
  )
}

/** Fixed: same component behind React.memo; props are stable, so ticks skip it entirely. */
const ExpensiveChartMemo = memo(ExpensiveChart)

function TickingDashboard({ running, fixed }: { running: boolean; fixed: boolean }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => setTick((value) => value + 1), TICK_MS)
    return () => window.clearInterval(interval)
  }, [running])

  return (
    <div className="ticker">
      <p className="stage-caption tabular">
        Parent tick <strong>{tick}</strong>
      </p>
      {fixed ? (
        <ExpensiveChartMemo series={SERIES} label="Weekly throughput" />
      ) : (
        <ExpensiveChart series={SERIES} label="Weekly throughput" />
      )}
    </div>
  )
}

export function WastedRendersScenario() {
  const [fixed, setFixed] = useState(false)
  const [running, setRunning] = useState(false)
  const [continuous, setContinuous] = useState(false)
  const stopTimer = useRef<number | undefined>(undefined)
  const run = useScenarioRun({ issueTypes: ['wasted-render'], components: ['ExpensiveChart'] }, { timeoutMs: 7000 })

  useEffect(() => () => window.clearTimeout(stopTimer.current), [])

  const onRun = () => {
    run.begin()
    setRunning(true)
    window.clearTimeout(stopTimer.current)
    stopTimer.current = window.setTimeout(() => setRunning(false), RUN_MS)
  }

  // Harness, not the problem under test: the card re-renders when its badge
  // changes; a memoized stage element keeps that from re-running the
  // deliberately expensive children at an arbitrary later moment.
  const stage = useMemo(() => <TickingDashboard running={running} fixed={fixed} />, [running, fixed])

  const toggleContinuous = () => {
    window.clearTimeout(stopTimer.current)
    if (continuous) {
      setContinuous(false)
      setRunning(false)
      return
    }
    run.begin()
    setContinuous(true)
    setRunning(true)
  }

  return (
    <ScenarioCard
      id="wasted-renders"
      index={6}
      title="Wasted renders"
      issueTypes={['wasted-render']}
      description="A parent ticks every 200ms; its ExpensiveChart child gets identical props but is not memoized."
      expectation="Wasted render on ExpensiveChart: many re-renders with no prop, state or context change, ~4ms each."
      fixDescription="ExpensiveChart is wrapped in React.memo with stable props, so the parent's ticks skip it."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Tick for 5s"
      busy={running && !continuous}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
      actions={
        <button type="button" className="button button--ghost" aria-pressed={continuous} onClick={toggleContinuous}>
          {continuous ? 'Stop ticking' : 'Tick continuously'}
        </button>
      }
    >
      {stage}
    </ScenarioCard>
  )
}
