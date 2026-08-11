# AGENTS.md

Frontend performance intelligence system: an in-browser telemetry + causal diagnosis stack. Three independent subsystems in one repo (no workspace tooling, no CI):

- `core/` — framework-agnostic TS library: trackers, bounded event store, rule-based analyzer. Only devDependency is `typescript`. Not publish-ready (`main`/`module` both point at ESM `dist`); `demo/` consumes it via relative import, not npm.
- `demo/` — React 19 + Vite app that generates realistic jank and runs the engine. Imports core as `../../core/index` (that is why `vite.config.ts` sets `server.fs.allow: ['..']`). Editing `core/` can break the demo build even when core itself typechecks.
- `extension/` — Chrome MV3 extension, plain vanilla JS, **no build step**. Verification is `node --check <file>.js`.

Authoritative architecture doc: `docs/PROJECT_OVERVIEW_AND_ARCHITECTURE.md`.

## Commands (there are no tests anywhere)

```sh
cd core   && npm run typecheck        # tsc --noEmit; the only core check
cd demo   && npm run lint             # eslint; must stay clean
cd demo   && npm run build            # tsc -b && vite build; gate for cross-package TS
cd demo   && npm run dev              # dev server with HMR
# extension: no build/lint/tests — syntax-check edited JS with `node --check`
```

## Data flow (know this before editing)

```
trackers (ui/network/render) -> store (bounded, 2000 cap) -> buildAnalysisContext
  -> rules.ts (6 rules) -> Insight -> initPerfEngine dedupe -> demo main.tsx
  -> window.postMessage({source:'perf-engine'}) -> contentScript.js -> background.js
  -> DevTools panel (routed by tabId)
```

- All event/insight `timestamp`s are `performance.now()` (monotonic, page-relative). `index.ts` uses `Date.now()` only for its own dedupe windows.
- The demo posts only the full insights list to the panel (`session.getInsights()`), not the deduped "fresh" subset — `onInsights` must never publish `freshInsights` directly or the panel list shrinks every cycle.

## Rules & analyzer gotchas

- A rule must scope to the **interaction window** (`interaction.renderEvents`, `interaction.networkEvents`) — never scan global `context.events` for "first render after an interaction". This was a real bug: background renders got attributed to unrelated interactions.
- Adding a rule means updating the closed `IssueType` union in `core/types/insights.ts`, registering it in `defaultRules` (`core/analyzer/rules.ts`), and ideally the docs.
- Insights used to have inconsistent dedupe identity: rules 5–6 set `metadata.dedupeKey`, rules 1–4 rely on a window fallback. Prefer `dedupeKey` for new rules.

## Render tracking in the demo is manual and deliberate

- `useRenderTracker` records via `trackRender` **inside a `useEffect` (post-commit)**. Do not move it into the render body — it breaks under React 19 StrictMode double-render and the `react-hooks/refs` lint rule.
- The demo intentionally generates poor performance (CPU-burn loops, 1.2s `autoRefresh` state churn, StrictMode double renders) to feed the analyzer. Do not "fix" this as a bug — it is the load generator.
- `stop()` in `core/index.ts` globally disables render tracking (`setRenderTrackingEnabled(false)`); the flag is module-global, not per-session.

## Demo lint rules that bite

- `react-hooks` is strict: no `setState()` directly in effects (derive instead), no reading/writing refs during render, `useMemo`/`useEffect` deps must be exact.
- `tsconfig.app.json` has `noUnusedLocals`/`noUnusedParameters` — dead imports/vars fail `npm run build`.

## Extension constraints

- `manifest.json` declares `scripting` + `activeTab` and `<all_urls>` (all currently unused/overbroad). `extension/icons/` exists but is not registered in the manifest.
- MV3 service workers lose in-memory `devtoolsPorts`/`tabState` when terminated; `panel.js` auto-reconnects and re-requests a snapshot on disconnect — preserve that.
- `shared/bridge.js` and `stopNetworkTracking()` in `core/tracker/networkTracker.ts` are dead code — treat as removable.
