/**
 * Shared rule infrastructure: rule contract, evidence-derived confidence,
 * magnitude-derived severity, stable ids.
 */

import type { RenderEvent } from "../../types/events.js";
import type {
  Evidence,
  ImpactEstimate,
  Insight,
  InsightCategory,
  InsightMetadata,
  IssueType,
  PerformanceBudgets,
  Severity,
} from "../../types/insights.js";
import type { AnalysisContext, InteractionTrace, RenderChain } from "../context.js";
import { renderCost } from "../interactions.js";

export interface RuleOptions {
  budgets: PerformanceBudgets;
  interactionWindowMs: number;
  /** Insights produced by rules that ran earlier in this analysis pass. */
  priorInsights: readonly Insight[];
}

export interface AnalysisRule {
  name: string;
  run(context: AnalysisContext, options: RuleOptions): Insight[];
}

// ── Confidence ───────────────────────────────────────────────────────

export const MAX_CONFIDENCE = 0.98;

/** Noisy-OR of evidence weights: 1 − Π(1 − wᵢ), capped at 0.98. */
export function confidenceFromEvidence(evidence: readonly Evidence[]): number {
  let miss = 1;
  for (const e of evidence) {
    const w = Math.max(0, Math.min(1, e.weight));
    miss *= 1 - w;
  }
  return Math.round(Math.min(MAX_CONFIDENCE, 1 - miss) * 100) / 100;
}

/** Weight that grows with how far `value` exceeds `threshold`: base at 1×, `cap` at `fullAt`×. */
export function scaledWeight(value: number, threshold: number, base: number, cap: number, fullAt = 3): number {
  if (threshold <= 0) return cap;
  const ratio = value / threshold;
  if (ratio <= 1) return base;
  const t = Math.min(1, (ratio - 1) / Math.max(0.0001, fullAt - 1));
  return Math.round((base + (cap - base) * t) * 100) / 100;
}

// ── Severity ─────────────────────────────────────────────────────────

export const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** INP-style latency bands: <100 low, <200 medium, <500 high, ≥500 critical. */
export function severityFromLatency(ms: number): Severity {
  if (ms >= 500) return "critical";
  if (ms >= 200) return "high";
  if (ms >= 100) return "medium";
  return "low";
}

/** Count relative to a threshold: <1.5× medium... scaled; below threshold low. */
export function severityFromRatio(value: number, threshold: number): Severity {
  if (threshold <= 0) return "medium";
  const ratio = value / threshold;
  if (ratio >= 4) return "critical";
  if (ratio >= 2) return "high";
  if (ratio >= 1) return "medium";
  return "low";
}

// ── Builders ─────────────────────────────────────────────────────────

export function buildInsightId(issueType: IssueType, source: string, anchor: string): string {
  return `${issueType}|${source}|${anchor}`;
}

export function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

export interface InsightDraft {
  issueType: IssueType;
  category: InsightCategory;
  severity: Severity;
  source: string;
  /** Stable anchor: trace trigger eventId or first evidence eventId. */
  anchor: string;
  message: string;
  cause: string;
  possibleFix: string;
  evidence: Evidence[];
  /** Measured delay (ms). */
  delayMs: number;
  renderCostMs?: number;
  /** True when durations were unknown and the impact is an estimate. */
  impactEstimated?: boolean;
  traceId?: string;
  metadata?: InsightMetadata;
}

export function createInsight(draft: InsightDraft): Insight {
  const impact: ImpactEstimate = { estimatedDelayMs: Math.max(0, Math.round(draft.delayMs)) };
  if (draft.renderCostMs !== undefined) impact.renderCostMs = roundMs(draft.renderCostMs);
  const metadata: InsightMetadata = { ...draft.metadata };
  if (draft.traceId !== undefined) metadata.traceId = draft.traceId;
  if (draft.impactEstimated) metadata.impactEstimated = true;
  const id = buildInsightId(draft.issueType, draft.source, draft.anchor);
  metadata.dedupeKey = id;
  const insight: Insight = {
    id,
    issueType: draft.issueType,
    category: draft.category,
    severity: draft.severity,
    source: draft.source,
    message: draft.message,
    cause: draft.cause,
    possibleFix: draft.possibleFix,
    confidence: confidenceFromEvidence(draft.evidence),
    impact,
    evidence: draft.evidence,
    metadata,
  };
  if (draft.traceId !== undefined) insight.traceId = draft.traceId;
  return insight;
}

