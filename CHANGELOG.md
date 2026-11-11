# Changelog

All notable changes to this project are documented in this file. One version number covers the npm
package `performance-engine` (`core/`) and the Perf Intelligence DevTools extension (`extension/`).
The demo is not versioned.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0.0, a minor version may
contain breaking changes, and they are listed under **Changed** or **Removed** with a migration note.

## [0.4.0] - Unreleased

### Added

**Engine (`performance-engine`)**

- Core Web Vitals with attribution: `session.getWebVitals()`, snapshot `vitals`, config
  `trackWebVitals` (default on), `rateWebVital()` and `WEB_VITAL_THRESHOLDS`. Attribution covers the LCP
  element and resource URL (query values stripped), the largest CLS shift, and the INP phases with the
  `traceId` of the interaction's causal trace. Values last for the page's lifetime.
- User actions: `startAction(name, { newTrace })` and `trackAction(name, fn)` name traces for non-DOM
  work (route changes, sockets, timers). Adds `TraceSummary.action`, and UI events can have
  `eventType: "action"`.
- Sampling: `initPerfEngine({ sampleRate })` and `session.sampled`. An unsampled session installs
  nothing.
- `npm run check:package` (in `core/`): packs the tarball and checks it as a consumer (Node without a
  DOM; `tsc` with `bundler`, `node16` and `nodenext`; esbuild tree-shaking). Runs in `prepublishOnly`
  and CI.

**DevTools extension**

- Toolbar popup (`popup/`): per-site status, version, React detection, score and counts, with Enable,
  Disable and Remove access. No new permissions.
- "Copy as Markdown" for an insight and "Copy summary" on the Overview (URLs reduced to origin and
  path).
- First-run Getting-started guide (`?` or the help button) that explains the three modes, highlights
  the current one, and lists the keyboard shortcuts.
- Engine Web Vitals are preferred over the panel's own collector, the Overview links the INP
  interaction to its trace, and Traces show the user `action`.
- A production-React note in Components and on the Overview.
- Store readiness: `short_name`, `homepage_url`, a description of 132 characters or fewer, and
  `node scripts/package-extension.mjs` (`npm run package:extension`), which verifies manifest and HTML
  paths and writes `dist-extension/perf-intelligence-devtools-<version>.zip` (without `dev/`).
- [`docs/EXTENSION.md`](./docs/EXTENSION.md) (user guide) and [`docs/PRIVACY.md`](./docs/PRIVACY.md).

**Demo**

- Static hosting: one deterministic mock API (`demo/mock/api.ts`) with two transports, Vite middleware
  in dev and a Service Worker (`mock-api-sw.js`) in the production build. Every call is still a real
  fetch with real Resource Timing. `DEMO_BASE` sets the base path, and `DEMO_REACT_PROFILING=0` ships
  plain production React.
- The production build uses React's profiling build (real render durations) and keeps component names.
- `npm run e2e` (Playwright): every scenario and its fixed version, the Healthy control, the
  accessibility card, the Workspace and tabs, against both the dev server and the production build.
- Every Scenario Lab card has a Fixed version. Navigation is recorded with
  `trackAction('Open …', { newTrace: true })`.
- The demo shell itself is accessible (zero audit errors in both themes, WAI-ARIA tabs, labelled
  fields).

**Project**

- Root README, architecture document with Architecture Decision Records (`docs/adr/`), docs index,
  contributing guide, security policy, code of conduct, MIT license, `.editorconfig` and
  `.gitattributes` (LF line endings).
- CI (`.github/workflows/ci.yml`): core typecheck, tests and package check; a drift check that
  regenerates `extension/vendor/`; extension syntax checks; demo typecheck, lint, build and
  end-to-end tests.
- Root `package.json` scripts: `npm run check` (all gates), `setup`, `e2e`, `build:extension` and
  `package:extension`.
- Release workflow (`.github/workflows/release.yml`): npm publish with provenance via trusted
  publishing, and a GitHub release with the extension zip.

### Changed

- Production React builds: render-burst, keystroke-loop, state-thrashing and wasted-render insights
  built from renders without timing data are capped at `medium`, get lower confidence and an
  explanatory cause, and carry `metadata.renderCostUnknown`.
- The package is MIT-licensed, ESM-only, declares Node 18 or later, and ships `dist`, `README.md` and
  `LICENSE`. `npm run build` cleans `dist/` and copies the third-party notices into it.
