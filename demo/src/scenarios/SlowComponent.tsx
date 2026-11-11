import { useEffect, useMemo, useState } from 'react'
import { busyWait } from './busyWork'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

/** More than twice the 16ms component budget, so a single render is enough evidence. */
const RENDER_COST_MS = 36
const DATASET = 'q3-forecast'

function computeForecast(dataset: string): string {
  busyWait(RENDER_COST_MS)
  return `${dataset}: +${(dataset.length * 1.7).toFixed(1)}%`
}

/** INTENTIONAL PROBLEM: recomputes a 36ms forecast during every render. */
function SlowWidget({ refreshes }: { refreshes: number }) {
  const forecast = computeForecast(DATASET)
  return widgetBody(forecast, refreshes)
}

/* Fix: the forecast depends only on the dataset, so it is computed once, after paint, and cached. */
const forecastCache = new Map<string, string>()

function useForecast(dataset: string): string | null {
  const [forecast, setForecast] = useState(() => forecastCache.get(dataset) ?? null)
  useEffect(() => {
    if (forecast !== null) return
    const timer = window.setTimeout(() => {
      const value = forecastCache.get(dataset) ?? computeForecast(dataset)
      forecastCache.set(dataset, value)
      setForecast(value)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [dataset, forecast])
  return forecast
}

function SlowWidgetFixed({ refreshes }: { refreshes: number }) {
  const forecast = useForecast(DATASET)
  return widgetBody(forecast ?? 'Calculating…', refreshes)
}

/** Plain helper, not a component: keeps each Run to the renders the scenario is about. */
function widgetBody(forecast: string, refreshes: number) {
  return (
    <div className="widget">
      <span className="widget__value tabular">{forecast}</span>
      <span className="stage-caption tabular">Rendered {refreshes}×</span>
    </div>
  )
}

export function SlowComponentScenario() {
  const [fixed, setFixed] = useState(false)
  const [refreshes, setRefreshes] = useState(0)
  const run = useScenarioRun({ issueTypes: ['slow-component'], components: ['SlowWidget'] })

  const onRun = () => {
    run.begin()
    setRefreshes((count) => count + 1)
  }

  // Harness, not the problem under test: the widget mounts on the first Run (opening the
  // Lab must not render it), and the memoized stage keeps badge updates from re-rendering it.
  const stage = useMemo(() => {
    if (refreshes === 0) return <p className="stage-caption">The widget renders when you press Run.</p>
    return fixed ? <SlowWidgetFixed refreshes={refreshes} /> : <SlowWidget refreshes={refreshes} />
  }, [fixed, refreshes])

  return (
    <ScenarioCard
      id="slow-component"
      index={7}
      title="Slow component"
      issueTypes={['slow-component']}
      description="SlowWidget performs a 36ms computation during render, every time it renders."
      expectation={
        __REACT_RENDER_TIMING__
          ? 'Slow component: each SlowWidget render takes ~36ms, more than twice the 16ms component budget.'
          : 'Slow component needs render durations, which React’s plain production build does not record. This build cannot show it: use npm run dev or the default (profiling) build.'
      }
      fixDescription="The forecast is computed once after paint and cached by dataset, so renders only read it and stay well under 1ms."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Render widget"
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      {stage}
    </ScenarioCard>
  )
}