/** Correlation evidence for trace membership; causal traces are much stronger. */
export function traceEvidence(trace: InteractionTrace, eventIds: string[]): Evidence {
  return trace.causal
    ? {
        kind: "correlation",
        label: `Causally attributed to ${trace.committedTrigger.eventType} on ${trace.committedTrigger.target}`,
        value: "trace",
        eventIds: [trace.trigger.eventId, ...eventIds.slice(0, 50)],
        weight: 0.5,
      }
    : {
        kind: "heuristic",
        label: `Within the time window after ${trace.committedTrigger.eventType} on ${trace.committedTrigger.target}`,
        value: "time-window",
        eventIds: [trace.trigger.eventId, ...eventIds.slice(0, 50)],
        weight: 0.2,
      };
}

export function traceTriggerText(trace: InteractionTrace): string {
  const t = trace.committedTrigger;
  return `${t.eventType} on ${t.label ? `"${t.label}" (${t.target})` : t.target}`;
}

/**
 * Total measured render time without double counting nested components
 * (sums self times, see `renderCost`); `known` false when every duration is 0.
 */
export function renderTime(renders: readonly RenderEvent[]): { totalMs: number; known: boolean } {
  let total = 0;
  let known = false;
  for (const r of renders) {
    if (r.durationMs > 0) known = true;
    total += renderCost(r);
  }
  return { totalMs: total, known };
}

/** Component with the most renders; ties broken by name for determinism. */
export function topComponent(renders: readonly RenderEvent[]): { name: string; count: number; distinct: number } {
  const counts = new Map<string, number>();
  for (const r of renders) counts.set(r.componentName, (counts.get(r.componentName) ?? 0) + 1);
  let name = "unknown";
  let count = 0;
  for (const [n, c] of counts) {
    if (c > count || (c === count && n < name)) {
      name = n;
      count = c;
    }
  }
  return { name, count, distinct: counts.size };
}

/**
 * Root of a render cascade: the earliest render whose parent did not render
 * in the same set (falls back to the first render).
 */
export function cascadeRoot(renders: readonly RenderEvent[]): string {
  if (renders.length === 0) return "unknown";
  const names = new Set(renders.map((r) => r.componentName));
  for (const r of renders) {
    if (!r.parentComponent || !names.has(r.parentComponent)) return r.componentName;
  }
  return renders[0]!.componentName;
}

export function affectedComponents(renders: readonly RenderEvent[], root: string, limit = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>([root]);
  for (const r of renders) {
    if (seen.has(r.componentName)) continue;
    seen.add(r.componentName);
    out.push(r.componentName);
    if (out.length >= limit) break;
  }
  return out;
}

export function chainRoot(chains: readonly RenderChain[], start: number, end: number): RenderChain | null {
  let best: RenderChain | null = null;
  let bestScore = 0;
  for (const chain of chains) {
    const overlap = Math.min(chain.end, end) - Math.max(chain.start, start);
    if (overlap < 0) continue;
    const score = chain.renders.length + chain.totalDurationMs;
    if (!best || score > bestScore) {
      best = chain;
      bestScore = score;
    }
  }
  return best;
}

/** Max number of items within any `windowMs` sliding window (sorted by timestamp). */
export function maxBurst<T extends { timestamp: number }>(items: readonly T[], windowMs: number): { count: number; startIdx: number; endIdx: number } {
  let best = { count: 0, startIdx: 0, endIdx: -1 };
  let left = 0;
  for (let right = 0; right < items.length; right += 1) {
    while (items[right]!.timestamp - items[left]!.timestamp > windowMs) left += 1;
    const count = right - left + 1;
    if (count > best.count) best = { count, startIdx: left, endIdx: right };
  }
  return best;
}

export function ids(events: readonly { eventId: string }[], limit = 50): string[] {
  const out: string[] = [];
  for (const e of events) {
    out.push(e.eventId);
    if (out.length >= limit) break;
  }
  return out;
}
