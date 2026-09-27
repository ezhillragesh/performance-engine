// Runtime accessibility audit — public API.
// Rules ported from BarrierBreak eslint-plugin-a11yinspect (MIT); see THIRD_PARTY_NOTICES.md.
export { runA11yAudit, listRuleIds, computeScore, countFindings, A11Y_ENGINE_VERSION, A11Y_IGNORE_ATTR } from "./engine.js";
export { runIbmAudit, mapIbmReport, ibmRulesetFor, classifyIbmValue } from "./ibm.js";
export type { AceLike, IbmAuditOptions, IbmReportLike, IbmResult } from "./ibm.js";
export { runAxeAudit, mapAxeResults, axeTagsFor, wcagFromAxeTag } from "./axe.js";
export type { AxeLike, AxeAuditOptions, AxeResultsLike } from "./axe.js";
export { mergeA11yReports, criteriaCoverage, rulesCoverage, shapeFromSnippet } from "./unify.js";
export type { MergeOptions, CriterionCoverage, CriterionStatus, RuleCoverage, RuleStatus } from "./unify.js";
export { UNIFIED_RULES, FALLBACK_RULE, IGNORED_SOURCES, unifiedRule, unifiedRuleForSource, ruleInStandard } from "./catalog/unified.js";
export type { UnifiedRule, UnifiedRuleTag, UnifiedWcagRef } from "./catalog/unified.js";
export { WCAG_CRITERIA, DEFAULT_A11Y_STANDARD, wcagCriterion, wcagUnderstandingUrl, normalizeStandard, standardLabel, criterionInStandard, criteriaForStandard } from "./wcag.js";
export type { WcagCriterion, WcagVersion, A11yStandard, A11yStandardProfile } from "./wcag.js";
export { wrapAceSource, wrapAxeSource, IBM_ACE_VERSION, AXE_CORE_VERSION, ACE_GLOBAL_KEY, AXE_GLOBAL_KEY, ENGINES_PROBE_EXPR } from "./loaders.js";
export { accessibleName, isHidden, isFocusable, uniqueSelector, snippet, snippetFromMarkup, DomCache } from "./dom.js";
export type { Scope } from "./dom.js";
export { checkMeta, allCheckMeta } from "./meta.js";
export type { CheckMeta } from "./meta.js";
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
} from "./types.js";