- Extension: disabling a site can also remove its access ("Also remove site access", plus "Remove site
  access"), and reloads the tab only when needed.
- The demo imports core as `performance-engine` (Vite alias and tsconfig `paths`).
- `core/tsconfig.json` enforces `noUnusedLocals` and `noUnusedParameters`.

### Fixed

- A non-finite `maxEvents` no longer unbounds the store (clamped to 100–50,000).
- Events with a non-finite timestamp are rejected.
- Non-finite timer intervals no longer busy-loop.
- A stale (stopped) session handle can no longer clear or pause the live session.
- Errors in the engine's own bookkeeping no longer reject the app's `fetch` or reach `window.onerror`
  through XHR.
- `instrumentReact({ ignore })` RegExps with the `g` or `y` flag now match on every commit.
- `initPerfEngine(null)` is safe, and partial custom-rule insights are filled with defaults.
- Extension: site status refreshes after a reload and a HELLO. The Chrome Web Store and `chrome://`
  pages show a clear "can't run here" banner. "Enabled but no engine yet" offers a Reload button. The
  banner wraps at narrow widths and popovers scroll.
- Extension: full URLs with query strings are no longer kept in session storage.
- Core: `keystroke-render-loop` only fires on text-entry targets (new `UIEvent.editable`), not on
  keyboard shortcuts or arrow-key navigation.
- Core: a response whose request started outside any trace no longer borrows the live interaction's
  trace for its continuation.
- Core: mount-phase renders are no longer counted by the render-burst and keystroke rules.

### Removed

- `docs/PROJECT_OVERVIEW_AND_ARCHITECTURE.md` (it described v0.1). What remains relevant is now in
  [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#17-design-evolution).

## [0.3.0] - 2026-09-27

The first version in this repository's history. It is summarised here from the design documents of
the time.

### Added

- **Causal trace model**: trigger UI events open a trace, every event is stamped with it when it is
  captured, slow handlers keep their trace until the task ends, and requests re-activate their trace
  when the response arrives. Adds `runInTrace`, `runDetached` and `getActiveTraceId`.
- **Automatic React instrumentation** (`instrumentReact`): per-instance render events from the
  DevTools hook, with real durations in development builds, changed props, state and context, and a
  wasted-render flag. The hook is compatible with React DevTools and yields to it. Adds
  `createProfilerOnRender`.
- **Main-thread and interaction tracking**: Long Animation Frames (falling back to `longtask`) with
  script attribution, and Event Timing (INP-style input delay, processing and presentation).
- **Evidence-based analyzer**: 10 rules (`keystroke-render-loop`, `interaction-induced-render-burst`,
  `interaction-render-latency`, `network-blocking-render`, `state-thrashing`, `wasted-render`,
  `slow-interaction`, `long-task`, `slow-component`, `budget-exceeded`), stable insight ids,
  `evidence[]` with noisy-OR confidence, interval-union merging, and rule isolation.
- **Performance budgets** (six, with pass, warn, fail and no-data), a 0 to 100 health score, and trace
  summaries with causal span trees.
- **DevTools protocol v2**: HELLO, SNAPSHOT and RESET, plus commands. Streaming is gated by
  ATTACH/DETACH, so it costs nothing with DevTools closed.
- **Three engine modes**: app, injected (per-site optional host permission, MAIN-world registration
  at `document_start`) and DevTools-only (HAR network, a passive collector, the bundled analyzer).
  Copies coordinate through `globalThis.__PERF_ENGINE_GLOBAL__`, and the app engine wins.
- **DevTools panel**: Overview, Insights, Timeline, Traces, Components, Network and Accessibility
  views. Web Vitals (LCP, INP, CLS, FCP, TTFB) in every mode, a budgets editor, JSON export and import
  (read-only replay), keyboard navigation, and light and dark themes.
- **Accessibility audit**: one unified rule set of 174 rules evaluated by a runtime port of
  eslint-plugin-a11yinspect (89 rules) together with the vendored IBM Equal Access and axe-core
  engines, deduplicated by element identity and filtered by standard (WCAG 2.0, 2.1 or 2.2 at A, AA
  or AAA, Section 508, EN 301 549). Adds `runA11yAudit`, `runIbmAudit`, `runAxeAudit` and
  `mergeA11yReports`.
- **Demo**: a Workspace control surface and a Scenario Lab with one card per issue type, each with a
  fixed version, plus a Healthy control and an Accessibility card.
- Test suites for the engine and accessibility, speed guards (`perf-budget.test.ts`,
  `a11y/__tests__/perf.test.ts`) and benchmarks.

### Changed

- Render tracking became automatic. Manual `trackRender()` remains as a fallback.
- Analysis groups events by `traceId`. Time windows are used only for untagged events.
- Snapshots carry the full insight list, never a "fresh" subset.
- Extension permissions were reduced to `storage` and `scripting`, with host access optional and
  granted per site.

### Removed

- Protocol v1 messages (`INSIGHTS_UPDATE`, `EVENTS_UPDATE`) are no longer produced. The panel still
  accepts them.

## [0.2.0]

Changes were not recorded separately. They are included in the 0.3.0 entry. Known difference: 0.2
and earlier do not register with the engine handoff registry, so an app built with them and an
injected engine both run on the same page.

## [0.1.0]

The initial prototype: DOM, `fetch`/XHR and manual render tracking, a bounded event store (2000
events), six rule-based issue types, and a DevTools panel fed by continuous `INSIGHTS_UPDATE` and
`EVENTS_UPDATE` messages.

[0.4.0]: https://github.com/ezhillragesh/performance-engine/compare/a361c86...HEAD
[0.3.0]: https://github.com/ezhillragesh/performance-engine/tree/a361c86
