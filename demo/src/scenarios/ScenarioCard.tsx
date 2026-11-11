import type { ReactNode, Ref } from 'react'
import type { ScenarioStatus } from './useScenarioRun'

interface ScenarioCardProps {
  id: string
  index: number
  title: string
  issueTypes: string[]
  description: string
  expectation: string
  status: ScenarioStatus
  match: string | null
  onRun: () => void
  /** Called when the pointer enters or focus lands on the Run button (used for prefetching). */
  onRunIntent?: () => void
  runLabel?: string
  busy?: boolean
  /** Present when the card has a "Fixed version" toggle. */
  fixed?: boolean
  onToggleFixed?: () => void
  fixDescription?: string
  controls?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** Replaces the default badge text (non-insight scenarios, e.g. the accessibility audit). */
  statusLabel?: string
  /** Ref to the card's root element (the accessibility card audits its own subtree). */
  cardRef?: Ref<HTMLElement>
}

type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger'

function describeStatus(status: ScenarioStatus, fixed: boolean): { label: string; tone: Tone } {
  switch (status) {
    case 'idle':
      return { label: 'Ready', tone: 'neutral' }
    case 'waiting':
      return { label: 'Waiting…', tone: 'progress' }
    case 'detected':
      return fixed ? { label: 'Still detected', tone: 'warning' } : { label: 'Detected', tone: 'success' }
    case 'missed':
      return fixed ? { label: 'Fixed · no insight ✓', tone: 'success' } : { label: 'Not detected', tone: 'warning' }
    case 'clean':
      return { label: 'No issues ✓', tone: 'success' }
    case 'flagged':
      return { label: 'Issue flagged', tone: 'danger' }
  }
}

/**
 * Shell shared by every scenario. Intentionally flat (no child components) so a
 * Run click re-renders as few tracked components as possible and the card
 * chrome does not pollute the scenario's own trace.
 */
export function ScenarioCard({
  id,
  index,
  title,
  issueTypes,
  description,
  expectation,
  status,
  match,
  onRun,
  onRunIntent,
  runLabel = 'Run',
  busy = false,
  fixed,
  onToggleFixed,
  fixDescription,
  controls,
  actions,
  children,
  statusLabel,
  cardRef,
}: ScenarioCardProps) {
  const described = describeStatus(status, fixed === true)
  const label = statusLabel ?? described.label
  const tone = described.tone
  const headingId = `scenario-${id}-title`

  return (
    <article ref={cardRef} className="scenario-card" aria-labelledby={headingId} data-status={status}>
      <header className="scenario-card__header">
        <span className="scenario-card__index" aria-hidden="true">
          {String(index).padStart(2, '0')}
        </span>
        <div className="scenario-card__heading">
          <h3 id={headingId} className="scenario-card__title">
            {title}
          </h3>
          <div className="chip-row">
            {issueTypes.map((type) => (
              <code key={type} className="chip chip--mono">
                {type}
              </code>
            ))}
          </div>
        </div>
        <span className={`status-badge status-badge--${tone}`} role="status" aria-live="polite" aria-atomic="true" title={match ?? undefined}>
          <span className="status-badge__dot" aria-hidden="true" />
          {label}
        </span>
      </header>

      <p className="scenario-card__description">{description}</p>

      <div className="scenario-card__expect">
        <span className="eyebrow">DevTools should show</span>
        <p>{fixed ? (fixDescription ?? 'No insight for this rule once the fix is applied.') : expectation}</p>
      </div>

      {children ? <div className="scenario-card__stage">{children}</div> : null}

      {match && status !== 'idle' ? (
        <p className="scenario-card__match" title={match}>
          {match}
        </p>
      ) : null}

      {controls ? <div className="scenario-card__controls">{controls}</div> : null}

      <footer className="scenario-card__footer">
        <button type="button" className="button button--primary" data-scenario-run={id}
          onClick={onRun}
          onPointerEnter={onRunIntent}
          onFocus={onRunIntent}
          disabled={busy}
        >
          {busy ? 'Running…' : runLabel}
        </button>
        {actions}
        {onToggleFixed ? (
          <button
            type="button"
            className="toggle"
            aria-pressed={fixed === true}
            onClick={onToggleFixed}
          >
            <span className="toggle__track" aria-hidden="true">
              <span className="toggle__thumb" />
            </span>
            <span className="toggle__label">Fixed version</span>
          </button>
        ) : null}
      </footer>
    </article>
  )
}
