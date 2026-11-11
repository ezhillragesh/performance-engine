import { useId, useState, useTransition } from 'react'
import { busyWait, chunkedWork } from './busyWork'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

export function SlowHandlerScenario() {
  const [blockMs, setBlockMs] = useState(280)
  const [fixed, setFixed] = useState(false)
  const [completed, setCompleted] = useState(0)
  const [working, setWorking] = useState(false)
  const [isPending, startTransition] = useTransition()
  const sliderId = useId()
  const run = useScenarioRun({ issueTypes: ['interaction-render-latency', 'slow-interaction', 'long-task'] })

  const onRun = () => {
    run.begin()
    if (!fixed) {
      // INTENTIONAL PROBLEM: the click handler blocks the main thread before
      // React can render anything — input delay, a long task and a late first render.
      busyWait(blockMs)
      setCompleted((count) => count + 1)
      return
    }

    // Fix: acknowledge immediately, then do the work in small slices that
    // yield to the browser, and commit the result as a transition.
    setWorking(true)
    void chunkedWork(blockMs, 8).then(() => {
      startTransition(() => {
        setCompleted((count) => count + 1)
        setWorking(false)
      })
    })
  }

  return (
    <ScenarioCard
      id="slow-handler"
      index={3}
      title="Slow event handler"
      issueTypes={['interaction-render-latency', 'slow-interaction', 'long-task']}
      description="The click handler busy-waits before calling setState, so the next frame is delayed by the full duration."
      expectation="Interaction render latency (first render ≫ 40ms after the click), a long task, and — for real clicks — a slow interaction (INP) above the 200ms budget."
      fixDescription="Work runs in 8ms slices with scheduler.yield()/setTimeout and commits in startTransition: no long task, the button responds instantly."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Click slow handler"
      busy={working || isPending}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
      controls={
        <div className="slider-field">
          <div className="slider-field__row">
            <label htmlFor={sliderId}>Blocking time</label>
            <output htmlFor={sliderId} className="tabular" aria-label="Blocking time in milliseconds">
              {blockMs} ms
            </output>
          </div>
          <input
            id={sliderId}
            className="slider"
            type="range"
            name="blocking-time"
            min={50}
            max={600}
            step={10}
            value={blockMs}
            onChange={(event) => setBlockMs(Number(event.target.value))}
          />
        </div>
      }
    >
      <p className="stage-caption tabular">
        Completed runs: <strong>{completed}</strong>
      </p>
    </ScenarioCard>
  )
}
