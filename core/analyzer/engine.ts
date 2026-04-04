import type { TrackedEvent } from "../types/events";
import type { Insight } from "../types/insights";
import { defaultRules, type AnalysisRule } from "./rules";
import { buildAnalysisContext } from "./context";

export function analyzeEvents(
  events: TrackedEvent[],
  rules: AnalysisRule[] = defaultRules,
): Insight[] {
  const context = buildAnalysisContext(events);
  return rules.flatMap((rule) => rule.run(context));
}
