/**
 * Performance budgets: limits evaluated against measured data.
 */

import type { BudgetKey, BudgetResult, BudgetStatus, PerformanceBudgets } from "../types/insights.js";
import type { AnalysisContext } from "./context.js";
import { collapseRendersPerCommit, isActionTrace } from "./context.js";
import { firstCommitAfterInput, groupInteractionTimings, inputStart, renderCost, taskLengthMs } from "./interactions.js";
import { max, percentile } from "./stats.js";

export const DEFAULT_BUDGETS: Readonly<PerformanceBudgets> = Object.freeze({
  interactionLatencyMs: 200,
  longTaskMs: 50,
  componentRenderMs: 16,
  rendersPerInteraction: 25,
  networkRequestMs: 1000,
  wastedRenderPct: 30,
});

/** Share of the limit at which a budget turns from pass to warn. */
export const BUDGET_WARN_RATIO = 0.8;

const LABELS: Record<BudgetKey, string> = {
  interactionLatencyMs: "Interaction latency (p75)",
  longTaskMs: "Longest main-thread task",
  componentRenderMs: "Slowest component render",
  rendersPerInteraction: "Renders per interaction",
  networkRequestMs: "Slowest network request",
  wastedRenderPct: "Wasted renders",
};

const UNITS: Record<BudgetKey, BudgetResult["unit"]> = {
  interactionLatencyMs: "ms",
  longTaskMs: "ms",
  componentRenderMs: "ms",
  rendersPerInteraction: "count",
  networkRequestMs: "ms",
  wastedRenderPct: "%",
};

export const BUDGET_KEYS: readonly BudgetKey[] = [
  "interactionLatencyMs",
  "longTaskMs",
  "componentRenderMs",
  "rendersPerInteraction",
  "networkRequestMs",
  "wastedRenderPct",
];

/** Minimum update renders before the wasted-render share is evaluated. */
export const MIN_WASTED_SAMPLES = 20;

/** Merges partial budgets over defaults, ignoring non-finite / negative values. */
export function resolveBudgets(
  partial?: Partial<PerformanceBudgets> | null,
  base: PerformanceBudgets = DEFAULT_BUDGETS,
): PerformanceBudgets {
  const out: PerformanceBudgets = { ...base };
  if (!partial) return out;
  for (const key of BUDGET_KEYS) {
    const value = partial[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export function budgetStatus(actual: number | null, limit: number): BudgetStatus {
  if (actual === null) return "no-data";
  if (actual > limit) return "fail";
  if (actual >= limit * BUDGET_WARN_RATIO) return "warn";
  return "pass";
}

function result(key: BudgetKey, limit: number, samples: readonly number[], actual: number | null): BudgetResult {
  let violations = 0;
  for (const s of samples) if (s > limit) violations += 1;
  const rounded = actual === null ? null : Math.round(actual * 10) / 10;
  return {
    key,
    label: LABELS[key],
    limit,
    actual: rounded,
    unit: UNITS[key],
    status: budgetStatus(rounded, limit),
    samples: samples.length,
    violations,
  };
}

/** Interaction latency samples: Event Timing when available, else first-commit latency per trace. */
export function interactionLatencySamples(context: AnalysisContext): number[] {
  const timings = groupInteractionTimings(context.interactionTimings);
  if (timings.length > 0) return timings.map((t) => t.duration);
  const samples: number[] = [];
  for (const trace of context.traces) {
    if (isActionTrace(trace)) continue; // programmatic, not an input
    const commit = firstCommitAfterInput(trace);
    if (commit) samples.push(Math.max(0, commit.timestamp - inputStart(trace)));
  }
  return samples;
}

export function evaluateBudgets(
  context: AnalysisContext,
  budgets: Partial<PerformanceBudgets> = DEFAULT_BUDGETS,
): BudgetResult[] {
  const b = resolveBudgets(budgets);

  const latency = interactionLatencySamples(context);
  const longTasks = context.longTasks.map(taskLengthMs).filter((ms) => ms > 0);
  const renderCosts: number[] = [];
  for (const r of context.renders) {
    const cost = renderCost(r);
    if (cost > 0) renderCosts.push(cost);
  }
  const rendersPerTrace: number[] = [];
  for (const trace of context.traces) {
    if (trace.renders.length > 0) rendersPerTrace.push(collapseRendersPerCommit(trace.commits).length);
  }
  const requests = context.network.map((n) => n.duration);

  let updates = 0;
  for (const r of context.renders) if (r.phase !== "mount") updates += 1;
  // A share needs a sample: 1 wasted of 3 updates (e.g. right after clear()) is not "33% wasted".
  const wastedPct = updates >= MIN_WASTED_SAMPLES ? (context.wastedRenderIds.size / updates) * 100 : null;

  return [
    result("interactionLatencyMs", b.interactionLatencyMs, latency, percentile(latency, 75)),
    result("longTaskMs", b.longTaskMs, longTasks, max(longTasks)),
    result("componentRenderMs", b.componentRenderMs, renderCosts, max(renderCosts)),
    result("rendersPerInteraction", b.rendersPerInteraction, rendersPerTrace, max(rendersPerTrace)),
    result("networkRequestMs", b.networkRequestMs, requests, max(requests)),
    {
      ...result("wastedRenderPct", b.wastedRenderPct, [], wastedPct),
      samples: updates,
      violations: context.wastedRenderIds.size,
    },
  ];
}
