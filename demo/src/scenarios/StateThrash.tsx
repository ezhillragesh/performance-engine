import { useEffect, useRef, useState } from 'react'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const THRASH_DURATION_MS = 500
const FIGHT_INTERVAL_MS = 25

type Side = 'left' | 'right'

/**
 * INTENTIONAL PROBLEM: two effects fight over `side`. Each one flips the value
 * back 25ms after the other wrote it, for as long as `active` is true —
 * ~20 renders of ThrashMeter in 500ms.
 */
function ThrashMeter({ active }: { active: boolean }) {
  const [side, setSide] = useState<Side>('left')
  const [flips, setFlips] = useState(0)

  // Effect A: "left" must become "right".
  useEffect(() => {
    if (!active || side !== 'left') return
    const timer = window.setTimeout(() => {
      setSide('right')
      setFlips((count) => count + 1)
    }, FIGHT_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [active, side])

  // Effect B: "right" must become "left".
  useEffect(() => {
    if (!active || side !== 'right') return
    const timer = window.setTimeout(() => {
      setSide('left')
      setFlips((count) => count + 1)
    }, FIGHT_INTERVAL_MS)
    return () => window.clearTimeout(timer)
  }, [active, side])

  return <MeterView side={side} caption={`${flips} flips`} />
}

/** Fixed: the displayed side is derived from a single source of truth — no competing writers. */
function ThrashMeterFixed({ active }: { active: boolean }) {
  const side: Side = active ? 'right' : 'left'
  return <MeterView side={side} caption={active ? 'Settled (derived)' : 'Idle'} />
}

function MeterView({ side, caption }: { side: Side; caption: string }) {
  return (
    <div className="thrash">
      <div className="thrash__track" data-side={side}>
        <span className="thrash__knob" />
      </div>
      <span className="stage-caption tabular">{caption}</span>
    </div>
  )
}

export function StateThrashScenario() {
  const [fixed, setFixed] = useState(false)
  const [active, setActive] = useState(false)
  const stopTimer = useRef<number | undefined>(undefined)
  const run = useScenarioRun({ issueTypes: ['state-thrashing'], components: ['ThrashMeter'] })

  useEffect(() => () => window.clearTimeout(stopTimer.current), [])

  const onRun = () => {
    run.begin()
    setActive(true)
    window.clearTimeout(stopTimer.current)
    stopTimer.current = window.setTimeout(() => setActive(false), THRASH_DURATION_MS)
  }

  return (
    <ScenarioCard
      id="state-thrash"
      index={5}
      title="State thrashing"
      issueTypes={['state-thrashing']}
      description="Two effects fight over one value via setTimeout(…, 25) for half a second after Run."
      expectation="State thrashing on ThrashMeter: ~20 renders within 500ms with ~25ms between them."
      fixDescription="The value is derived from one piece of state, so it changes exactly once per run."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Start the fight"
      busy={active}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      {fixed ? <ThrashMeterFixed active={active} /> : <ThrashMeter active={active} />}
    </ScenarioCard>
  )
}
