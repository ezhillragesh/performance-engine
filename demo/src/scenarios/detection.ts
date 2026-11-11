import type { A11yReport, Insight, IssueType } from '../../../core/index'
import type { ScenarioStatus } from './useScenarioRun'

export interface Expectation {
  /** Insight types this scenario is designed to produce. Empty = "any type" (used by the healthy control). */
  issueTypes: IssueType[]
  /**
   * Optional component-name fragments. When set, an insight only counts if its
   * source / root / affected components mention one of them. Used for
   * component-scoped rules so another scenario cannot satisfy this card.
   */
  components?: string[]
}

export interface RunMarker {
  id: number
  /** `performance.now()` when the run started (same clock as insight windows). */
  startedAt: number
  /** Insight ids that already existed when the run started. */
  baseline: ReadonlySet<string>
}

function mentionsComponent(insight: Insight, names: string[]): boolean {
  const meta = insight.metadata
  const haystack: string[] = [insight.source]
  if (typeof meta?.rootComponent === 'string') haystack.push(meta.rootComponent)
  if (Array.isArray(meta?.affectedComponents)) haystack.push(...meta.affectedComponents)
  return names.some((name) => haystack.some((value) => value.includes(name)))
}

/** True when `insight` was produced by activity after the run started. */
function isAfterRun(insight: Insight, run: RunMarker): boolean {
  const meta = insight.metadata
  const windowEnd = meta?.timeWindowEnd ?? meta?.timeWindowStart
  if (typeof windowEnd === 'number') return windowEnd >= run.startedAt
  return !run.baseline.has(insight.id)
}

export function matchesExpectation(insight: Insight, expectation: Expectation, run: RunMarker): boolean {
  if (expectation.issueTypes.length > 0 && !expectation.issueTypes.includes(insight.issueType)) return false
  if (expectation.components && !mentionsComponent(insight, expectation.components)) return false
  return isAfterRun(insight, run)
}

/**
 * Returns a label for the earliest matching insight, or null. Strings keep
 * selector results primitive.
 *
 * The label must be stable across analysis ticks: messages of aggregate
 * insights (slow-component, wasted-render…) change as counts grow, and a
 * changing selector result re-renders the scenario card — which, for cards
 * whose stage holds the deliberately slow component, re-runs that slow render
 * on every tick and pollutes whatever the user does next.
 */
export function findMatch(insights: Insight[], expectation: Expectation, run: RunMarker | null): string | null {
  if (!run) return null
  let hit: Insight | undefined
  let hitStart = Infinity
  for (const insight of insights) {
    if (!matchesExpectation(insight, expectation, run)) continue
    const start = insight.metadata?.timeWindowStart ?? Infinity
    if (!hit || start < hitStart) {
      hit = insight
      hitStart = start
    }
  }
  return hit ? `${hit.issueType} · ${hit.source}` : null
}

// ── Non-insight scenarios (catalog `detect: 'a11y'`) ─────────────────

export interface A11yOutcome {
  status: ScenarioStatus
  /** Badge text: "N issues found" / "No issues ✓". */
  label: string
  /** Rule ids that fired (most severe first), shown under the stage. */
  match: string | null
}

/**
 * Badge for the accessibility card. Its expectation is not a perf insight but
 * the audit result of the card's own DOM: the broken version must report
 * issues (errors or warnings), the fixed one none. "Needs review" items are
 * possible issues a person must confirm; they are listed, not counted.
 */
export function a11yOutcome(report: A11yReport, fixed: boolean, partial = false): A11yOutcome {
  if (report.error) return { status: 'missed', label: 'Audit failed', match: report.error }
  const issues = report.findings.filter((finding) => finding.kind !== 'review')
  const reviews = report.findings.length - issues.length
  const reviewNote = reviews ? `${reviews} ${reviews === 1 ? 'item' : 'items'} to review manually` : null
  if (partial && issues.length === 0) return { status: 'waiting', label: 'Scanning…', match: null }
  if (issues.length === 0) return { status: fixed ? 'clean' : 'missed', label: 'No issues ✓', match: reviewNote }
  const rules = [...new Set(issues.map((finding) => finding.ruleId))]
  const shown = rules.slice(0, 4).join(', ')
  return {
    status: 'detected',
    label: `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} found${partial ? '…' : ''}`,
    match: rules.length > 4 ? `${shown} +${rules.length - 4} more` : shown,
  }
}
