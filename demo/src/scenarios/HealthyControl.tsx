import { memo, useDeferredValue, useMemo, useRef, useState, type RefObject } from 'react'
import { simulateTyping } from '../lib/simulateTyping'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const CITIES = ['Amsterdam', 'Berlin', 'Chennai', 'Dublin', 'Helsinki', 'Kyoto', 'Lisbon', 'Montréal', 'Oslo', 'Seoul', 'Sydney', 'Zürich']

/**
 * The control group: state is local to the leaf that needs it, the derived
 * list is cheap and memoized, and the expensive-looking part reads a deferred
 * value. Expect no insight that mentions a Healthy* component.
 */
const HealthySearch = memo(function HealthySearch({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const matches = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    return needle ? CITIES.filter((city) => city.toLowerCase().includes(needle)) : CITIES
  }, [deferredQuery])

  return (
    <>
      <label className="field">
        <span className="field__label">Filter cities</span>
        <input
          ref={inputRef}
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a city…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <ul className="city-list" aria-label="Matching cities">
        {matches.map((city) => (
          <li key={city} className="chip">
            {city}
          </li>
        ))}
        {matches.length === 0 ? <li className="stage-caption">No matches</li> : null}
      </ul>
    </>
  )
})

export function HealthyControlScenario() {
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const run = useScenarioRun({ issueTypes: [], components: ['Healthy'] }, { expectNone: true, timeoutMs: 5000 })

  const onRun = () => {
    const input = inputRef.current
    if (!input) return
    run.begin()
    setTyping(true)
    void simulateTyping(input, 'lisbon', 160).then(() => setTyping(false))
  }

  return (
    <ScenarioCard
      id="healthy"
      index={9}
      title="Healthy control"
      issueTypes={['none expected']}
      description="Local state, memoized siblings and a deferred filter — the way the other scenarios look once fixed."
      expectation="Nothing. After 5 seconds the badge reads “No issues ✓”; any insight naming a Healthy* component turns it red."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Simulate typing"
      busy={typing}
    >
      <HealthySearch inputRef={inputRef} />
    </ScenarioCard>
  )
}
