import type { Insight } from "../types/insights";

export function explainInsight(insight: Insight): string {
  const impactDelay = Math.round(insight.impact.estimatedDelayMs);
  const renderCost = insight.impact.renderCostMs
    ? ` Render cost is estimated at ${Math.round(insight.impact.renderCostMs)}ms.`
    : "";
  const confidencePct = Math.round(insight.confidence * 100);

  return [
    insight.message,
    `Cause: ${insight.cause}`,
    `Impact: ~${impactDelay}ms.${renderCost}`,
    `Confidence: ${confidencePct}%.`,
    `Suggestion: ${insight.possibleFix}`,
  ].join(" ");
}
