/**
 * Structured insight output produced by the analysis engine.
 */

export type Severity = "low" | "medium" | "high" | "critical";

export type IssueType =
  | "interaction-induced-render-burst"
  | "keystroke-render-loop"
  | "interaction-render-latency"
  | "network-blocking-render"
  | "state-thrashing"
  | "wasted-render"
  | "slow-interaction"
  | "long-task"
  | "slow-component"
  | "budget-exceeded";

export type InsightCategory = "rendering" | "network" | "main-thread" | "interaction" | "budget";

export interface ImpactEstimate {
  /** Estimated delay added by this issue (ms). */
  estimatedDelayMs: number;
  /** Estimated or measured total render cost (ms), if render events are involved. */
  renderCostMs?: number;
}

/**
 * One observed fact supporting an insight. Confidence is derived from the
 * evidence list, so every insight can explain *why* it was raised.
 */
export interface Evidence {
  kind: "measurement" | "correlation" | "budget" | "heuristic";
  /** Human description, e.g. "Renders within 160ms of click". */
  label: string;
  value: number | string;
  unit?: "ms" | "count" | "%";
  /** The limit the value was compared against, when applicable. */
  threshold?: number;
  /** Events that make up this evidence (for highlighting in DevTools). */
  eventIds?: string[];
  /** Contribution of this evidence to overall confidence (0–1). */
  weight: number;
}

export interface InsightMetadata {
  renderCount?: number;
  interactionType?: string;
  rootComponent?: string;
  affectedComponents?: string[];
  timeWindowStart?: number;
  timeWindowEnd?: number;
  dedupeKey?: string;
  traceId?: string;
  /** Arbitrary extra data a rule may attach. */
  [key: string]: unknown;
}

export interface Insight {
  /** Stable identity used for dedupe and DevTools selection. */
  id: string;
  issueType: IssueType;
  category: InsightCategory;
  severity: Severity;
  /** Primary component or URL that originated the issue. */
  source: string;
  /** Human-readable summary of what happened. */
  message: string;
  /** Root-cause explanation. */
  cause: string;
  /** Actionable suggestion to resolve the issue. */
  possibleFix: string;
  /** 0–1 confidence that the diagnosis is correct, derived from `evidence`. */
  confidence: number;
  impact: ImpactEstimate;
  evidence: Evidence[];
  /** Causal trace the insight was derived from, if any. */
  traceId?: string;
  metadata?: InsightMetadata;
}

// ── Budgets ──────────────────────────────────────────────────────────

export interface PerformanceBudgets {
  /** Max interaction latency (INP-style), ms. Default 200. */
  interactionLatencyMs: number;
  /** Max single main-thread task, ms. Default 50. */
  longTaskMs: number;
  /** Max single component render, ms. Default 16. */
  componentRenderMs: number;
  /** Max renders caused by one interaction. Default 25. */
  rendersPerInteraction: number;
  /** Max network request duration, ms. Default 1000. */
  networkRequestMs: number;
  /** Max share of renders that are wasted, percent. Default 30. */
  wastedRenderPct: number;
}

export type BudgetKey = keyof PerformanceBudgets;
export type BudgetStatus = "pass" | "warn" | "fail" | "no-data";

export interface BudgetResult {
  key: BudgetKey;
  label: string;
  limit: number;
  /** Worst observed value (p75 for interaction latency). */
  actual: number | null;
  unit: "ms" | "count" | "%";
  status: BudgetStatus;
  samples: number;
  /** Number of samples that exceeded the limit. */
  violations: number;
}

// ── Summaries (what the DevTools panel renders) ──────────────────────

export interface ComponentStat {
  name: string;
  renders: number;
  mounts: number;
  wasted: number;
  totalMs: number;
  maxMs: number;
  avgMs: number;
}

export interface RequestStat {
  url: string;
  method: string;
  count: number;
  avgMs: number;
  maxMs: number;
  errors: number;
}

export interface SessionSummary {
  /** 0–100 health score (100 = no budget violations or insights). */
  score: number;
  grade: "good" | "needs-improvement" | "poor";
  /** p75 of measured interaction latency (INP-like), ms. Null without data. */
  interactionP75Ms: number | null;
  /** Worst interaction latency, ms. */
  interactionMaxMs: number | null;
  interactions: number;
  renders: number;
  wastedRenders: number;
  longTasks: number;
  totalBlockingMs: number;
  requests: number;
  failedRequests: number;
  insightCounts: Record<Severity, number>;
  budgets: BudgetResult[];
  topComponents: ComponentStat[];
  topRequests: RequestStat[];
}

export type TraceSpanKind = "interaction" | "longtask" | "network" | "render" | "commit";

export interface TraceSpan {
  id: string;
  kind: TraceSpanKind;
  label: string;
  start: number;
  end: number;
  /** Span this one was caused by (forms the causal chain). */
  parentId?: string;
  eventId?: string;
  detail?: string;
}

/** A user interaction and everything it caused, ready to visualise. */
export interface TraceSummary {
  traceId: string;
  trigger: { eventType: string; target: string; label?: string; timestamp: number };
  start: number;
  end: number;
  durationMs: number;
  /** Browser-measured latency (Event Timing) when available. */
  latencyMs?: number;
  /** Name of the first `startAction()` / `trackAction()` action recorded in the trace (v0.4). */
  action?: string;
  renderCount: number;
  networkCount: number;
  longTaskMs: number;
  components: string[];
  eventIds: string[];
  insightIds: string[];
  spans: TraceSpan[];
}
