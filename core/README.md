# performance-engine

In-browser performance intelligence for frontend apps. It records what happens after each user
interaction (renders, requests, long tasks, browser-measured latency), groups it into **causal
traces**, and turns that into **insights with evidence**: what was slow, why, how sure it is, and
what to change. It also measures **Core Web Vitals** with attribution, evaluates **performance
budgets**, and ships a runtime **accessibility audit**.

- Zero runtime dependencies, ESM, TypeScript types included, tree-shakable (`sideEffects: false`).
- Framework-agnostic core. React gets automatic per-component render instrumentation.
- Safe to import and start during SSR: nothing runs at import time, and trackers that need a DOM
  do nothing in Node.
- Pairs with the companion [Chrome DevTools extension](https://github.com/ezhillragesh/performance-engine/tree/main/extension),
  which shows traces, insights, vitals and the accessibility audit in a Chrome DevTools panel.

Full API reference: [docs/CORE_API.md](https://github.com/ezhillragesh/performance-engine/blob/main/docs/CORE_API.md).
Wire protocol: [docs/PROTOCOL.md](https://github.com/ezhillragesh/performance-engine/blob/main/docs/PROTOCOL.md).

## Install

```sh
npm install performance-engine
```

Requires an ESM-aware bundler or Node 18+ (`import`, not `require`).

## Quick start

### React

`instrumentReact()` must run **before `react-dom` is evaluated**: React connects to the DevTools
hook when its module loads. Put the setup in its own module and import it first.

```ts
// src/perf.ts
import { initPerfEngine, instrumentReact } from "performance-engine";

instrumentReact();
export const perf = initPerfEngine({
  budgets: { interactionLatencyMs: 200 },
  onInsights: (insights) => console.table(insights.map((i) => [i.severity, i.message])),
});
```

```tsx
// src/main.tsx
import "./perf"; // first import: before react / react-dom
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

It coexists with the React DevTools extension (it chains the existing hook, or installs a
compatible one and yields to React DevTools if that loads later). Render durations come from
React's profiling fields, so they are real in development builds and 0 in production builds
(render counts, wasted renders and causality still work; render insights without timings are capped at
medium severity and say so, since their cost is unknown). With `debug: true` the session warns
when React never registered, which almost always means the setup ran after `react-dom`.

### Any framework or plain DOM

```ts
import { initPerfEngine, trackRender } from "performance-engine";

const perf = initPerfEngine();

// Optional: report renders yourself (Vue, Svelte, Lit, canvas, ...).
trackRender("ProductGrid", durationMs, propsHash, prevPropsHash);

// Read results whenever you like.
const insights = perf.getInsights();
const vitals = perf.getWebVitals();
```

### Name your own actions

Clicks, key presses and form events open traces automatically. For work that starts elsewhere
(a route change, a WebSocket message, a timer), name it so everything it causes is grouped:

```ts
import { startAction, trackAction } from "performance-engine";

await trackAction("route:/inbox", () => router.navigate("/inbox"));

const sync = startAction("ws:sync");
socket.onmessage = (msg) => sync.run(() => store.apply(msg));
// later
sync.end();
```

Inside a live trace (called from a click handler), an action joins that trace and names it
(`TraceSummary.action`); `{ newTrace: true }` splits it off. Action names are sent to DevTools
as is, so never put user data in them.

## How it works

```
trackers (UI events, fetch/XHR, React commits, long animation frames, Event Timing)
  -> trace context stamps a traceId on every event at capture time
  -> bounded event store (2000 events by default)
  -> analysis every 2s, only when there is new data: rules see one trace at a time
  -> insights { evidence[], confidence derived from evidence } + budgets + summary
  -> your callbacks / getters, and the DevTools bridge while a panel is attached
```

Attribution is causal, not by time window: a trace stays active through the handler, its
microtasks and the following frames, and a request started inside it re-activates it when the
response arrives, so the renders caused by the response belong to the click that sent it.

## Configuration

`initPerfEngine(config?)` returns a session. It replaces any previous session.

| Option | Default | |
| --- | --- | --- |
| `trackEvents` | `true` | click, dblclick, input, change, keydown, submit, pointerdown (capture phase, passive) |
| `trackNetwork` | `true` | fetch + XHR (browsers only; URLs are reduced to path + parameter names) |
| `trackRenders` | `true` | accepts `instrumentReact()`, `<Profiler>` and `trackRender()` events |
| `trackLongTasks` | `true` | Long Animation Frames with script attribution, Long Tasks as fallback |
| `trackInteractions` | `true` | Event Timing (browser-measured interaction latency) |
| `trackWebVitals` | `true` | LCP, INP, CLS, FCP, TTFB with attribution |
| `sampleRate` | `1` | share of page loads that record anything (0..1) |
| `maxEvents` | `2000` | store capacity (100..50 000); oldest events are trimmed |
| `analysisIntervalMs` | `2000` | analysis tick (min 50) |
| `budgets` | see below | partial `PerformanceBudgets` |
| `customRules` | `[]` | extra `AnalysisRule`s (run before the budget rule) |
| `replaceDefaultRules` | `false` | run only `customRules` |
| `interactionWindowMs` | `300` | grouping window for events recorded without a trace |
| `devtools` | `true` | DevTools bridge; `{ snapshotIntervalMs, maxEvents }` or `false` |
| `onInsights` | | called with the full insight list whenever it changes |
| `debug` | `false` | console diagnostics |

The session: `getInsights()`, `getTraces()`, `getSummary()`, `getWebVitals()`, `getEvents()`,
`getSnapshot()` (JSON-safe, everything at once), `subscribe(listener)` (after each analysis tick
with new data), `analyzeNow()`, `setBudgets()`, `pause()` / `resume()`, `clear()`, `stop()`, plus
`sessionId`, `features` and `sampled`.

## Insights

Every insight has a stable `id`, `issueType`, `severity` (low to critical), `source` (component,
URL or element), `message`, `cause`, `possibleFix`, `impact.estimatedDelayMs`, the `traceId` it was
derived from, and `evidence[]` (measurements, correlations, budget comparisons, each with event
ids), from which `confidence` is computed. `explainInsight(insight)` renders one as a sentence.

| issueType | Raised when |
| --- | --- |
| `interaction-render-latency` | the first render after an input took 50ms or more; names the blocking request or long tasks |
| `slow-interaction` | browser-measured interaction latency exceeded the budget, split into input delay, processing and presentation |
| `interaction-induced-render-burst` | one interaction re-rendered many components (grouped per instance and commit; mounts are not counted) |
| `keystroke-render-loop` | typing into a text field re-renders a large part of the tree on every keystroke (not shortcuts or arrow keys on buttons) |
| `network-blocking-render` | a slow response gated the renders that followed it |
| `state-thrashing` | a component's own state flipped repeatedly within one trace |
| `wasted-render` | re-renders with no prop, state or context change |
| `slow-component` | a component's self render time exceeded the budget |
| `long-task` | the main thread was blocked (with LoAF script attribution) |
| `budget-exceeded` | a budget failed and no specific insight explains it |

## Budgets

| Budget | Default |
| --- | --- |
| `interactionLatencyMs` (p75) | 200 |
| `longTaskMs` | 50 |
| `componentRenderMs` | 16 |
| `rendersPerInteraction` | 25 |
| `networkRequestMs` | 1000 |
| `wastedRenderPct` | 30 |

`session.getSummary().budgets` reports each one as pass / warn (80% of the limit) / fail /
no-data with the worst observed value and the number of violations. Change them at runtime with
`session.setBudgets({ longTaskMs: 100 })`.

## Core Web Vitals

```ts
import { rateWebVital } from "performance-engine";

const v = perf.getWebVitals();
// { lcp, lcpTarget, cls, inp, fcp, ttfb, interactions, attribution: { lcp, cls, inp } }
rateWebVital("inp", v.inp); // "good" | "needs-improvement" | "poor" | null

// Typical RUM reporting: send the final values when the page is hidden.
addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") navigator.sendBeacon("/rum", JSON.stringify(perf.getWebVitals()));
});
```

Definitions follow `web-vitals` (CLS session windows, INP as the p98 interaction with bounded
memory, values relative to `activationStart`). `attribution.inp.traceId` links the INP
interaction to the engine's causal trace, so you can see what that interaction rendered and
fetched. Vitals are page-lifetime values and are not reset by `clear()`. `startWebVitalsTracking()`
is also usable on its own.

## Custom rules

Rules are pure functions over an analysis context grouped by trace. Use the context's `traces`,
not the flat event list, and build insights with `createInsight` so ids stay stable:

```ts
import { createInsight, initPerfEngine, type AnalysisRule } from "performance-engine";

const tooManyRequests: AnalysisRule = {
  name: "too-many-requests",
  run(context) {
    return context.traces
      .filter((trace) => trace.networkRequests.length > 10)
      .map((trace) =>
        createInsight({
          issueType: "network-blocking-render",
          category: "network",
          severity: "medium",
          source: trace.committedTrigger.target,
          anchor: trace.trigger.eventId,
          message: `${trace.networkRequests.length} requests for one interaction.`,
          cause: "Requests are issued one per item.",
          possibleFix: "Batch them into one request.",
          evidence: [{ kind: "measurement", label: "Requests in trace", value: trace.networkRequests.length, unit: "count", weight: 0.6 }],
          delayMs: 0,
          traceId: trace.traceId,
        }),
      );
  },
};

initPerfEngine({ customRules: [tooManyRequests] });
```

A rule that throws is isolated (the others still run). The pure analysis API (`analyzeEvents`,
`buildAnalysisContext`, `computeSummary`, `buildTraceSummaries`, `evaluateBudgets`) also works
offline, for example on an exported snapshot in Node or in tests.

## Accessibility audit

```ts
import { runA11yAudit, runAxeAudit, mergeA11yReports } from "performance-engine";
import axe from "axe-core"; // optional, your own dependency

const own = runA11yAudit(document);              // synchronous, never throws
const fromAxe = await runAxeAudit(axe, document); // never rejects
const report = mergeA11yReports([own, fromAxe]);  // one finding per element and rule, WCAG 2.2 AA by default
console.log(report.score, report.counts, report.findings);
```

`runA11yAudit` runs 89 built-in DOM rules. axe-core and the IBM Equal Access engine
(`runIbmAudit(ace, ...)`) are not dependencies: you pass the engine in. `mergeA11yReports` folds
any combination into one unified rule set, deduplicated by element. Findings carry rule ids, a
CSS path and a redacted tag snippet, never form values or page text. The audit code is only
bundled if you import it.

## DevTools extension

`initPerfEngine` starts a small bridge (`window.postMessage`) for the
[DevTools extension](https://github.com/ezhillragesh/performance-engine/tree/main/extension). It
announces the session and streams snapshots only while a DevTools panel is attached, so the page
pays nothing when DevTools is closed. Pass `devtools: false` to disable it. The extension also
works on pages that do not bundle the engine, by injecting its own copy; when both are present,
the app's copy always wins.

## Browser support and overhead

- Chromium browsers get every signal. Elsewhere each tracker degrades on its own: without Long
  Animation Frames it uses Long Tasks, and without Event Timing, LCP or layout-shift entries
  those metrics stay `null`; nothing throws.
- Memory is bounded: the event store (default 2000 events), trace records, interaction maps and
  INP candidates all have fixed caps.
- Work happens off the interaction path: capture is a few property reads per event, and analysis
  runs on the tick, only when there is new data (about 11ms for 2000 events on a laptop).
- Instrumentation never throws into your app: every hook is wrapped, and engine work is never
  attributed to the user's trace.
- Bundle size (minified / gzip, esbuild): `initPerfEngine` + `instrumentReact` about 74 / 25 kB;
  the analysis API alone about 34 / 11 kB; the accessibility audit adds about 110 / 31 kB if used.
- `sampleRate` keeps the cost at zero for page loads that are not sampled.

## License

[MIT](https://github.com/ezhillragesh/performance-engine/blob/main/core/LICENSE) © 2026 Ezhill Ragesh.
The built-in accessibility rules are ported from BarrierBreak eslint-plugin-a11yinspect (MIT); see
`dist/THIRD_PARTY_NOTICES.md`.
