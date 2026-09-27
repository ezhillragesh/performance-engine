import { useEffect, useRef, useState } from 'react'
import { sleep } from '../lib/simulateTyping'
import { Toggle } from '../shell/Toggle'
import { A11yIssuesScenario } from './A11yIssues'
import { setHeavyMode } from './busyWork'
import { RUN_ALL_GAP_MS, SCENARIOS } from './catalog'
import { HealthyControlScenario } from './HealthyControl'
import { KeystrokeLoopScenario } from './KeystrokeLoop'
import { RenderBurstScenario } from './RenderBurst'
import { RequestFailureScenario } from './RequestFailure'
import { SlowComponentScenario } from './SlowComponent'
import { SlowHandlerScenario } from './SlowHandler'
import { SlowNetworkScenario } from './SlowNetwork'
import { StateThrashScenario } from './StateThrash'
import { useHeavyMode } from './useHeavyMode'
import { WastedRendersScenario } from './WastedRenders'

type RunAllState = { kind: 'idle' } | { kind: 'running'; index: number } | { kind: 'done' }

function RunAllControl() {
  const [state, setState] = useState<RunAllState>({ kind: 'idle' })
  const cancelled = useRef(false)

  useEffect(
    () => () => {
      cancelled.current = true
    },
    [],
  )

  const start = async () => {
    cancelled.current = false
    for (let index = 0; index < SCENARIOS.length; index += 1) {
      if (cancelled.current) break
      const scenario = SCENARIOS[index]
      if (!scenario) continue
      setState({ kind: 'running', index })
      // Let the progress render settle so it is not part of the scenario's trace.
      await sleep(250)
      const button = document.querySelector<HTMLButtonElement>(`[data-scenario-run="${scenario.id}"]`)
      button?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      button?.click()
      await sleep(scenario.runMs + RUN_ALL_GAP_MS)
    }
    setState(cancelled.current ? { kind: 'idle' } : { kind: 'done' })
  }

  const stop = () => {
    cancelled.current = true
  }

  const running = state.kind === 'running'
  const progress = running ? (state.index + 1) / SCENARIOS.length : state.kind === 'done' ? 1 : 0
  const current = running ? SCENARIOS[state.index] : undefined

  return (
    <div className="run-all">
      <div className="run-all__actions">
        {running ? (
          <button type="button" className="button button--secondary" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="button button--primary" onClick={() => void start()}>
            Run all scenarios
          </button>
        )}
        <span className="run-all__label truncate" aria-live="polite">
          {running && current
            ? `Running ${state.index + 1} of ${SCENARIOS.length} · ${current.title}`
            : state.kind === 'done'
              ? 'All scenarios ran. Badges update as insights arrive.'
              : `${SCENARIOS.length} scenarios, ~${Math.round(
                  SCENARIOS.reduce((total, s) => total + s.runMs + RUN_ALL_GAP_MS + 250, 0) / 1000,
                )}s`}
        </span>
      </div>
      <div
        className="progress"
        role="progressbar"
        aria-label="Run all progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span className="progress__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  )
}

function HeavyModeControl() {
  const heavy = useHeavyMode()
  return (
    <Toggle
      pressed={heavy}
      onChange={() => setHeavyMode(!heavy)}
      label="Heavy workspace"
      hint="Each inbox row burns 1.5ms while rendering"
    />
  )
}

export function ScenarioLab() {
  return (
    <div className="page lab">
      <header className="page-header">
        <div className="page-header__text">
          <p className="eyebrow">Scenario Lab</p>
          <h1 className="page-title">Reproduce every rule on demand</h1>
          <p className="page-lede">
            Each card deliberately triggers one analyzer rule. Run it, then watch the badge — it turns green when the
            engine reports the matching insight. Flip “Fixed version” to see the insight disappear. The last card runs the accessibility audit on its own markup instead.
          </p>
        </div>
        <div className="lab-toolbar">
          <RunAllControl />
          <HeavyModeControl />
        </div>
      </header>

      <div className="scenario-grid">
        <RenderBurstScenario />
        <KeystrokeLoopScenario />
        <SlowHandlerScenario />
        <SlowNetworkScenario />
        <StateThrashScenario />
        <WastedRendersScenario />
        <SlowComponentScenario />
        <RequestFailureScenario />
        <HealthyControlScenario />
        <A11yIssuesScenario />
      </div>
    </div>
  )
}
