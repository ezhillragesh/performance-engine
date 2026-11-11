# Core public API (v0.4)

Everything below is exported from `core/index.ts`, published on npm as [`performance-engine`](https://www.npmjs.com/package/performance-engine) (ESM only, zero dependencies, `sideEffects: false`; one entry point `performance-engine` plus `performance-engine/package.json`). Types: `core/types/*.ts`. Wire protocol: `docs/PROTOCOL.md`. Package landing page: `core/README.md`.

Importing has no side effects (no globals, timers, listeners or patches until you call a function), so unused parts are dropped by bundlers: `npm run check:package` verifies this on the packed tarball.

## Setup order (React apps)

```ts
// src/perf.ts  — MUST be imported before react-dom (first import in main.tsx)
import { initPerfEngine, instrumentReact } from 'performance-engine' // the demo imports '../../core/index'

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
  trackWebVitals?: boolean;     // default true — LCP, INP, CLS, FCP, TTFB with attribution (v0.4)
  sampleRate?: number;          // default 1 — share of page loads that record anything, 0..1 (v0.4)
  analysisIntervalMs?: number;  // default 2000 (min 50; non-finite values fall back to the default)
  maxEvents?: number;           // default 2000 (100..50 000; non-finite values fall back to the default), reset per session
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
  readonly features: PerfEngineFeatures; // resolved tracker flags (all false when not sampled)
  readonly sampled: boolean;    // false when sampleRate excluded this page load
  analyzeNow(): Insight[];
  getInsights(): Insight[];
  getEvents(): TrackedEvent[];
  getTraces(): TraceSummary[];
  getSummary(): SessionSummary;
  getWebVitals(): WebVitals;    // page-lifetime values, not reset by clear() (v0.4)
  getSnapshot(options?: { maxEvents?: number }): PerfSnapshot; // JSON-safe; includes `vitals` (v0.4)
  getBudgets(): PerformanceBudgets;
  setBudgets(budgets: Partial<PerformanceBudgets>): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  clear(): void;                // clears events + insights, keeps trackers (and Web Vitals)
  subscribe(listener: (snapshot: PerfSnapshot) => void): () => void; // fires after each analysis tick with new data (or new vitals); work it causes is not attributed to the user's open trace
  onReset(listener: () => void): () => void;
  getChangeSignature(): string; // cheap token that changes whenever the snapshot would
  stop(): void;                 // idempotent
}
```

Safe to call in non-browser environments (SSR / Node): trackers that need `document`/`window`/`PerformanceObserver` become no-ops, fetch is never patched outside browsers, and the analysis timer is `unref()`ed. A `null` config is treated as `{}`; non-function `customRules` entries are ignored.

**Stale handles.** The event store is module-level. Once a newer `initPerfEngine` call took over, an older (stopped) session no longer reads or changes it: `getEvents()` / `getSnapshot().events` return `[]`, `pause` / `resume` / `clear` are no-ops, and its getters return its last results. A stopped session without a successor keeps reading its data.

**Sampling.** `sampleRate` is drawn once per `initPerfEngine` call (`isSampledIn(rate, random?)`). An unsampled session installs no trackers, no bridge and no timer, records no renders or actions, does not register in `__PERF_ENGINE_GLOBAL__` (so it does not stop an extension-injected engine either), and returns empty results with `sampled: false`.

### Engine copies and handoff (`mode`)

A page can run two independent copies of core: the app's own bundle and the extension-injected `extension/vendor/perf-engine.inject.js` (docs/PROTOCOL.md, "Engine modes"). They coordinate through `globalThis.__PERF_ENGINE_GLOBAL__ = { kind, sessionId, stop, copy, engineVersion }` (`readEngineGlobal()`, `ENGINE_GLOBAL_KEY`, type `PerfEngineGlobal`):

- `initPerfEngine` registers its session there and first stops a session registered by *another* copy. Stopping fully uninstalls that copy: DOM listeners, PerformanceObservers, the bridge, and the fetch/XHR patches. When a patch can't be unhooked because a third party wrapped it later, it becomes a pass-through. `stop()` removes the registration if it is still its own.
- The injected bundle does nothing when an `"app"` engine is already registered. Otherwise it calls `instrumentReact()` + `initPerfEngine({ mode: "injected" })`, so an app engine starting later always replaces it.
- React: both copies' commit wrappers can stay chained on `__REACT_DEVTOOLS_GLOBAL_HOOK__`. Only the copy owning the registered session records renders, so there is no double counting, whichever copy called `instrumentReact()` first. If the app copy calls `instrumentReact()` after `react-dom` loaded but the injected copy had already installed the hook, React is still observed.
- In `"injected"` mode the bridge stays silent until `DOMContentLoaded`: it sends no HELLO and ignores commands until then. An app engine that starts during parsing therefore replaces it before the panel ever sees the injected session.

## Render instrumentation

- `instrumentReact(options?: { ignore?: (string | RegExp)[]; trackHostComponents?: false; maxDepth?: number; maxFibers?: number }): () => void` (a `/g` or `/y` ignore RegExp is matched from the start every time) — automatic, per-instance render events with `commitId`, `instanceId`, `phase`, real durations (dev builds), `changedProps`, `stateChanged`, `contextChanged`, `wasted`, `parentComponent`.
- `createProfilerOnRender(): React.ProfilerOnRenderCallback`-compatible function for `<Profiler id onRender>` (no React import in core; signature `(id, phase, actualDuration, baseDuration, startTime, commitTime)`).
- `trackRender(componentName, durationMs?, propsHash?, prevPropsHash?, extra?: Partial<RenderEvent>)` — manual. A non-finite `extra.timestamp` is replaced by the current time.

## User actions (v0.4)

Framework-agnostic trace tagging for work that does not start with a DOM input (route changes, WebSocket messages, timers):

- `startAction(name, options?: { newTrace?: boolean }): ActionHandle` — outside a live trace, opens a new trace whose trigger is a UI event `{ eventType: "action", target: name, startsTrace: true }`. Inside a live trace (e.g. from a click handler) it joins it by default: the click stays the trigger and the trace summary gets `action: name`. `newTrace: true` always opens a new one. Names are trimmed, whitespace-collapsed and capped at `MAX_ACTION_NAME_LENGTH` (80). They are developer labels sent to DevTools as is: never put user data in them.
- `ActionHandle { traceId: string | undefined; name; startsTrace; run(fn); end() }` — `run(fn)` runs `fn` attributed to the action (use it for continuations after a non-network `await`; fetch/XHR re-attach on their own). When `fn` returns a native Promise, `run` returns a promise that settles the same way right after re-activating the trace, so the caller's continuation is attributed too (chained rather than a side branch, so unhandled-rejection reporting is unchanged). `end()` stops attributing new work to the action's own trace (never ends a trace it joined).
- `trackAction(name, fn, options?)` = `startAction(name, options).run(fn)`.
- Nothing is recorded while no sampled session runs (`setActionTrackingEnabled` / `isActionTrackingEnabled`, managed by the session like render tracking); the handle then just runs your code (`traceId` undefined).
- Analysis: an action trace is analysed like any trace (render bursts, latency to first render: "First render after action "x" took ..."), but it is not an interaction: it is excluded from `SessionSummary.interactions` (fallback count) and from the interaction-latency budget samples, and Event Timing entries are never matched to it (`findTraceByTriggerTime` skips `action` / `manual` traces). `isActionTrace(trace)`.
- `UIEventType` gains `"action"`; `TraceSummary.action?: string`; `endTrace(traceId)` (trace context).

## Core Web Vitals (v0.4)

- Measured by the session when `trackWebVitals` is on (default): `session.getWebVitals(): WebVitals`, also in every `PerfSnapshot.vitals`. Changes bump `getChangeSignature()` and make the next analysis tick notify subscribers (without re-running the rules).
- `WebVitals { lcp, lcpTarget, cls, inp, fcp, ttfb, interactions, attribution: { lcp?: { target, url?, startTime }, cls?: { target?, startTime, value }, inp?: { name, target, interactionId, startTime, inputDelay, processingMs, presentationDelay, traceId? } } }` — the flat fields match the DevTools collector's vitals (docs/PROTOCOL.md). Values are ms relative to `activationStart` (CLS unitless); `null` until measured or when unsupported; `cls` is `0` when layout-shift is supported and nothing shifted.
- Definitions follow `web-vitals`: LCP / FCP ignored after the page was first hidden; CLS = largest session window (gap < 1s, ≤ 5s), shifts with recent input excluded, attributed to the largest shift of that window; INP = the (n/50)-th longest of the 10 longest interactions (n = `performance.interactionCount` or an estimate from the interactionId range), bounded memory. `attribution.inp.traceId` links the INP interaction to the engine's causal trace.
- Page-lifetime: `clear()` does not reset them. A new `initPerfEngine` re-reads buffered entries.
- Standalone: `startWebVitalsTracking(): WebVitalsTracker { read(); revision(); stop() }` (SSR-safe), `rateWebVital(name, value): "good" | "needs-improvement" | "poor" | null`, `WEB_VITAL_THRESHOLDS` (LCP 2500/4000, INP 200/500, CLS 0.1/0.25, FCP 1800/3000, TTFB 800/1800; good is inclusive), `emptyWebVitals()`. Types `WebVitals`, `WebVitalName`, `WebVitalRating`, `WebVitalsAttribution`, `LcpAttribution`, `ClsAttribution`, `InpAttribution`.

## Trace / correlation

- `runDetached<T>(fn: () => T): T` — run engine/tooling work (and the microtasks it schedules) without attributing it to the currently open trace. The session uses it for tick notifications, so a UI that renders engine stats is never blamed on the user's last click.
- The idle clock of a trace starts when the task that opened (or re-activated) it has finished, so a slow synchronous handler does not expire its own trace. A response arriving while a *newer* interaction is live only borrows the context for its synchronous continuation and then restores the live trace.
- `getReactInstrumentationStatus(): "not-installed" | "waiting" | "active"` — `isReactInstrumented()` (and HELLO `config.react`) is true only once a renderer registered or a commit was observed; with `debug: true` the session warns if React never registers.

- `getActiveTraceId(): string | undefined`
- `runInTrace<T>(traceId: string, fn: () => T): T` — attribute work (e.g. a response handler) to a trace explicitly.
- Response continuations: a response whose request had a trace re-activates it (next item); a response whose request had **no** trace (e.g. a page-load fetch) runs its synchronous continuation and the microtasks it queues with no trace, hiding (then restoring) whatever interaction is live, so its work is never blamed on the user's click or keystroke (`enterResponseContext(traceId | undefined)`, used by the fetch / XHR trackers). Like the borrow case, work the app defers to a later task (e.g. after `await response.json()`) is attributed by whatever is live then.
- Automatic: a trigger UI event (click, dblclick, keydown, input, change, submit, pointerdown→click grouped) starts a trace; the trace stays active through the handler, microtasks and following frames until idle (120ms without tracked work, max 2s). `fetch`/XHR started while a trace is active carry its `traceId`, and the trace is re-activated when the response arrives, so renders caused by the response are attributed causally.

## Event store

- Bounded, timestamp-ordered (`getEvents`, `getRecentEvents`, `getStoreStats`, `pushEvent`, `pushEvents`, `setMaxStoreSize`, `MIN_STORE_SIZE` 100, `MAX_STORE_SIZE` 50 000, `DEFAULT_MAX_STORE_SIZE` 2000). Events whose `timestamp` is not a finite number are rejected (`pushEvent` returns false), so the order can never be corrupted. Store events are shared, never mutate them.

## Analysis (pure, usable offline / in tests)

- `analyzeEvents(events, options?: { rules?, budgets?, debug?, interactionWindowMs? }): Insight[]`
- `buildAnalysisContext(events, options?)`, `buildTraceSummaries(context, insights)`, `computeSummary(events, insights, budgets)`, `evaluateBudgets(context, budgets)`
- `DEFAULT_BUDGETS: PerformanceBudgets`, `defaultRules`, `explainInsight(insight)`
- Types: `AnalysisRule { name; run(context: AnalysisContext, options: RuleOptions): Insight[] }`. Build insights with `createInsight(draft)` (stable id from issueType + source + anchor, confidence from evidence). Output is normalised: missing `source` / `message` / `cause` / `possibleFix` become strings, a non-finite `impact.estimatedDelayMs` becomes 0, confidence is clamped. A throwing rule is isolated (`onRuleError`).
- Render-count rules (`interaction-induced-render-burst`, `keystroke-render-loop`) count re-renders only: `phase: "mount"` renders are the UI an interaction opens, and a heavy mount is still caught by the cost-based rules. Manual renders without a phase count.
- `keystroke-render-loop` needs a text-entry trace (`isTextEntryTrace`): one of its keydown / input / change events has `UIEvent.editable === true` (v0.4, captured at event time by `isTextEntryTarget`: text-like `<input>`, `<textarea>`, contenteditable, role textbox / searchbox / combobox; only the element type, never its value). Events without the flag (older engines, manual events) fall back to an `input` / `textarea` target tag. Keyboard shortcuts on `body` and arrow keys on tab buttons are no longer keystroke loops (a large cascade there can still be a render burst).
- Render cost unknown (React production builds report no `actualDuration` / `selfBaseDuration`): when no render behind a render-burst, keystroke-loop, state-thrashing or wasted-render insight has timing data, its severity is capped at `medium` (`UNKNOWN_COST_MAX_SEVERITY`), its evidence weights are scaled by `UNKNOWN_COST_WEIGHT_FACTOR` (0.6) so the derived confidence drops, a zero-weight `heuristic` evidence item and a sentence in `cause` say timings were unavailable, and `metadata.renderCostUnknown` is `true` (`capUnknownRenderCost`). Ids, rule order and dev-build behaviour are unchanged; one timed render is enough to use measured cost.

## Accessibility audit

- `runA11yAudit(root?: Document | Element | null, options?: A11yAuditOptions): A11yReport` — audits `root` (default `document`; an element audits only its subtree) with 89 rules ported from eslint-plugin-a11yinspect (MIT, `THIRD_PARTY_NOTICES.md`). Synchronous, never throws (`report.error`), JSON-safe. Options: `rules?`, `include?: "all" | "errors"`, `maxFindings?` (1000), `timeBudgetMs?` (500), `listeners?` (DevTools `getEventListeners`).
- `listRuleIds()`, `computeA11yScore(findings)` (0-100), `A11Y_ENGINE_VERSION`, `A11Y_IGNORE_ATTR`.
- Types: `A11yReport`, `A11yFinding` (`id, ruleId, check, kind, impact, severity, wcag, level, message, help, selector, snippet, detail?, count?`), `A11yCounts`, `A11yAuditOptions`, `A11yImpact`, `A11yKind`, `A11yLevel`, `A11ySeverityTag`, `ListenerLookup`.
- `runIbmAudit(ace, root?, options?): Promise<A11yReport>` / `runAxeAudit(axe, root?, options?): Promise<A11yReport>` — run the IBM Equal Access engine (`accessibility-checker-engine` ace.js, Apache-2.0) / axe-core (MPL-2.0) and return engine-level reports. The engine object is a parameter (core has no runtime dependency): load it with `wrapAceSource(src)` / `wrapAxeSource(src)` (evaluate the returned expression; installs `window.__PERF_INTEL_ACE__` / `__PERF_INTEL_AXE__` without touching `window.ace` / `window.axe`). Options: `standard?`, `maxFindings?`. Never reject (`report.error`). Also `mapIbmReport`, `mapAxeResults`, `IBM_ACE_VERSION`, `AXE_CORE_VERSION`.
- `mergeA11yReports(reports, { standard?, maxFindings? }): A11yReport` — the unified report: one finding per element (by the adapters' `node` key, not the selector) + unified rule, with the duplicate-collapse policies of `catalog/unified.ts` and impact → kind → rule → document order (`UNIFIED_RULES`, `unifiedRule(id)`), most severe kind (error > review > warning) and impact, hidden `sources`, filtered by the standard (`DEFAULT_A11Y_STANDARD` = WCAG 2.2 AA with best practices and needs-review; `normalizeStandard`, `standardLabel`). Idempotent on unified reports. `criteriaCoverage(report, standard?)` and `rulesCoverage(report, standard?)` give per-criterion / per-rule status; `WCAG_CRITERIA` (all 87 WCAG 2.0-2.2 criteria), `wcagUnderstandingUrl(num)`.
- `A11yKind` now includes `"review"` ("Needs review"); `A11yCounts.reviews`; types `A11yStandard`, `A11ySource`, `A11yEngineId`, `A11yEngineRun`, `UnifiedRule`, `CriterionCoverage`, `RuleCoverage`, `AceLike`, `AxeLike`.
- Named exports with no import-time side effects, so the audit is dropped by bundlers when unused. The DevTools panel uses the IIFE build `extension/vendor/a11y-audit.js` plus `vendor/a11y-rules.mjs` (docs/PROTOCOL.md "Accessibility audit").

## DevTools bridge

- `startDevtoolsBridge(session, options?: { snapshotIntervalMs?; maxEvents?; getConfig?; target?; deferInitialHello? }): () => void` — started automatically by `initPerfEngine` unless `devtools: false`. Implements `docs/PROTOCOL.md` (HELLO / SNAPSHOT / RESET; commands PING, ATTACH, DETACH, REQUEST_SNAPSHOT, CLEAR, PAUSE, RESUME, SET_BUDGETS). Streams only while a panel is attached. Non-finite `snapshotIntervalMs` / `maxEvents` fall back to the defaults (1000ms, 1500). Since v0.4 HELLO `config` carries `trackWebVitals` and every SNAPSHOT carries `vitals` (both optional on the wire: absent from older engines).
