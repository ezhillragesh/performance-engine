import { memo, useEffect, useMemo, useState } from 'react'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const ROWS = Array.from({ length: 24 }, (_, index) => ({ id: index, label: `Node ${index + 1}` }))

/**
 * INTENTIONAL PROBLEM: not memoized, receives the parent's `version`, and
 * copies it into local state from an effect — so every click renders each of
 * the 24 rows twice within a couple of frames (≥ 48 renders in < 160ms).
 */
function BurstRow({ label, version }: { label: string; version: number }) {
  const [synced, setSynced] = useState(0)

  useEffect(() => {
    // Effect-driven state sync (anti-pattern). Scheduled in a frame callback so
    // the second render happens right after the commit, still inside the trace.
    const frame = requestAnimationFrame(() => setSynced((count) => count + 1))
    return () => cancelAnimationFrame(frame)
  }, [version])

  return (
    <li className="burst-cell" data-hot={synced % 2 === 0 ? 'true' : undefined}>
      <span className="truncate">{label}</span>
      <span className="burst-cell__meta tabular">v{version}</span>
    </li>
  )
}

/** Fixed row: memoized, no effect-driven state, does not depend on `version`. */
const FixedBurstRow = memo(function FixedBurstRow({ label }: { label: string }) {
  return (
    <li className="burst-cell">
      <span className="truncate">{label}</span>
    </li>
  )
})

export function RenderBurstScenario() {
  const [version, setVersion] = useState(0)
  const [fixed, setFixed] = useState(false)
  const run = useScenarioRun({ issueTypes: ['interaction-induced-render-burst'] })

  const onRun = () => {
    run.begin()
    setVersion((value) => value + 1)
  }

  // Harness, not the problem under test: the card re-renders when its badge
  // changes; a memoized stage element keeps that from re-running the
  // deliberately expensive children at an arbitrary later moment.
  const stage = useMemo(
    () => (
      <>
        <p className="stage-caption tabular">Version {version}</p>
        <ul className="burst-grid" aria-label="Burst rows">
          {fixed
            ? ROWS.map((row) => <FixedBurstRow key={row.id} label={row.label} />)
            : ROWS.map((row) => <BurstRow key={row.id} label={row.label} version={version} />)}
        </ul>
      </>
    ),
    [fixed, version],
  )

  return (
    <ScenarioCard
      id="render-burst"
      index={1}
      title="Render burst"
      issueTypes={['interaction-induced-render-burst']}
      description="One click updates parent state; 24 unmemoized rows re-render and then re-render again from an effect."
      expectation="A render burst: dozens of renders from BurstRow instances within 160ms of the click, rooted at RenderBurstScenario."
      fixDescription="Rows are memoized and never sync state from effects, so a click renders only the parent — no burst."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Trigger burst"
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      {stage}
    </ScenarioCard>
  )
}
