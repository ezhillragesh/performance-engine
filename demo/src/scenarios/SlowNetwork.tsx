import { useState } from 'react'
import { fetchSlowInvoices, getCachedInvoices, PAGE_SIZE, prefetchInvoices, type Invoice } from './invoiceData'
import { InvoicePager, InvoiceSummary, InvoiceTable } from './InvoiceTable'
import { ScenarioCard } from './ScenarioCard'
import { useScenarioRun } from './useScenarioRun'

type LoadState = { kind: 'empty' } | { kind: 'loading' } | { kind: 'ready'; invoices: Invoice[] } | { kind: 'error'; message: string }

export function SlowNetworkScenario() {
  const [fixed, setFixed] = useState(false)
  const [state, setState] = useState<LoadState>({ kind: 'empty' })
  const [page, setPage] = useState(0)
  const run = useScenarioRun({ issueTypes: ['network-blocking-render'] })

  const showRows = (invoices: Invoice[]) => {
    setPage(0)
    setState({ kind: 'ready', invoices })
  }

  const onRun = () => {
    run.begin()
    if (fixed) {
      // Fix: data was prefetched on hover/focus; render from cache without waiting.
      const cached = getCachedInvoices()
      if (cached) {
        showRows(cached)
        return
      }
      setState({ kind: 'loading' })
      prefetchInvoices().then(showRows, (error: unknown) => setState({ kind: 'error', message: String(error) }))
      return
    }

    // INTENTIONAL PROBLEM: the table cannot render anything until a 900ms
    // request started by the click resolves; then it renders all at once.
    setState({ kind: 'loading' })
    fetchSlowInvoices().then(showRows, (error: unknown) => setState({ kind: 'error', message: String(error) }))
  }

  const prefetch = fixed ? () => void prefetchInvoices().catch(() => undefined) : undefined

  return (
    <ScenarioCard
      id="slow-network"
      index={4}
      title="Network-blocked render"
      issueTypes={['network-blocking-render']}
      description="Clicking fetches /api/slow?ms=900; the invoice table, summary and pager all render only when it resolves."
      expectation="Network blocking render: a > 500ms request (/api/slow) immediately followed by the InvoiceTable render chain, attributed to the click's trace."
      fixDescription="Hovering or focusing the button prefetches into a cache; the click renders cached rows instantly with no request in its trace."
      status={run.status}
      match={run.match}
      onRun={onRun}
      runLabel={fixed ? 'Load invoices (cached)' : 'Load invoices'}
      busy={state.kind === 'loading'}
      fixed={fixed}
      onToggleFixed={() => setFixed((value) => !value)}
      onRunIntent={prefetch}
    >
      <div>
        {state.kind === 'empty' ? <p className="stage-caption">No invoices loaded yet.</p> : null}
        {state.kind === 'loading' ? (
          <div className="skeleton-stack" aria-busy="true" aria-label="Loading invoices">
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--line skeleton--short" />
          </div>
        ) : null}
        {state.kind === 'error' ? <p className="stage-caption text-danger">Request failed: {state.message}</p> : null}
        {state.kind === 'ready' ? (
          <>
            <InvoiceSummary invoices={state.invoices} />
            <InvoiceTable invoices={state.invoices} page={page} />
            <InvoicePager page={page} pageCount={Math.ceil(state.invoices.length / PAGE_SIZE)} onPageChange={setPage} />
          </>
        ) : null}
      </div>
    </ScenarioCard>
  )
}
