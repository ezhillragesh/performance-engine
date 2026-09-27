/**
 * Analysis engine: runs rules over a context, isolates rule failures,
 * dedupes by id and merges overlapping episodes of the same issue.
 */

import type { TrackedEvent } from "../types/events.js";
import type { Insight, PerformanceBudgets, Severity } from "../types/insights.js";
import { buildAnalysisContext, DEFAULT_INTERACTION_WINDOW_MS, type AnalysisContext } from "./context.js";
import { resolveBudgets } from "./budgets.js";
import { defaultRules } from "./rules/index.js";
import { buildInsightId, MAX_CONFIDENCE, SEVERITY_RANK, type AnalysisRule, type RuleOptions } from "./rules/shared.js";

export interface AnalyzeOptions {
  rules?: readonly AnalysisRule[];
  budgets?: Partial<PerformanceBudgets>;
  debug?: boolean;
  /** Minimum window for untagged (legacy) events, ms. Default 300. */
  interactionWindowMs?: number;
  /** Called when a rule throws (default: console.warn in debug mode). */
  onRuleError?: (rule: AnalysisRule, error: unknown) => void;
}

const SEVERITIES: ReadonlySet<string> = new Set<Severity>(["low", "medium", "high", "critical"]);

/** Stable identity of an insight (its `id`, falling back to legacy keys). */
export function getInsightId(insight: Insight): string {
  if (typeof insight.id === "string" && insight.id.length > 0) return insight.id;
  const dedupeKey = insight.metadata?.dedupeKey;
  if (typeof dedupeKey === "string" && dedupeKey.length > 0) return dedupeKey;
  return buildInsightId(insight.issueType, insight.source, String(insight.metadata?.timeWindowStart ?? 0));
}

/** Fills fields custom rules may omit so downstream code can rely on them. */
function normalise(insight: Insight): Insight {
  const evidence = Array.isArray(insight.evidence) ? insight.evidence : [];
  const confidence = Number.isFinite(insight.confidence) ? Math.max(0, Math.min(MAX_CONFIDENCE, insight.confidence)) : 0;
  const severity: Severity = SEVERITIES.has(insight.severity) ? insight.severity : "medium";
  const impact = insight.impact ?? { estimatedDelayMs: 0 };
  const normalised: Insight = { ...insight, evidence, confidence, severity, impact, category: insight.category ?? "rendering" };
  normalised.id = getInsightId(normalised);
  return normalised;
}

function isBetter(a: Insight, b: Insight): boolean {
  const sa = SEVERITY_RANK[a.severity];
  const sb = SEVERITY_RANK[b.severity];
  if (sa !== sb) return sa > sb;
  if (a.confidence !== b.confidence) return a.confidence > b.confidence;
  return a.impact.estimatedDelayMs > b.impact.estimatedDelayMs;
}

function dedupeById(insights: readonly Insight[]): Insight[] {
  const byId = new Map<string, Insight>();
  for (const insight of insights) {
    const existing = byId.get(insight.id);
    if (!existing || isBetter(insight, existing)) byId.set(insight.id, insight);
  }
  return Array.from(byId.values());
}

function windowOf(insight: Insight): { start: number; end: number } | null {
  const start = insight.metadata?.timeWindowStart;
  const end = insight.metadata?.timeWindowEnd;
  if (typeof start !== "number" || !Number.isFinite(start)) return null;
  return { start, end: typeof end === "number" && Number.isFinite(end) ? Math.max(start, end) : start };
}

/**
 * Interval-union merge of insights with the same issueType + source.
 * Sorted by window start, so the result does not depend on rule order.
 * The merged insight keeps the *earliest* member's id (stable as windows
 * grow) and the strongest member's content; its window is the union.
 */
export function mergeOverlappingInsights(insights: readonly Insight[]): Insight[] {
  const passthrough: Insight[] = [];
  const groups = new Map<string, { insight: Insight; start: number; end: number }[]>();
  for (const insight of insights) {
    const w = windowOf(insight);
    if (!w) {
      passthrough.push(insight);
      continue;
    }
    const key = `${insight.issueType}\u0000${insight.source}`;
    const list = groups.get(key);
    const item = { insight, start: w.start, end: w.end };
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const merged: Insight[] = [...passthrough];
  for (const list of groups.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end || (a.insight.id < b.insight.id ? -1 : 1));
    let cur = { first: list[0]!.insight, best: list[0]!.insight, start: list[0]!.start, end: list[0]!.end, count: 1 };
    const flush = (): void => {
      if (cur.count === 1) {
        merged.push(cur.first);
        return;
      }
      merged.push({
        ...cur.best,
        id: cur.first.id,
        metadata: {
          ...cur.best.metadata,
          dedupeKey: cur.first.id,
          timeWindowStart: cur.start,
          timeWindowEnd: cur.end,
          mergedCount: cur.count,
        },
      });
    };
    for (let i = 1; i < list.length; i += 1) {
      const item = list[i]!;
      if (item.start <= cur.end) {
        cur.end = Math.max(cur.end, item.end);
        cur.count += 1;
        if (isBetter(item.insight, cur.best)) cur.best = item.insight;
      } else {
        flush();
        cur = { first: item.insight, best: item.insight, start: item.start, end: item.end, count: 1 };
      }
    }
    flush();
  }
  return merged;
}

function sortInsights(insights: Insight[]): Insight[] {
  return insights.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.confidence - a.confidence ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Runs rules over an existing context. */
export function analyzeContext(context: AnalysisContext, options: AnalyzeOptions = {}): Insight[] {
  const rules = options.rules ?? defaultRules;
  const debug = options.debug ?? false;
  const raw: Insight[] = [];
  const ruleOptions: RuleOptions = {
    budgets: resolveBudgets(options.budgets),
    interactionWindowMs: options.interactionWindowMs ?? context.interactionWindowMs,
    priorInsights: raw,
  };

  for (const rule of rules) {
    try {
      const produced = rule.run(context, ruleOptions);
      if (!Array.isArray(produced)) continue;
      for (const insight of produced) {
        if (insight && typeof insight === "object") raw.push(normalise(insight));
      }
      if (debug && produced.length > 0) {
        console.log(`[perf-engine] rule "${rule.name}" produced ${produced.length} insight(s)`);
      }
    } catch (error) {
      if (options.onRuleError) {
        try {
          options.onRuleError(rule, error);
        } catch {
          // ignore
        }
      } else if (debug) {
        console.warn(`[perf-engine] rule "${rule?.name}" threw`, error);
      }
    }
  }

  const deduped = dedupeById(raw);
  const merged = mergeOverlappingInsights(deduped);
  if (debug) {
    console.log(`[perf-engine] ${raw.length} raw -> ${deduped.length} deduped -> ${merged.length} merged insights`);
  }
  return sortInsights(merged);
}

export function analyzeEvents(events: readonly TrackedEvent[], options: AnalyzeOptions = {}): Insight[] {
  const context = buildAnalysisContext(events, {
    interactionWindowMs: options.interactionWindowMs ?? DEFAULT_INTERACTION_WINDOW_MS,
  });
  if (options.debug) {
    console.log(`[perf-engine] context: ${context.events.length} events, ${context.traces.length} traces`);
  }
  return analyzeContext(context, options);
}
