import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { simulateTyping } from '../lib/simulateTyping'
import { busyWait } from './busyWork'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const SAMPLE_TEXT = 'performance budget'

/*
 * INTENTIONAL PROBLEM: each dependent panel burns ~3ms of CPU per render of
 * non-empty text (an empty field is free, so opening the Lab costs nothing).
 */

function panelWork(text: string): void {
  if (text) busyWait(3)
}

function WordCount({ text }: { text: string }) {
  panelWork(text)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return <Metric label="Words" value={words} />
}

function VowelRatio({ text }: { text: string }) {
  panelWork(text)
  const vowels = (text.match(/[aeiou]/gi) ?? []).length
  return <Metric label="Vowels" value={text.length ? `${Math.round((vowels / text.length) * 100)}%` : '—'} />
}

function LongestWord({ text }: { text: string }) {
  panelWork(text)
  const longest = text.split(/\s+/).reduce((best, word) => (word.length > best.length ? word : best), '')
  return <Metric label="Longest" value={longest || '—'} />
}

function Reversed({ text }: { text: string }) {
  panelWork(text)
  return <Metric label="Reversed" value={text.split('').reverse().join('') || '—'} />
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="mini-metric">
      <span className="mini-metric__label">{label}</span>
      <span className="mini-metric__value truncate tabular">{value}</span>
    </div>
  )
}

function Panels({ text }: { text: string }) {
  return (
    <div className="mini-metric-grid">
      <WordCount text={text} />
      <VowelRatio text={text} />
      <LongestWord text={text} />
      <Reversed text={text} />
    </div>
  )
}

/** Fixed: same panels, memoized, fed a debounced value so keystrokes render only the input. */
const DeferredPanels = memo(function DeferredPanels({ text }: { text: string }) {
  return <Panels text={text} />
})

function useDebouncedValue<T>(value: T, delayMs: number, enabled: boolean): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs, enabled])
  return debounced
}

/**
 * Memoized harness (not part of the problem): the card's own "busy" state
 * must not re-render the expensive panels, or the Run click itself would show
 * up as a render burst. Keystrokes still re-render everything below.
 */
const KeystrokeWorkbench = memo(function KeystrokeWorkbench({
  fixed,
  inputRef,
}: {
  fixed: boolean
  inputRef: RefObject<HTMLInputElement | null>
}) {
  const [text, setText] = useState('')
  const debounced = useDebouncedValue(text, 300, fixed)

  return (
    <>
      <label className="field">
        <span className="field__label">Type here</span>
        <input
          ref={inputRef}
          className="input"
          type="text"
          name="keystroke-sample"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Start typing…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {fixed ? <DeferredPanels text={debounced} /> : <Panels text={text} />}
    </>
  )
})

export function KeystrokeLoopScenario() {
  const [fixed, setFixed] = useState(false)
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const run = useScenarioRun({ issueTypes: ['keystroke-render-loop'] })

  const onRun = () => {
    const input = inputRef.current
    if (!input) return
    run.begin()
    setTyping(true)
    void simulateTyping(input, SAMPLE_TEXT, 70).then(() => setTyping(false))
  }

  return (
    <ScenarioCard
      id="keystroke-loop"
      index={2}
      title="Keystroke render loop"
      issueTypes={['keystroke-render-loop']}
      description="Every keystroke updates state that feeds four derived panels, each doing ~3ms of real CPU work."
      expectation="Keystroke render loop on the input: every keystroke re-renders Panels and its four children (~12ms of work) within 120ms."
      fixDescription="Panels are memoized and read a 300ms-debounced value, so a keystroke renders only the input."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Simulate typing"
      busy={typing}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      <KeystrokeWorkbench fixed={fixed} inputRef={inputRef} />
    </ScenarioCard>
  )
}
