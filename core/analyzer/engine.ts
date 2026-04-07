import type { TrackedEvent } from "../types/events";
import type { Insight } from "../types/insights";
import { defaultRules, type AnalysisRule } from "./rules";
import { buildAnalysisContext } from "./context";

export interface AnalyzeOptions {
  rules?: AnalysisRule[];
  debug?: boolean;
}

export function getInsightId(insight: Insight): string {
  const dedupeKey = insight.metadata?.dedupeKey;
  if (typeof dedupeKey === "string" && dedupeKey.length > 0) {
    return dedupeKey;
  }
  const windowStart = insight.metadata?.timeWindowStart ?? 0;
  const windowEnd = insight.metadata?.timeWindowEnd ?? 0;
  return `${insight.issueType}|${insight.source}|${windowStart}-${windowEnd}`;
}

function mergeOverlappingInsights(insights: Insight[]): Insight[] {
  const merged: Insight[] = [];

  for (const insight of insights) {
    const start = insight.metadata?.timeWindowStart ?? 0;
    const end = insight.metadata?.timeWindowEnd ?? 0;

    let didMerge = false;
    for (let i = 0; i < merged.length; i += 1) {
      const existing = merged[i]!;
      if (existing.issueType !== insight.issueType || existing.source !== insight.source) {
        continue;
      }

      const eStart = existing.metadata?.timeWindowStart ?? 0;
      const eEnd = existing.metadata?.timeWindowEnd ?? 0;

      if (start <= eEnd && end >= eStart) {
        if (insight.confidence > existing.confidence) {
          merged[i] = insight;
        }
        didMerge = true;
        break;
      }
    }

    if (!didMerge) {
      merged.push(insight);
    }
  }

  return merged;
}

function dedupeInsights(insights: Insight[]): Insight[] {
  const seen = new Set<string>();
  const unique: Insight[] = [];

  for (const insight of insights) {
    const id = getInsightId(insight);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(insight);
  }

  return unique;
}

export function analyzeEvents(
  events: TrackedEvent[],
  options?: AnalyzeOptions,
): Insight[] {
  const rules = options?.rules ?? defaultRules;
  const debug = options?.debug ?? false;

  const context = buildAnalysisContext(events);

  if (debug) {
    console.log(
      `[perf-engine] Analysis context: ${context.events.length} events, ${context.interactions.length} interactions, ${context.allRenderChains.length} render chains`,
    );
  }

  const insights: Insight[] = [];

  for (const rule of rules) {
    const ruleInsights = rule.run(context);
    if (debug && ruleInsights.length > 0) {
      console.log(`[perf-engine] Rule "${rule.name}" produced ${ruleInsights.length} insight(s)`);
    }
    insights.push(...ruleInsights);
  }

  const deduped = dedupeInsights(insights);
  const merged = mergeOverlappingInsights(deduped);

  if (debug) {
    console.log(
      `[perf-engine] Final: ${merged.length} insights (${insights.length} raw → ${deduped.length} deduped → ${merged.length} merged)`,
    );
  }

  return merged;
}
