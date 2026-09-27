import type { Evidence, Insight } from "../types/insights.js";

function formatEvidence(e: Evidence): string {
  const unit = e.unit === "count" || e.unit === undefined ? "" : e.unit;
  const threshold = e.threshold !== undefined ? ` (threshold ${e.threshold}${unit})` : "";
  return `${e.label}: ${e.value}${typeof e.value === "number" ? unit : ""}${threshold}`;
}

/** One-paragraph, human-readable explanation of an insight. */
export function explainInsight(insight: Insight): string {
  const impactDelay = Math.round(insight.impact?.estimatedDelayMs ?? 0);
  const estimated = insight.metadata?.impactEstimated === true ? " (estimated)" : "";
  const renderCost =
    insight.impact?.renderCostMs !== undefined ? ` Render cost ${Math.round(insight.impact.renderCostMs)}ms.` : "";
  const confidencePct = Math.round((insight.confidence ?? 0) * 100);
  const evidence = (insight.evidence ?? []).slice(0, 4).map(formatEvidence);

  return [
    `[${insight.severity}] ${insight.message}`,
    `Cause: ${insight.cause}`,
    `Impact: ~${impactDelay}ms${estimated}.${renderCost}`,
    evidence.length > 0 ? `Evidence: ${evidence.join("; ")}.` : "",
    `Confidence: ${confidencePct}%.`,
    `Suggestion: ${insight.possibleFix}`,
  ]
    .filter(Boolean)
    .join(" ");
}
