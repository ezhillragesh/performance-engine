/**
 * Order and timing used by "Run all". `runMs` is how long the scenario keeps
 * producing work after its Run button is pressed; the runner waits that long
 * plus a gap so traces from consecutive scenarios never overlap.
 */
export interface ScenarioEntry {
  id: string
  title: string
  runMs: number
  /**
   * What the card's badge checks. 'insight' (default): an engine insight after the run.
   * 'a11y': the run audits the card's own DOM with runA11yAudit — no perf insight is expected.
   */
  detect?: 'insight' | 'a11y'
}

export const SCENARIOS: ScenarioEntry[] = [
  { id: 'render-burst', title: 'Render burst', runMs: 400 },
  { id: 'keystroke-loop', title: 'Keystroke loop', runMs: 1500 },
  { id: 'slow-handler', title: 'Slow handler', runMs: 800 },
  { id: 'slow-network', title: 'Network-blocked render', runMs: 1400 },
  { id: 'state-thrash', title: 'State thrashing', runMs: 700 },
  { id: 'wasted-renders', title: 'Wasted renders', runMs: 5200 },
  { id: 'slow-component', title: 'Slow component', runMs: 400 },
  { id: 'request-failure', title: 'Failing & slow requests', runMs: 1800 },
  { id: 'healthy', title: 'Healthy control', runMs: 1500 },
  { id: 'a11y-issues', title: 'Accessibility issues', runMs: 300, detect: 'a11y' },
]

export const RUN_ALL_GAP_MS = 900
