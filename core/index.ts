// Public API — see docs/CORE_API.md.

export * from "./session.js";

export * from "./analyzer/engine.js";
export * from "./analyzer/context.js";
export * from "./analyzer/rules/index.js";
export * from "./analyzer/budgets.js";
export * from "./analyzer/summary.js";
export * from "./analyzer/traces.js";
export * from "./analyzer/explain.js";

export * from "./logger/store.js";

export * from "./trace/traceContext.js";

export * from "./tracker/eventTracker.js";
export * from "./tracker/networkTracker.js";
export * from "./tracker/renderTracker.js";
export * from "./tracker/performanceTracker.js";
export { describeLabel, describeTarget } from "./tracker/dom.js";
export * from "./tracker/time.js";
export * from "./tracker/id.js";

export * from "./react/instrumentReact.js";

export * from "./bridge/devtoolsBridge.js";
export { ENGINE_GLOBAL_KEY, readEngineGlobal, type PerfEngineGlobal } from "./runtime/engineGlobal.js";

// Runtime accessibility audit (core/a11y). Named exports only: nothing runs at import time, so
// bundlers drop the audit entirely when runA11yAudit is not used (package.json sideEffects: false).
export { runA11yAudit, listRuleIds, computeScore as computeA11yScore, A11Y_ENGINE_VERSION, A11Y_IGNORE_ATTR } from "./a11y/engine.js";
// Additional rule engines (the engine object is passed in; core has no runtime dependency on them)
// and the unified rule set they are merged into.
export { runIbmAudit, mapIbmReport } from "./a11y/ibm.js";
export { runAxeAudit, mapAxeResults } from "./a11y/axe.js";
export { mergeA11yReports, criteriaCoverage, rulesCoverage } from "./a11y/unify.js";
export { UNIFIED_RULES, unifiedRule } from "./a11y/catalog/unified.js";
export { WCAG_CRITERIA, DEFAULT_A11Y_STANDARD, normalizeStandard, standardLabel, wcagUnderstandingUrl } from "./a11y/wcag.js";
export { wrapAceSource, wrapAxeSource, IBM_ACE_VERSION, AXE_CORE_VERSION } from "./a11y/loaders.js";
export type { AceLike, IbmAuditOptions } from "./a11y/ibm.js";
export type { AxeLike, AxeAuditOptions } from "./a11y/axe.js";
export type { MergeOptions, CriterionCoverage, RuleCoverage } from "./a11y/unify.js";
export type { UnifiedRule } from "./a11y/catalog/unified.js";
export type { A11yStandard, WcagCriterion, WcagVersion } from "./a11y/wcag.js";
export type {
  A11yImpact,
  A11yKind,
  A11yLevel,
  A11ySeverityTag,
  A11yFinding,
  A11yCounts,
  A11yReport,
  A11yAuditOptions,
  ListenerLookup,
  A11yEngineId,
  A11yEngineRun,
  A11ySource,
} from "./a11y/types.js";

export * from "./types/index.js";
