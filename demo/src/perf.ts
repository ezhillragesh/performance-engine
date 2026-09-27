/**
 * Perf Engine bootstrap.
 *
 * This module MUST be the first import of `main.tsx`: `instrumentReact()`
 * installs (or chains) `__REACT_DEVTOOLS_GLOBAL_HOOK__`, and React registers
 * with that hook when `react-dom` is first evaluated. ES modules evaluate in
 * import order, so importing this file before `react-dom/client` guarantees
 * the hook exists when React loads.
 *
 * The DevTools bridge is started by `initPerfEngine` itself (see
 * docs/PROTOCOL.md) — the demo never posts messages to the extension.
 */
import { initPerfEngine, instrumentReact } from '../../core/index'
import type { PerfEngineSession } from '../../core/index'

declare global {
  interface Window {
    /** Exposed for debugging from the browser console. */
    __perfSession?: PerfEngineSession
  }
}

// EngineStatus renders the engine's own live counters. Recording its renders
// would feed those counters (each tick's re-render adds events, which changes
// the count, which re-renders it on the next tick) and put demo chrome into
// the traces it is trying to show.
instrumentReact({ ignore: ['EngineStatus'] })

export const session: PerfEngineSession = initPerfEngine({
  analysisIntervalMs: 1500,
  budgets: {
    interactionLatencyMs: 200,
    longTaskMs: 50,
    componentRenderMs: 16,
    networkRequestMs: 1000,
  },
})

window.__perfSession = session
