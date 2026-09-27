export * from "./shared.js";
export * from "./rendering.js";
export * from "./interaction.js";
export * from "./network.js";
export * from "./mainThread.js";
export * from "./budget.js";

import type { AnalysisRule } from "./shared.js";
import {
  interactionRenderBurstRule,
  keystrokeRenderLoopRule,
  slowComponentRule,
  stateThrashingRule,
  wastedRenderRule,
} from "./rendering.js";
import { interactionRenderLatencyRule, slowInteractionRule } from "./interaction.js";
import { networkBlockingRenderRule } from "./network.js";
import { longTaskRule } from "./mainThread.js";
import { budgetExceededRule } from "./budget.js";

/**
 * Default rule set. `budgetExceededRule` must stay last (it reads earlier
 * results); `keystrokeRenderLoopRule` runs before `interactionRenderBurstRule`
 * so a keystroke's renders are reported once, as the more specific insight.
 */
export const defaultRules: readonly AnalysisRule[] = Object.freeze([
  keystrokeRenderLoopRule,
  interactionRenderBurstRule,
  interactionRenderLatencyRule,
  networkBlockingRenderRule,
  stateThrashingRule,
  wastedRenderRule,
  slowInteractionRule,
  longTaskRule,
  slowComponentRule,
  budgetExceededRule,
]);
