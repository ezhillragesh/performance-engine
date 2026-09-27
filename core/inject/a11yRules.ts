// Entry for extension/vendor/a11y-rules.mjs (ESM, built by core/scripts/build-a11y.mjs): the DOM-free
// half of the accessibility audit that the DevTools panel runs itself — unified rule catalog, WCAG
// table and standards, merging validated engine reports, coverage views, and the source wrappers
// used to inject the vendored engines without clobbering page globals.
export { UNIFIED_RULES, FALLBACK_RULE, unifiedRule, ruleInStandard } from "../a11y/catalog/unified.js";
export { WCAG_CRITERIA, DEFAULT_A11Y_STANDARD, normalizeStandard, standardLabel, wcagCriterion, wcagUnderstandingUrl, criteriaForStandard, criterionInStandard } from "../a11y/wcag.js";
export { mergeA11yReports, criteriaCoverage, rulesCoverage } from "../a11y/unify.js";
export { wrapAceSource, wrapAxeSource, IBM_ACE_VERSION, AXE_CORE_VERSION, ACE_GLOBAL_KEY, AXE_GLOBAL_KEY, ENGINES_PROBE_EXPR } from "../a11y/loaders.js";
export { A11Y_ENGINE_VERSION } from "../a11y/version.js";
