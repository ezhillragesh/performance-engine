/**
 * Budget rule: one insight per failing budget that no specific rule already
 * explains. Must run after the other rules (reads `priorInsights`).
 */

import type { BudgetKey, Evidence, Insight, IssueType } from "../../types/insights.js";
import type { AnalysisContext } from "../context.js";
import { DEFAULT_BUDGETS, evaluateBudgets } from "../budgets.js";
import { createInsight, severityFromRatio, type AnalysisRule, type RuleOptions } from "./shared.js";

const COVERED_BY: Record<BudgetKey, readonly IssueType[]> = {
  interactionLatencyMs: ["slow-interaction", "interaction-render-latency"],
  longTaskMs: ["long-task"],
  componentRenderMs: ["slow-component"],
  rendersPerInteraction: ["interaction-induced-render-burst", "keystroke-render-loop"],
  networkRequestMs: ["network-blocking-render"],
  wastedRenderPct: ["wasted-render"],
};

const FIXES: Record<BudgetKey, string> = {
  interactionLatencyMs:
    "Reduce work done in response to input: yield to the main thread, use startTransition for non-urgent updates.",
  longTaskMs: "Split long-running scripts into smaller tasks or move them to a worker.",
  componentRenderMs: "Profile the slowest components and memoize or virtualize their expensive parts.",
  rendersPerInteraction: "Narrow state updates so fewer components re-render per interaction.",
  networkRequestMs: "Cache, prefetch or speed up the slowest endpoints.",
  wastedRenderPct: "Memoize components whose inputs rarely change and stabilise props with useMemo/useCallback.",
};

function withUnit(value: number, unit: "ms" | "count" | "%"): string {
  return unit === "count" ? String(value) : `${value}${unit}`;
}

export const budgetExceededRule: AnalysisRule = {
  name: "budget-exceeded",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const budgets = options?.budgets ?? DEFAULT_BUDGETS;
    const present = new Set<IssueType>((options?.priorInsights ?? []).map((i) => i.issueType));
    const out: Insight[] = [];
    for (const result of evaluateBudgets(context, budgets)) {
      if (result.status !== "fail" || result.actual === null) continue;
      if (COVERED_BY[result.key].some((t) => present.has(t))) continue;
      const evidence: Evidence[] = [
        {
          kind: "budget",
          label: result.label,
          value: result.actual,
          unit: result.unit,
          threshold: result.limit,
          weight: 0.6,
        },
      ];
      if (result.samples > 0) {
        evidence.push({
          kind: "measurement",
          label: "Samples over budget",
          value: result.violations,
          unit: "count",
          weight: Math.min(0.3, result.violations / Math.max(1, result.samples)),
        });
      }
      const isMs = result.unit === "ms";
      out.push(
        createInsight({
          issueType: "budget-exceeded",
          category: "budget",
          severity: severityFromRatio(result.actual, result.limit),
          source: result.key,
          anchor: "budget",
          message: `${result.label} is ${withUnit(result.actual, result.unit)} (budget ${withUnit(result.limit, result.unit)}).`,
          cause: `${result.violations} of ${result.samples} sample(s) exceeded the ${result.key} budget.`,
          possibleFix: FIXES[result.key],
          evidence,
          delayMs: isMs ? result.actual - result.limit : 0,
          impactEstimated: !isMs,
          metadata: { budgetKey: result.key, budgetLimit: result.limit, budgetActual: result.actual },
        }),
      );
    }
    return out;
  },
};
