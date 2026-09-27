/**
 * Session summary: health score, budgets, top components / requests.
 */

import type { NetworkEvent, TrackedEvent } from "../types/events.js";
import type {
  BudgetResult,
  ComponentStat,
  Insight,
  PerformanceBudgets,
  RequestStat,
  SessionSummary,
  Severity,
} from "../types/insights.js";
import { buildAnalysisContext, type AnalysisContext } from "./context.js";
import { DEFAULT_BUDGETS, evaluateBudgets, interactionLatencySamples } from "./budgets.js";
import { isBlockingTask, renderCost } from "./interactions.js";
import { max, percentile } from "./stats.js";

const TOP_N = 10;

/** Score deductions. Insight penalties are capped so many low insights cannot zero the score. */
const BUDGET_PENALTY = { fail: 12, warn: 4 } as const;
const INSIGHT_PENALTY: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };
const MAX_INSIGHT_PENALTY = 50;

export const GOOD_SCORE = 90;
export const POOR_SCORE = 50;

export function computeScore(budgets: readonly BudgetResult[], insights: readonly Insight[]): number {
  let score = 100;
  for (const b of budgets) {
    if (b.status === "fail") score -= BUDGET_PENALTY.fail;
    else if (b.status === "warn") score -= BUDGET_PENALTY.warn;
  }
  let insightPenalty = 0;
  for (const i of insights) insightPenalty += INSIGHT_PENALTY[i.severity] ?? 0;
  score -= Math.min(MAX_INSIGHT_PENALTY, insightPenalty);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function gradeForScore(score: number): SessionSummary["grade"] {
  if (score >= GOOD_SCORE) return "good";
  if (score >= POOR_SCORE) return "needs-improvement";
  return "poor";
}

export function topComponents(context: AnalysisContext, limit = TOP_N): ComponentStat[] {
  const stats = new Map<string, ComponentStat>();
  for (const r of context.renders) {
    let s = stats.get(r.componentName);
    if (!s) {
      s = { name: r.componentName, renders: 0, mounts: 0, wasted: 0, totalMs: 0, maxMs: 0, avgMs: 0 };
      stats.set(r.componentName, s);
    }
    s.renders += 1;
    if (r.phase === "mount") s.mounts += 1;
    if (context.wastedRenderIds.has(r.eventId)) s.wasted += 1;
    // Self time: a parent's duration includes its children (see renderCost).
    const cost = renderCost(r);
    s.totalMs += cost;
    if (cost > s.maxMs) s.maxMs = cost;
  }
  const list = Array.from(stats.values());
  for (const s of list) {
    s.avgMs = Math.round((s.totalMs / s.renders) * 100) / 100;
    s.totalMs = Math.round(s.totalMs * 100) / 100;
    s.maxMs = Math.round(s.maxMs * 100) / 100;
  }
  list.sort((a, b) => b.totalMs - a.totalMs || b.renders - a.renders || (a.name < b.name ? -1 : 1));
  return list.slice(0, limit);
}

/**
 * Failed = network error or HTTP >= 400. Requests the app aborted itself
 * (AbortController, e.g. StrictMode's double effect cleanup) are not failures.
 */
export function isFailedRequest(n: NetworkEvent): boolean {
  if (n.error === "aborted") return false;
  return n.status === 0 || n.status >= 400 || n.error !== undefined;
}

export function topRequests(context: AnalysisContext, limit = TOP_N): RequestStat[] {
  const stats = new Map<string, RequestStat & { totalMs: number }>();
  for (const n of context.network) {
    const key = `${n.method} ${n.url}`;
    let s = stats.get(key);
    if (!s) {
      s = { url: n.url, method: n.method, count: 0, avgMs: 0, maxMs: 0, errors: 0, totalMs: 0 };
      stats.set(key, s);
    }
    s.count += 1;
    s.totalMs += n.duration;
    if (n.duration > s.maxMs) s.maxMs = n.duration;
    if (isFailedRequest(n)) s.errors += 1;
  }
  const list = Array.from(stats.values());
  list.sort((a, b) => b.totalMs - a.totalMs || b.count - a.count);
  return list.slice(0, limit).map(({ totalMs, ...s }) => ({
    ...s,
    avgMs: Math.round((totalMs / s.count) * 10) / 10,
    maxMs: Math.round(s.maxMs * 10) / 10,
  }));
}

/**
 * Interactions for the summary: distinct browser-measured interactions (Event Timing
 * `interactionId` > 0) when that data exists, else the number of traces. One gesture yields
 * several entries and at most one trace, so counting either raw entries or traces over-reports.
 */
export function countInteractions(context: AnalysisContext): number {
  const ids = new Set<number>();
  for (const t of context.interactionTimings) if (t.interactionId > 0) ids.add(t.interactionId);
  return ids.size > 0 ? ids.size : context.traces.length;
}

function isContext(input: readonly TrackedEvent[] | AnalysisContext): input is AnalysisContext {
  return !Array.isArray(input) && typeof input === "object" && input !== null && "traces" in input;
}

export function computeSummary(
  input: readonly TrackedEvent[] | AnalysisContext,
  insights: readonly Insight[],
  budgets: Partial<PerformanceBudgets> = DEFAULT_BUDGETS,
): SessionSummary {
  const context = isContext(input) ? input : buildAnalysisContext(input);
  const budgetResults = evaluateBudgets(context, budgets);
  const latency = interactionLatencySamples(context);

  let totalBlockingMs = 0;
  let longTasks = 0;
  for (const t of context.longTasks) {
    totalBlockingMs += t.blockingDuration;
    if (isBlockingTask(t)) longTasks += 1;
  }
  let failedRequests = 0;
  for (const n of context.network) if (isFailedRequest(n)) failedRequests += 1;

  const insightCounts: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const i of insights) insightCounts[i.severity] = (insightCounts[i.severity] ?? 0) + 1;

  const score = computeScore(budgetResults, insights);
  const p75 = percentile(latency, 75);
  const worst = max(latency);
  return {
    score,
    grade: gradeForScore(score),
    interactionP75Ms: p75 === null ? null : Math.round(p75 * 10) / 10,
    interactionMaxMs: worst === null ? null : Math.round(worst * 10) / 10,
    interactions: countInteractions(context),
    renders: context.renders.length,
    wastedRenders: context.wastedRenderIds.size,
    longTasks,
    totalBlockingMs: Math.round(totalBlockingMs * 10) / 10,
    requests: context.network.length,
    failedRequests,
    insightCounts,
    budgets: budgetResults,
    topComponents: topComponents(context),
    topRequests: topRequests(context),
  };
}
