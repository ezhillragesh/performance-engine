import { useCallback, useEffect, useState } from 'react'
import { getLatestSnapshot, usePerfSelector } from '../hooks/usePerfSnapshot'
import { findMatch, type Expectation, type RunMarker } from './detection'

export type ScenarioStatus =
  | 'idle'
  | 'waiting'
  | 'detected' // expected insight appeared after the run started
  | 'missed' // timed out without the expected insight
  | 'clean' // healthy control: no insight within the timeout
  | 'flagged' // healthy control: an insight mentioned it

export interface ScenarioRunState {
  status: ScenarioStatus
  /** Message of the matching insight, if any. */
  match: string | null
  /** Marks the start of a run; call at the very beginning of the Run handler. */
  begin: () => void
}

interface Options {
  timeoutMs?: number
  /** Healthy control: success means *no* matching insight. */
  expectNone?: boolean
}

let nextRunId = 1

export function useScenarioRun(expectation: Expectation, options: Options = {}): ScenarioRunState {
  const { timeoutMs = 6000, expectNone = false } = options
  const [run, setRun] = useState<RunMarker | null>(null)
  const [expiredRunId, setExpiredRunId] = useState(0)

  // Selecting a string (or null) keeps re-renders to actual status changes.
  const match = usePerfSelector((snapshot) => findMatch(snapshot.insights, expectation, run))

  // Once matched the outcome is final: skip the timeout so it does not cause
  // one more (possibly expensive) render of the card later on.
  const settled = match !== null
  useEffect(() => {
    if (!run || settled) return
    const timer = window.setTimeout(() => setExpiredRunId(run.id), timeoutMs)
    return () => window.clearTimeout(timer)
  }, [run, timeoutMs, settled])

  const begin = useCallback(() => {
    const id = nextRunId
    nextRunId += 1
    setRun({
      id,
      startedAt: performance.now(),
      baseline: new Set(getLatestSnapshot().insights.map((insight) => insight.id)),
    })
  }, [])

  let status: ScenarioStatus = 'idle'
  if (run) {
    const expired = expiredRunId === run.id
    if (expectNone) status = match ? 'flagged' : expired ? 'clean' : 'waiting'
    else status = match ? 'detected' : expired ? 'missed' : 'waiting'
  }

  return { status, match, begin }
}
