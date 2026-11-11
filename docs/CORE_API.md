# Core public API (v0.3)

Everything below is exported from `core/index.ts`. Types: `core/types/*.ts`. Wire protocol: `docs/PROTOCOL.md`.

## Setup order (React apps)

```ts
// src/perf.ts  — MUST be imported before react-dom (first import in main.tsx)
import { initPerfEngine, instrumentReact } from '../../core/index'

instrumentReact()                 // installs (RDT-compatible) or chains __REACT_DEVTOOLS_GLOBAL_HOOK__ before React loads
export const session = initPerfEngine({ budgets: { interactionLatencyMs: 200 } })
```

`instrumentReact()` must run before `react-dom` evaluates, because React registers with the DevTools hook at module load. It works with or without the React DevTools extension installed:

- RDT (extension or `react-devtools-core`) installed its hook first: `instrumentReact()` chains its `onCommitFiberRoot`.
- No hook yet: it installs an RDT-compatible hook (`createCompatibleHook()`: `renderers`, `rendererInterfaces`, `backends`, `sub/on/off/emit`, `inject` emitting `"renderer"`, `getFiberRoots`, commit forwarding, ...) as a configurable accessor, and *yields* to a real RDT that installs later: while the hook is still ours with no renderer registered, a window-scoped `hasOwnProperty` shim reports the key as absent so RDT's `installHook` proceeds; the new hook is then re-chained (microtask, setter, or lazily from `getReactInstrumentationStatus()`). Once React registered with our hook it never yields (nothing may be lost). Same idea as bippy / React Scan. Durations are real in React development builds (`actualDuration`/`selfBaseDuration` on fibers); in production builds they are 0 unless the app uses a profiling build.

## `initPerfEngine(config?: PerfEngineConfig): PerfEngineSession`

```ts
interface PerfEngineConfig {
  trackEvents?: boolean;        // default true — DOM interactions (click, input, keydown, submit, pointerdown/up, change, dblclick)
  trackNetwork?: boolean;       // default true — fetch + XHR
  trackRenders?: boolean;       // default true — accepts trackRender()/instrumentReact()/profiler events
  trackLongTasks?: boolean;     // default true — long-animation-frame, fallback longtask
  trackInteractions?: boolean;  // default true — Event Timing API (INP-style latency)
  analysisIntervalMs?: number;  // default 2000
  maxEvents?: number;           // default 2000 (min 100), reset per session
  budgets?: Partial<PerformanceBudgets>;
  customRules?: AnalysisRule[];
  replaceDefaultRules?: boolean;
  devtools?: boolean | { snapshotIntervalMs?: number; maxEvents?: number }; // default true in browsers: starts the DevTools bridge
  debug?: boolean;
  onInsights?: (insights: Insight[]) => void;   // full current list, called when it changes (on the analysis tick or an explicit analyzeNow/clear/setBudgets — never from inside a getter)
  mode?: "app" | "injected";    // default "app"; reported as HELLO config.mode. "injected" is used only by the extension bundle
}

interface PerfEngineSession {
  readonly sessionId: string;
  readonly mode: "app" | "injected";
  analyzeNow(): Insight[];
  getInsights(): Insight[];
  getEvents(): TrackedEvent[];
  getTraces(): TraceSummary[];
  getSummary(): SessionSummary;
  getSnapshot(): PerfSnapshot;
  getBudgets(): PerformanceBudgets;
  setBudgets(budgets: Partial<PerformanceBudgets>): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  clear(): void;                // clears events + insights, keeps trackers
  subscribe(listener: (snapshot: PerfSnapshot) => void): () => void; // fires after each analysis tick; work it causes is not attributed to the user's open trace
  stop(): void;                 // idempotent
}
```

Safe to call in non-browser environments (SSR / Node): trackers that need `document`/`window`/`PerformanceObserver` become no-ops.

### Engine copies and handoff (`mode`)

A page can run two independent copies of core: the app's own bundle and the extension-injected `extension/vendor/perf-engine.inject.js` (docs/PROTOCOL.md, "Engine modes"). They coordinate through `globalThis.__PERF_ENGINE_GLOBAL__ = { kind, sessionId, stop, copy, engineVersion }` (`readEngineGlobal()`, `ENGINE_GLOBAL_KEY`, type `PerfEngineGlobal`):

- `initPerfEngine` registers its session there and first stops a session registered by *another* copy. Stopping fully uninstalls that copy: DOM listeners, PerformanceObservers, the bridge, and the fetch/XHR patches. When a patch can't be unhooked because a third party wrapped it later, it becomes a pass-through. `stop()` removes the registration if it is still its own.
- The injected bundle does nothing when an `"app"` engine is already registered. Otherwise it calls `instrumentReact()` + `initPerfEngine({ mode: "injected" })`, so an app engine starting later always replaces it.
- React: both copies' commit wrappers can stay chained on `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Only the copy owning the registered session records renders, so there is no double counting, whichever copy called `instrumentReact()` first. If the app copy calls `instrumentReact()` after `react-dom` loaded but the injected copy had already installed the hook, React is still observed.
- In `"injected"` mode the bridge stays silent until `DOMContentLoaded`: it sends no HELLO and ignores commands until then. An app engine that starts during parsing therefore replaces it before the panel ever sees the injected session.

## Render instrumentation

- `instrumentReact(options?: { ignore?: (string | RegExp)[]; trackHostComponents?: false; maxDepth?: number }): () => void` — automatic, per-instance render events with `commitId`, `instanceId`, `phase`, real durations (dev builds), `changedProps`, `stateChanged`, `contextChanged`, `wasted`, `parentComponent`.
- `createProfilerOnRender(): React.ProfilerOnRenderCallback`-compatible function for `<Profiler id onRender>` (no React import in core; signature `(id, phase, actualDuration, baseDuration, startTime, commitTime)`).
- `trackRender(componentName, durationMs?, propsHash?, prevPropsHash?, extra?: Partial<RenderEvent>)` — manual.

