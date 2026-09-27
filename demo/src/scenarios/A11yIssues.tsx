import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { A11yReport } from '../../../core/index'
import { a11yOutcome } from './detection'
import { ScenarioCard } from './ScenarioCard'

/**
 * Accessibility scenario for the DevTools "Accessibility" audit.
 *
 * INTENTIONAL ACCESSIBILITY PROBLEMS live in the default (broken) rendering (unified rule ids):
 *   - img without alt                     -> image-alt
 *   - icon-only button without a name     -> button-name
 *   - input without a label               -> label (+ label-visible: placeholder only)
 *   - duplicate ids                       -> duplicate-id
 *   - skipped heading level (h2 -> h4)    -> heading-order
 *   - "click here" link text              -> link-purpose
 *   - data table without header cells     -> table-headers
 *   - low-contrast text                   -> color-contrast (needs real layout)
 * `fixed` renders the accessible version, which must produce no errors or warnings.
 */
export default function A11yIssues({ fixed = false }: { fixed?: boolean }) {
  const uid = useId()
  return fixed ? <AccessibleVersion uid={uid} /> : <BrokenVersion />
}

const PIXEL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="48" height="48"%3E%3Crect width="48" height="48" rx="8" fill="%2334c759"/%3E%3C/svg%3E'

function SearchIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden={hidden ? 'true' : undefined} focusable="false">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

/* INTENTIONAL PROBLEMS: every element below is deliberately inaccessible. */
function BrokenVersion() {
  return (
    <section className="a11y-demo" data-variant="broken">
      <h2>Order summary</h2>
      {/* INTENTIONAL: skipped heading level (h2 -> h4). */}
      <h4>Shipping</h4>
      {/* INTENTIONAL: image without alt text. */}
      <img src={PIXEL} width={48} height={48} />
      {/* INTENTIONAL: icon-only button with no accessible name. */}
      <button type="button" className="icon-button">
        <SearchIcon hidden={false} />
      </button>
      {/* INTENTIONAL: input without any label (placeholder is not a label). */}
      <input type="text" name="coupon" placeholder="Coupon code" />
      {/* INTENTIONAL: duplicate ids. */}
      <p id="a11y-demo-note">Delivery in 3-5 days.</p>
      <p id="a11y-demo-note">Free returns.</p>
      {/* INTENTIONAL: generic link text. */}
      <p>
        To read our returns policy, <a href="#a11y-demo-policy">click here</a>.
      </p>
      {/* INTENTIONAL: text below the 4.5:1 contrast minimum (#a3a3a3 on white is about 2.5:1). */}
      <p className="a11y-demo__note" style={{ color: '#a3a3a3', background: '#ffffff', padding: '2px 6px', borderRadius: 4 }}>
        Prices include VAT.
      </p>
      {/* INTENTIONAL: data table without header cells. */}
      <table className="a11y-demo__table">
        <tbody>
          <tr>
            <td>Item</td>
            <td>Price</td>
          </tr>
          <tr>
            <td>Bike light</td>
            <td>€19</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

/* Fixed: same content, accessible markup. */
function AccessibleVersion({ uid }: { uid: string }) {
  const couponId = `${uid}-coupon`
  const headingId = `${uid}-heading`
  return (
    <section className="a11y-demo" data-variant="fixed" aria-labelledby={headingId}>
      <h2 id={headingId}>Order summary</h2>
      <h3>Shipping</h3>
      <img src={PIXEL} width={48} height={48} alt="Green delivery badge" />
      <button type="button" className="icon-button" aria-label="Search orders">
        <SearchIcon hidden />
      </button>
      <fieldset className="a11y-demo__group">
        <legend>Discount</legend>
        <label htmlFor={couponId}>Coupon code</label>
        <input id={couponId} type="text" name="coupon" autoComplete="off" />
      </fieldset>
      <p id={`${uid}-delivery`}>Delivery in 3-5 days.</p>
      <p id={`${uid}-returns`}>Free returns.</p>
      <p className="a11y-demo__note" style={{ color: '#595959', background: '#ffffff', padding: '2px 6px', borderRadius: 4 }}>
        Prices include VAT.
      </p>
      <p>
        <a href="#a11y-demo-policy">Read our returns policy</a>
      </p>
      <table className="a11y-demo__table">
        <caption>Order items</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Bike light</td>
            <td>€19</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

interface AuditResult {
  /** Variant that was audited; a result for the other variant is stale. */
  fixed: boolean
  report: A11yReport
  /** Only the fast rules have run so far; the rest of the rule set is still loading / running. */
  partial: boolean
}

/**
 * Scenario Lab card. Unlike the perf cards its expectation is not an engine
 * insight: Run audits the card's own DOM subtree with the unified accessibility
 * rule set (the same rules the DevTools Accessibility tab runs; ./a11yAudit is
 * loaded on demand), so the badge reads "N issues found" for the broken markup
 * and "No issues ✓" once fixed.
 */
export function A11yIssuesScenario() {
  const [fixed, setFixed] = useState(false)
  const [result, setResult] = useState<AuditResult | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const runSeq = useRef(0)

  // Tooling work, not the scenario under test: the audit module runs every engine detached,
  // so it is never attributed to the click's trace. Fast results show first, then the full set.
  const audit = (variant: boolean) => {
    const el = cardRef.current
    if (!el) return
    const seq = ++runSeq.current
    const show = (report: A11yReport, partial: boolean) => {
      if (seq === runSeq.current) flushSync(() => setResult({ fixed: variant, report, partial }))
    }
    import('./a11yAudit')
      .then(({ auditSubtree }) => auditSubtree(el, (report) => show(report, true)))
      .then((report) => show(report, false))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Audit failed'
        if (seq === runSeq.current) setResult((prev) => (prev ? { ...prev, partial: false, report: { ...prev.report, error: message } } : prev))
      })
  }

  const onToggleFixed = () => {
    const next = !fixed
    flushSync(() => setFixed(next))
    // Re-audit the new markup once the card has been run at least once.
    if (result) audit(next)
  }

  const outcome = result && result.fixed === fixed ? a11yOutcome(result.report, fixed, result.partial) : null

  return (
    <ScenarioCard
      id="a11y-issues"
      index={10}
      title="Accessibility issues"
      issueTypes={['a11y audit']}
      description="Missing alt text, an unnamed icon button, an unlabeled input, duplicate ids, a skipped heading level, “click here” link text, low-contrast text and a table without headers."
      expectation="Not a perf insight: open the Accessibility tab to see these findings. Run audits this card with the same rules; the badge counts the issues."
      fixDescription="Accessible markup — the audit of this card reports no issues (possible issues only a person can confirm are listed as “to review”)."
      status={outcome?.status ?? 'idle'}
      statusLabel={outcome?.label}
      match={outcome?.match ?? null}
      onRun={() => audit(fixed)}
      runLabel="Audit card"
      fixed={fixed}
      onToggleFixed={onToggleFixed}
      cardRef={cardRef}
    >
      <A11yIssues fixed={fixed} />
    </ScenarioCard>
  )
}
