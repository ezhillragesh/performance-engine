import { useState } from 'react'
import { usePerfSelector } from '../hooks/usePerfSnapshot'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

const ERROR_URL = '/api/error?delay=150'
const OVER_BUDGET_URL = '/api/slow?ms=1500'

interface RequestResult {
  url: string
  status: number | 'failed'
  ms: number
}

async function timedFetch(url: string): Promise<RequestResult> {
  const started = performance.now()
  try {
    const response = await fetch(url)
    await response.text()
    return { url, status: response.status, ms: Math.round(performance.now() - started) }
  } catch {
    return { url, status: 'failed', ms: Math.round(performance.now() - started) }
  }
}

export function RequestFailureScenario() {
  const [results, setResults] = useState<RequestResult[]>([])
  const [loading, setLoading] = useState(false)
  const failedRequests = usePerfSelector((snapshot) => snapshot.summary.failedRequests)
  const run = useScenarioRun({ issueTypes: ['budget-exceeded', 'network-blocking-render'] }, { timeoutMs: 7000 })

  const onRun = () => {
    run.begin()
    setLoading(true)
    // INTENTIONAL PROBLEM: one request fails with a 500, the other takes 1.5s
    // (over the 1000ms networkRequestMs budget).
    void Promise.all([timedFetch(ERROR_URL), timedFetch(OVER_BUDGET_URL)]).then((next) => {
      setResults(next)
      setLoading(false)
    })
  }

  return (
    <ScenarioCard
      id="request-failure"
      index={8}
      title="Failing & over-budget requests"
      issueTypes={['budget-exceeded', 'network-blocking-render']}
      description="Fires /api/error (HTTP 500) and a 1500ms request that exceeds the 1000ms network budget."
      expectation="Network budget exceeded for /api/slow, the 500 counted as a failed request in the summary, and the late render linked to the slow response."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Send requests"
      busy={loading}
    >
      <ul className="request-list">
        {results.length === 0 ? <li className="stage-caption">No requests sent yet.</li> : null}
        {results.map((result) => (
          <li key={result.url} className="request-list__row">
            <code className="truncate mono">{result.url}</code>
            <span className={`tag ${typeof result.status === 'number' && result.status < 400 ? 'tag--paid' : 'tag--overdue'}`}>
              {result.status}
            </span>
            <span className="tabular request-list__ms">{result.ms} ms</span>
          </li>
        ))}
      </ul>
      <p className="stage-caption tabular">
        Failed requests this session: <strong>{failedRequests}</strong>
      </p>
    </ScenarioCard>
  )
}
