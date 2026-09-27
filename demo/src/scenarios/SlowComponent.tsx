import { useMemo, useState } from 'react'
import { busyWait } from './busyWork'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const RENDER_COST_MS = 30
const DATASET = 'q3-forecast'

function computeForecast(dataset: string): string {
  // INTENTIONAL PROBLEM (when called during every render): 30ms of CPU work.
  busyWait(RENDER_COST_MS)
  return `${dataset}: +${(dataset.length * 1.7).toFixed(1)}%`
}

/** INTENTIONAL PROBLEM: recomputes a 30ms forecast on every render. */
function SlowWidget({ refreshes }: { refreshes: number }) {
  const forecast = computeForecast(DATASET)
  return <WidgetBody forecast={forecast} refreshes={refreshes} />
}

/** Fixed: the expensive value depends only on the dataset, so it is memoized. */
function SlowWidgetFixed({ refreshes }: { refreshes: number }) {
  const forecast = useMemo(() => computeForecast(DATASET), [])
  return <WidgetBody forecast={forecast} refreshes={refreshes} />
}

function WidgetBody({ forecast, refreshes }: { forecast: string; refreshes: number }) {
  return (
    <div className="widget">
      <span className="widget__value tabular">{forecast}</span>
      <span className="stage-caption tabular">Refreshed {refreshes}×</span>
    </div>
  )
}

export function SlowComponentScenario() {
  const [fixed, setFixed] = useState(false)
  const [refreshes, setRefreshes] = useState(0)
  const run = useScenarioRun({ issueTypes: ['slow-component'], components: ['SlowWidget', 'SlowComponent'] })

  const onRun = () => {
    run.begin()
    setRefreshes((count) => count + 1)
  }

  // Harness, not the problem under test: the card re-renders when its badge
  // changes; a memoized stage element keeps that from re-running the
  // deliberately expensive children at an arbitrary later moment.
  const stage = useMemo(
    () => (fixed ? <SlowWidgetFixed refreshes={refreshes} /> : <SlowWidget refreshes={refreshes} />),
    [fixed, refreshes],
  )

  return (
    <ScenarioCard
      id="slow-component"
      index={7}
      title="Slow component"
      issueTypes={['slow-component']}
      description="SlowWidget performs a 30ms computation during render, every time it re-renders."
      expectation="Slow component: SlowWidget renders take ~30ms, above the 16ms component budget. Requires a development build (real render durations)."
      fixDescription="The computation is memoized on its only input, so re-renders take well under 1ms."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Re-render widget"
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      {stage}
    </ScenarioCard>
  )
}