## Trace / correlation

- `runDetached<T>(fn: () => T): T` — run engine/tooling work (and the microtasks it schedules) without attributing it to the currently open trace. The session uses it for tick notifications, so a UI that renders engine stats is never blamed on the user's last click.
- The idle clock of a trace starts when the task that opened (or re-activated) it has finished, so a slow synchronous handler does not expire its own trace. A response arriving while a *newer* interaction is live only borrows the context for its synchronous continuation and then restores the live trace.
- `getReactInstrumentationStatus(): "not-installed" | "waiting" | "active"` — `isReactInstrumented()` (and HELLO `config.react`) is true only once a renderer registered or a commit was observed; with `debug: true` the session warns if React never registers.

- `getActiveTraceId(): string | undefined`
- `runInTrace<T>(traceId: string, fn: () => T): T` — attribute work (e.g. a response handler) to a trace explicitly.
- Automatic: a trigger UI event (click, dblclick, keydown, input, change, submit, pointerdown→click grouped) starts a trace; the trace stays active through the handler, microtasks and following frames until idle (120ms without tracked work, max 2s). `fetch`/XHR started while a trace is active carry its `traceId`, and the trace is re-activated when the response arrives, so renders caused by the response are attributed causally.

## Analysis (pure, usable offline / in tests)

- `analyzeEvents(events, options?: { rules?, budgets?, debug?, interactionWindowMs? }): Insight[]`
- `buildAnalysisContext(events, options?)`, `buildTraceSummaries(context, insights)`, `computeSummary(events, insights, budgets)`, `evaluateBudgets(context, budgets)`
- `DEFAULT_BUDGETS: PerformanceBudgets`, `defaultRules`, `explainInsight(insight)`
- Types: `AnalysisRule { name; run(context: AnalysisContext, options: RuleOptions): Insight[] }`.

## Accessibility audit

- `runA11yAudit(root?: Document | Element | null, options?: A11yAuditOptions): A11yReport` — audits `root` (default `document`; an element audits only its subtree) with 89 rules ported from eslint-plugin-a11yinspect (MIT, `THIRD_PARTY_NOTICES.md`). Synchronous, never throws (`report.error`), JSON-safe. Options: `rules?`, `include?: "all" | "errors"`, `maxFindings?` (1000), `timeBudgetMs?` (500), `listeners?` (DevTools `getEventListeners`).
- `listRuleIds()`, `computeA11yScore(findings)` (0-100), `A11Y_ENGINE_VERSION`, `A11Y_IGNORE_ATTR`.
- Types: `A11yReport`, `A11yFinding` (`id, ruleId, check, kind, impact, severity, wcag, level, message, help, selector, snippet, detail?, count?`), `A11yCounts`, `A11yAuditOptions`, `A11yImpact`, `A11yKind`, `A11yLevel`, `A11ySeverityTag`, `ListenerLookup`.
- `runIbmAudit(ace, root?, options?): Promise<A11yReport>` / `runAxeAudit(axe, root?, options?): Promise<A11yReport>` — run the IBM Equal Access engine (`accessibility-checker-engine` ace.js, Apache-2.0) / axe-core (MPL-2.0) and return engine-level reports. The engine object is a parameter (core has no runtime dependency): load it with `wrapAceSource(src)` / `wrapAxeSource(src)` (evaluate the returned expression; installs `window.__PERF_INTEL_ACE__` / `__PERF_INTEL_AXE__` without touching `window.ace` / `window.axe`). Options: `standard?`, `maxFindings?`. Never reject (`report.error`). Also `mapIbmReport`, `mapAxeResults`, `IBM_ACE_VERSION`, `AXE_CORE_VERSION`.
- `mergeA11yReports(reports, { standard?, maxFindings? }): A11yReport` — the unified report: one finding per element (by the adapters' `node` key, not the selector) + unified rule, with the duplicate-collapse policies of `catalog/unified.ts` and impact → kind → rule → document order (`UNIFIED_RULES`, `unifiedRule(id)`), most severe kind (error > review > warning) and impact, hidden `sources`, filtered by the standard (`DEFAULT_A11Y_STANDARD` = WCAG 2.2 AA with best practices and needs-review; `normalizeStandard`, `standardLabel`). Idempotent on unified reports. `criteriaCoverage(report, standard?)` and `rulesCoverage(report, standard?)` give per-criterion / per-rule status; `WCAG_CRITERIA` (all 87 WCAG 2.0-2.2 criteria), `wcagUnderstandingUrl(num)`.
- `A11yKind` now includes `"review"` ("Needs review"); `A11yCounts.reviews`; types `A11yStandard`, `A11ySource`, `A11yEngineId`, `A11yEngineRun`, `UnifiedRule`, `CriterionCoverage`, `RuleCoverage`, `AceLike`, `AxeLike`.
- Named exports with no import-time side effects, so the audit is dropped by bundlers when unused. The DevTools panel uses the IIFE build `extension/vendor/a11y-audit.js` plus `vendor/a11y-rules.mjs` (docs/PROTOCOL.md "Accessibility audit").

## DevTools bridge

- `startDevtoolsBridge(session, options?: { snapshotIntervalMs?; maxEvents?; getConfig?; target?; deferInitialHello? }): () => void` — started automatically by `initPerfEngine` unless `devtools: false`. Implements `docs/PROTOCOL.md` (HELLO / SNAPSHOT / RESET; commands PING, ATTACH, DETACH, REQUEST_SNAPSHOT, CLEAR, PAUSE, RESUME, SET_BUDGETS). Streams only while a panel is attached.
