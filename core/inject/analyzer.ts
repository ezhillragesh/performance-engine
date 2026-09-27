/**
 * Entry of `extension/vendor/perf-analyzer.mjs`: the pure analysis surface of
 * core for the DevTools panel ("DevTools only" mode). Import has no side
 * effects: no trackers, no hook, no bridge, no timers.
 */

export { analyzeEvents } from "../analyzer/engine.js";
export { buildAnalysisContext } from "../analyzer/context.js";
export { computeSummary } from "../analyzer/summary.js";
export { buildTraceSummaries } from "../analyzer/traces.js";
export { resolveBudgets, DEFAULT_BUDGETS } from "../analyzer/budgets.js";
export { sanitizeUrl } from "../tracker/networkTracker.js";
export { ENGINE_VERSION } from "../types/protocol.js";
