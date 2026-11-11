// Accessibility audit of a DOM subtree with the full unified rule set, as the DevTools
// Accessibility tab runs it. Loaded with a dynamic import (only when the Accessibility card is
// audited), and the two vendored rule engines are loaded lazily inside it as raw source, then
// installed with core's wrappers — private globals, the page's own window.ace / window.axe are
// never touched — so none of this lands in the demo's main bundle.
import {
  mergeA11yReports,
  runA11yAudit,
  runAxeAudit,
  runDetached,
  runIbmAudit,
  wrapAceSource,
  wrapAxeSource,
  type A11yReport,
  type A11yStandard,
  type AceLike,
  type AxeLike,
} from 'performance-engine'

/** Standard the card is audited against (same default as the DevTools tab). */
export const CARD_STANDARD: A11yStandard = { profile: 'wcag', version: '2.2', level: 'AA', bestPractices: true, includeReview: true }

interface Engines {
  ace: AceLike
  axe: AxeLike
}

let engines: Promise<Engines> | null = null

/** Evaluates a wrapped engine source in the global scope (the wrappers return the installed version). */
function install(wrapped: string): void {
  new Function(`return ${wrapped}`)()
}

function loadEngines(): Promise<Engines> {
  engines ??= Promise.all([import('accessibility-checker-engine/ace.js?raw'), import('axe-core/axe.min.js?raw')])
    .then(([ace, axe]) => {
      install(wrapAceSource(ace.default))
      install(wrapAxeSource(axe.default))
      const g = window as unknown as { __PERF_INTEL_ACE__?: { ace: AceLike }; __PERF_INTEL_AXE__?: { axe: AxeLike } }
      if (!g.__PERF_INTEL_ACE__ || !g.__PERF_INTEL_AXE__) throw new Error('Rule engines failed to load')
      return { ace: g.__PERF_INTEL_ACE__.ace, axe: g.__PERF_INTEL_AXE__.axe }
    })
    .catch((err: unknown) => {
      engines = null
      throw err
    })
  return engines
}

/**
 * Audits `root`: the fast built-in rules first (reported through `onPartial`), then the other
 * engines, merged into the unified rule set. Tooling work runs detached from the click's trace.
 */
export async function auditSubtree(root: Element, onPartial?: (report: A11yReport) => void): Promise<A11yReport> {
  const inspect = runDetached(() => runA11yAudit(root))
  onPartial?.(mergeA11yReports([inspect], { standard: CARD_STANDARD }))
  const { ace, axe } = await loadEngines()
  const axeReport = await runDetached(() => runAxeAudit(axe, root, { standard: CARD_STANDARD }))
  const ibmReport = await runDetached(() => runIbmAudit(ace, root, { standard: CARD_STANDARD }))
  return mergeA11yReports([inspect, axeReport, ibmReport], { standard: CARD_STANDARD })
}
