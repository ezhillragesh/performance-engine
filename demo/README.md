# Northstar: Perf Engine demo

A small React 19 app that gives the [Perf Engine](../core) something real to diagnose. It has three tabs:

- **Workspace**: a mail-and-tasks app built the way you would build it for production. It is the control surface, so using it should cost nothing measurable.
- **Scenario Lab**: ten cards. Each one reproduces a single problem on demand and has a **Fixed version** that shows the cure.
- **About**: the pipeline, how to load the DevTools extension, and keyboard shortcuts.

The app consumes core the way any app would (`import { initPerfEngine } from 'performance-engine'`). A Vite alias points that import at `../core/index.ts`, so edits to core hot-reload without a build step. `src/perf.ts` starts the engine and must stay the first import in `src/main.tsx`: `instrumentReact()` has to install the React DevTools hook before `react-dom` loads.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173, React dev build, mock API as Vite middleware
npm run build      # typecheck (tsc -b) + production build into dist/
npm run preview    # serve dist/ exactly as a static host would
npm run lint
```

`window.__perfSession` is the live engine session, which you can use from the console (`__perfSession.getInsights()`, `.getSnapshot()`, `.getWebVitals()`).

## Pair it with the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the repository's `extension/` folder.
3. Reload the demo, open DevTools and select **Perf Intelligence**. Run a scenario and watch the insights arrive. The **Accessibility** tab audits the page with the same rules the last Lab card uses.

The demo bundles its own engine, so the panel connects in *app* mode. Nothing streams until a panel attaches.

## The Scenario Lab

Each card states what DevTools should show. Its badge turns green when the engine reports the matching insight for that run. On a Fixed card, "Fixed · no insight ✓" means the run finished with no matching insight, which is the success state. **Run all scenarios** runs every card's problem version in sequence (about 26s).

| # | Card | Deliberate problem (`src/scenarios/`) | Expected insight | Fixed version |
|---|------|---------------------------------------|------------------|---------------|
| 1 | Render burst | 24 unmemoized rows re-render on a click, then again from an effect | `interaction-induced-render-burst` | memoized rows, no effect-driven state |
| 2 | Keystroke render loop | every keystroke re-renders four panels doing ~3ms of CPU each | `keystroke-render-loop` | memoized panels fed a 300ms-debounced value |
| 3 | Slow event handler | the click handler busy-waits 280ms (slider) before `setState` | `interaction-render-latency`, `long-task`, `slow-interaction` (INP, real clicks) | 8ms slices with `scheduler.yield()`, committed in `startTransition` |
| 4 | Network-blocked render | a click fetches `api/slow?ms=900` and only then renders the table | `network-blocking-render` | prefetch on hover/focus, render from cache |
| 5 | State thrashing | two effects flip one value every 25ms for 500ms | `state-thrashing` on `ThrashMeter` | value derived from one source of truth |
| 6 | Wasted renders | a parent ticks every 200ms; an unmemoized 4ms chart gets identical props | `wasted-render` on `ExpensiveChart` | `React.memo` with stable props |
| 7 | Slow component | `SlowWidget` computes for 36ms during every render | `slow-component` on `SlowWidget` | computed once after paint and cached by dataset |
| 8 | Failing & over-budget requests | a retired endpoint answers HTTP 500; a 1.5s bulk export breaks the 1000ms network budget | `network-blocking-render` for `api/slow` (it explains the failed budget, so the engine adds no separate `budget-exceeded`); the 500 counts as a failed request | one 8-row page in ~120ms, no call to the retired endpoint |
| 9 | Healthy control | none: local state, memoized siblings, a deferred filter | nothing | (it *is* the fixed shape) |
| 10 | Accessibility issues | missing alt, unnamed icon button, unlabeled input, duplicate ids, skipped heading, "click here", low contrast, table without headers | not a perf insight: the card audits its own DOM with the unified rule set and counts issues | accessible markup: zero errors and warnings ("needs review" items are listed, not counted) |

The **Heavy workspace** toggle in the Lab makes every Workspace row burn 1.5ms while rendering, so you can watch the control surface degrade on purpose.

Notes:

- Deliberate problems live only in `src/scenarios/` and are marked `INTENTIONAL`. The Workspace must stay lean.
- The Accessibility card loads its two rule engines lazily as separate chunks, never in the main bundle. The first audit evaluates about 1.3 MB of engine code, and the perf engine reports that one-time cost as a long task. The engines run detached from your click's trace.
- Switching a card to Fixed swaps implementations and mounts a new subtree. That plumbing runs detached (`runDetached`), so it is not reported as the toggle click's render burst.
- Tab switches are wrapped in `trackAction('Open …', fn, { newTrace: true })`. Each navigation shows up in DevTools as a named action trace.
- Some updates are not caused by the user: the page-load inbox fetch and the opt-in background sync. They are applied synchronously and detached, so their renders are never counted as the work of whatever click or keystroke happens to be in flight.

## Development vs production builds

| | `npm run dev` | `npm run build` / `preview` / static host |
|---|---|---|
| React build | development (StrictMode double-renders) | production, using React's **profiling** bundle (`react-dom/profiling`) |
| Render durations | real | real (profiler timing). With `DEMO_REACT_PROFILING=0` (plain production React) they are not recorded: `slow-component` cannot fire, and that card says so |
| Component names in insights | original | original (`keepNames`), at a cost of ~10 KB gzip |
| Mock API (`api/*`) | Vite middleware | Service Worker (`mock-api-sw.js`) |

All ten cards behave the same in both builds (see `e2e/`). Absolute render times are lower in production, and the dev build's StrictMode double render makes a few dev-only extras likelier, such as a long task next to the slow component.

## Mock API and static hosting

`mock/api.ts` is a deterministic handler (seeded data plus simulated latency and failures) shared by two transports:

- **Dev**: `server/mockApi.ts` mounts it as Vite middleware, so requests are real HTTP and curl-able (`curl localhost:5173/api/messages`).
- **Production**: the same Vite plugin bundles `mock/sw.ts` into `dist/mock-api-sw.js`. On startup the app registers it, scoped to the base URL, and renders once it controls the page (`src/lib/api.ts`). The worker claims the page on first visit, and again after a hard reload.

The page still issues ordinary `fetch` requests, which go through the engine's network tracker and produce real Resource Timing entries. Status codes, bodies and latency are identical to dev. Only `<base>api/*` is intercepted. `vite preview` deliberately has no middleware, so it behaves exactly like a deployment.

| Endpoint | Response |
|---|---|
| `api/messages?delay=ms` | 12 messages |
| `api/invoices?delay=ms&limit=n` | up to 40 invoices |
| `api/slow?ms=n` | `{ ms, invoices }` after *n* ms (max 5000) |
| `api/error?delay=ms` | HTTP 500 |

### Deploy (GitHub Pages or any static host)

```sh
DEMO_BASE=/performance-engine/ npm run build   # base path for https://<user>.github.io/performance-engine/
# upload dist/ as-is
```

Routing uses the URL hash (`#workspace`, `#lab`, `#about`), so no SPA fallback or `404.html` is needed. Service Workers need HTTPS or `localhost`. Build-time variables:

| Variable | Default | Effect |
|---|---|---|
| `DEMO_BASE` | `/` | public path when the site lives under a sub-path |
| `DEMO_REACT_PROFILING` | on | `0` ships plain production React (no render durations) |

## End-to-end tests

```sh
npm run e2e:install   # once: downloads Chromium for Playwright
npm run e2e           # both projects: dev server + production build served by vite preview
npx playwright test --project=prod   # one project
```

`playwright.config.ts` starts both servers itself: dev on port 5175 and the production preview on 5176 (override with `E2E_DEV_PORT` / `E2E_PROD_PORT`). It builds into `node_modules/.e2e-dist`, so `dist/` is untouched, and reuses already-running servers outside CI. A global setup warms both servers first. Tests run serially in one worker because the scenarios measure real main-thread time. For every card, the suite checks:

- the problem version reaches `detected`, with a matching insight in `window.__perfSession` for that run;
- the Fixed version ends clean, with no matching insight;
- the Healthy control produces zero insights;
- the Accessibility card reports issues, and its Fixed version reports none;
- **Run all** brings every card to its expected state;
- the Workspace loads mail through the mock API, and using it produces no cost-bearing insight. Count-only render notes stay at low or medium severity: a click that mounts a list re-renders 6+ cheap components;
- tab switches (mouse, arrow keys, `1`/`2`/`3`) keep state and create no insights;
- no unexpected console errors.

Reports go to `playwright-report/` and `test-results/` (git-ignored).

## Layout

```
mock/            mock API handler (shared) + Service Worker entry
server/          Vite plugin: dev middleware, worker bundling
src/perf.ts      engine bootstrap (first import)
src/lib/         api helpers (base URL, worker registration), typing simulator
src/shell/       top bar, engine status pill, shared controls
src/workspace/   the control surface
src/scenarios/   Scenario Lab cards and the deliberate problems
src/about/       About page
e2e/             Playwright suite
```
