import { useState } from 'react'
import { usePerfSelector } from '../hooks/usePerfSnapshot'
import { apiUrl } from '../lib/api'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

/* INTENTIONAL PROBLEM: a retired endpoint that answers HTTP 500 and a 1.5s bulk export (budget: 1000ms). */
const PROBLEM_URLS = [apiUrl('error?delay=150'), apiUrl('slow?ms=1500')]
/* Fix: the retired call is gone and the list asks for one page, which answers in ~120ms. */
const FIXED_URLS = [apiUrl('invoices?limit=8&delay=120')]

const ISSUE_TYPES = ['network-blocking-render', 'budget-exceeded'] as const

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

/** Path below the base URL, for display (`/performance-engine/api/x` -> `/api/x`). */
function displayUrl(url: string): string {
  return url.slice(import.meta.env.BASE_URL.length - 1)
}

export function RequestFailureScenario() {
  const [fixed, setFixed] = useState(false)
  const [results, setResults] = useState<RequestResult[]>([])
  const [loading, setLoading] = useState(false)
  const failedRequests = usePerfSelector((snapshot) => snapshot.summary.failedRequests)
  // Scoped to the slow request (network-blocking-render source) or the network budget
  // (budget-exceeded source), so an unrelated budget breach cannot satisfy this card.
  const run = useScenarioRun({ issueTypes: [...ISSUE_TYPES], components: ['api/slow', 'networkRequestMs'] }, { timeoutMs: 7000 })

  const onRun = () => {
    run.begin()
    setLoading(true)
    void Promise.all((fixed ? FIXED_URLS : PROBLEM_URLS).map(timedFetch)).then((next) => {
      setResults(next)
      setLoading(false)
    })
  }

  return (
    <ScenarioCard
      id="request-failure"
      index={8}
      title="Failing & over-budget requests"
      issueTypes={[...ISSUE_TYPES]}
      description="Calls a retired endpoint that answers HTTP 500, plus a 1.5s bulk export that blows the 1000ms network budget."
      expectation="Network blocking render for the 1.5s api/slow request (it explains the failed network budget, so no separate budget-exceeded insight is added). The 500 shows up as a failed request in the session summary."
      fixDescription="The retired call is removed and the list loads one 8-row page (~120ms): nothing fails, nothing exceeds the budget."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel="Send requests"
      busy={loading}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
    >
      <ul className="request-list" aria-label="Request results">
        {results.length === 0 ? <li className="stage-caption">No requests sent yet.</li> : null}
        {results.map((result) => (
          <li key={result.url} className="request-list__row">
            <code className="truncate mono">{displayUrl(result.url)}</code>
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
