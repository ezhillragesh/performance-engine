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
  | "wasted-render";

export interface ImpactEstimate {
  /** Estimated delay added by this issue (ms). */
  estimatedDelayMs: number;
  /** Estimated total render cost (ms), if render events are involved. */
  renderCostMs?: number;
}

export interface InsightMetadata {
  renderCount?: number;
  interactionType?: string;
  rootComponent?: string;
  affectedComponents?: string[];
  timeWindowStart?: number;
  timeWindowEnd?: number;
  dedupeKey?: string;
  /** Arbitrary extra data a rule may attach. */
  [key: string]: unknown;
}

export interface Insight {
  issueType: IssueType;
  severity: Severity;
  /** Primary component or URL that originated the issue. */
  source: string;
  /** Human-readable summary of what happened. */
  message: string;
  /** Root-cause explanation. */
  cause: string;
  /** Actionable suggestion to resolve the issue. */
  possibleFix: string;
  /** 0–1 confidence that the diagnosis is correct. */
  confidence: number;
  impact: ImpactEstimate;
  metadata?: InsightMetadata;
}
