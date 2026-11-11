# AGENTS.md

Frontend performance intelligence system: an in-browser telemetry + causal diagnosis stack. Three independent subsystems in one repo (no workspaces: `core/` and `demo/` each `npm ci` on their own; the root `package.json` only holds convenience scripts; CI in `.github/workflows/ci.yml` runs the same gates as `npm run check`):

- `core/` — framework-agnostic TS library (no React dependency), npm package `performance-engine` (MIT, ESM-only, Node >=18, `files` = dist + README + LICENSE): trackers, trace context, user actions, Web Vitals, React fiber instrumentation, bounded store, evidence-based analyzer, budgets, DevTools bridge. Relative imports use explicit `.js` suffixes (Node-ESM-consumable `dist`); keep that convention. `tsconfig.json` enforces noUnusedLocals/noUnusedParameters.
- `demo/` — React 19 + Vite showcase + load generator, static-hostable. Imports core as `performance-engine` via a Vite alias + tsconfig `paths` to `../core/index.ts` (`server.fs.allow: ['..']` still needed). Editing `core/` can break the demo build even when core typechecks.
- `extension/` — Chrome MV3 DevTools extension + toolbar popup, vanilla JS, **no build step**, no npm deps. `extension/vendor/*` is generated from core (`core/inject/*` entries, `npm run build:extension`) — never edit it by hand. Store zip: `npm run package:extension` (root; `scripts/package-extension.mjs` -> `dist-extension/`, no `dev/`).

Contracts (authoritative, keep in sync with code): `docs/PROTOCOL.md` (page ⇄ extension messages), `docs/CORE_API.md` (public API), `core/types/*.ts`. Architecture + features: `docs/ARCHITECTURE.md`; decisions: `docs/adr/` (new significant decision = new ADR, never rewrite an accepted one); docs index: `docs/README.md`; extension user guide + privacy policy: `docs/EXTENSION.md`, `docs/PRIVACY.md` (keep PRIVACY.md true whenever the extension reads or stores something new). User-visible changes go in the top (unreleased) section of `CHANGELOG.md`; commits follow Conventional Commits (`CONTRIBUTING.md`).

## Commands

```sh
npm run setup                    # repo root: npm ci in core/ and demo/
npm run check                    # repo root: ALL gates below, as CI runs them (check:core, check:vendor, check:extension, check:demo)
npm run check:vendor             # scripts/check-vendor.mjs: build:extension, then fail on any drift (modified or untracked) in extension/vendor + THIRD_PARTY_NOTICES.txt
npm run check:extension          # scripts/check-extension.mjs: syntax-checks classic scripts and panel ES modules (automates the manual node --check lines below)
npm run package:extension        # scripts/package-extension.mjs: verify manifest + HTML paths, write dist-extension/perf-intelligence-devtools-<version>.zip
cd core && npm run typecheck     # tsc --noEmit (includes tests)
cd core && npm test              # test:core (vitest, node env) then test:a11y; single file: npx vitest run tests/rules.test.ts ; single test: -t "name"
cd core && npm run test:a11y      # a11y suite only (jsdom, vitest.a11y.config.ts, files run serially); single file: npx vitest run -c vitest.a11y.config.ts a11y/__tests__/aria.test.ts
cd core && npm run bench         # vitest bench (vitest pinned to 4.x — v5 dropped bench)
cd core && npm run build         # cleans dist, tsconfig.build.json (excludes tests/bench/inject/scripts), copies THIRD_PARTY_NOTICES.md into dist
cd core && npm run check:package # build + npm pack + consumer checks (Node w/o DOM, tsc bundler/node16/nodenext, esbuild tree-shaking); also in prepublishOnly
cd core && npm run build:extension # -> extension/vendor/{perf-engine.inject.js,perf-analyzer.mjs,a11y-audit.js,a11y-rules.mjs,ibm-ace.js,ibm-ace.LICENSE.txt,axe.min.js} + extension/THIRD_PARTY_NOTICES.txt (checked in)
cd core && npm run build:a11y      # only the a11y artifacts (scripts/build-a11y.mjs, also callable directly with node)
#   regenerate ALL vendor bundles (build:extension) after ANY core change and commit them (the extension has no build step)
cd demo && npm run lint          # eslint; must stay clean
cd demo && npm run build         # tsc -b && vite build; gate for cross-package TS (delete demo/dist after)
cd demo && npm run dev           # dev server + mock api/* (demo/mock/api.ts via Vite middleware; production build uses a Service Worker, mock/sw.ts)
cd demo && npm run e2e           # Playwright (once: npm run e2e:install): every scenario + Fixed version, dev AND production build; own servers on 5175/5176; CI runs it
# extension classic scripts: node --check background.js contentScript.js devtools/devtools.js
# extension panel ES modules:   node --input-type=module --check < devtools/panel/<file>.js
#   (plain `node --check` silently passes broken ES modules on Node 24)
# extension UI without installing: serve extension/ (python -m http.server) and open /dev/preview.html[?theme=dark|light&mode=app|injected|devtools&state=noengine&perm=deny&site=webstore|blocked&guide=1] or /dev/popup-preview.html
```

Add a core regression test with every core fix. `tests/perf-budget.test.ts` asserts analysis speed (2k events < 50ms median, ~11ms locally) and `a11y/__tests__/perf.test.ts` audit speed (5k elements < 600ms median in jsdom, ~250ms locally, plus a machine-independent linear-scaling check); both can be tight on a heavily loaded machine.

## Data flow

```
trackers (ui / network / render / longtask+LoAF / event-timing / actions)
  -> trace context stamps traceId AT CAPTURE -> bounded store (2000)
  -> buildAnalysisContext (group by traceId; time-window fallback only for untagged events)
  -> rules (analyzer/rules/*) -> Insight{id, evidence[], confidence from evidence} -> merge
  -> budgets + summary + trace summaries (spans with parentId = causal chain)
  -> session (core/session.ts) -> devtoolsBridge (postMessage, only while a panel is ATTACHed)
     (+ web-vitals tracker -> snapshot.vitals; outside the store, lives for the page's lifetime)
  -> contentScript.js -> background.js (per-tab state, chrome.storage.session) -> panel
```

## Core invariants / gotchas

- Never mutate store events during analysis; never infer `traceId` later by time.
- Trace idle clock starts when the triggering task ends (slow handlers must not expire their own trace). A late network response only borrows its trace for the sync continuation and restores the live one.
- Engine/tooling work that renders UI must run via `runDetached` (session does this for tick notifications) or it gets blamed on the user's click.
- `RenderEvent.timestamp` is render **start**; `durationMs` is React `actualDuration` (includes children) — sum `selfDurationMs` for cost, never `durationMs` across nested components.
- Group renders by `instanceId` (N list items ≠ one component thrashing). Wasted = instrumentation `wasted` flag or equal props hashes vs the same instance's previous render — no zero-duration heuristics.
- Insight `id` must stay stable while its window grows (anchor on trigger/first event id).
- Rules scope to a trace (`context.traces`), never global `context.events`. Adding a rule: extend the closed `IssueType` union in `core/types/insights.ts`, register in `analyzer/rules/index.ts` (order matters: keystroke-loop before render-burst; budget-exceeded last), add positive + negative tests.
- React DevTools coexistence (`react/instrumentReact.ts`): when we create `__REACT_DEVTOOLS_GLOBAL_HOOK__` it must stay RDT-compatible and yield to a real RDT installing later (window-scoped `hasOwnProperty` shim + re-chain). The shim may only report the key absent while the hook is still ours with zero renderers — never once React registered. Verify against `react-devtools-core` when touching it (`tests/rdtCoexistence.test.ts` simulates it).
- Instrumentation must never throw into the host app (defensive try/catch; engine bookkeeping errors must not reject the app's fetch or reach `window.onerror` via XHR). `instrumentReact()` must run before `react-dom` loads (demo: `import './perf'` is first in `main.tsx`); render durations are real only in React dev or profiling builds. Render insights without timing data (production builds) are capped at medium, get lower confidence and `metadata.renderCostUnknown`.
- `onInsights`/snapshots always carry the full insight list, never a "fresh" subset.
- Getters (`getInsights` etc.) may re-analyse but never notify subscribers synchronously.
- A stale (stopped) session must never touch the shared store (clear/pause/push); store size is clamped to 100..50 000, non-finite timestamps are rejected.
- Web Vitals (`tracker/webVitals.ts`, `session.getWebVitals()`, snapshot `vitals`) live for the page's lifetime: not in the store, not reset by `clear()`.
- User actions (`trace/actions.ts`: `startAction`/`trackAction`) are recorded only while a sampled session runs; otherwise they just run the callback. `sampleRate`: an unsampled session installs nothing.

## Accessibility audit (core/a11y)

- The UI (panel + demo) shows ONE unified rule set, `a11y/catalog/unified.ts` (174 rules, our own titles / help, WCAG criteria, tags). It is evaluated by three engines that are never named in the UI: the A11yInspect port, IBM Equal Access (`ibm.ts`) and axe-core (`axe.ts`); `unify.ts` `mergeA11yReports` folds their engine-level reports into it (one finding per element + unified rule, hidden `sources`) and applies the standard (`wcag.ts`). Only `THIRD_PARTY_NOTICES` (panel footer "Open-source credits") names the projects.
- Dedupe is by **element identity**, never by selector strings: every adapter records `node` (per-page key from `sourceUtil.nodeKey`, one registry per bundle), `pos` (composed-tree position: document order + ancestry without a DOM) and one canonical `selector` (our `uniqueSelector`, else our `canonicalXPath` for shadow / frame nodes; never axe's `host >>> inner`). The merge then collapses the same problem reported twice via the policy tables in `catalog/unified.ts`: `PAGE_RULES` (html/head/body of the top document = the page), `SUBSUMED_BY` (same element, one rule covers the other), `NESTED_POLICY` (same rule on an element and its descendant: keep outer / inner), `NESTED_INTO` (an icon inside an unnamed control), plus `REFINE` / `CHECK_REFINE` for source rules broader than one unified rule. When a new duplicate pair shows up, fix it there with a regression test in `dedupe.test.ts` (use the concrete source ids). Findings are ordered impact, kind, rule (catalog order), then document order. `panel-list.test.ts` runs the real panel view + vendored engines in jsdom (needs current vendor bundles).
- 89 rules / 227 messageIds ported from BarrierBreak eslint-plugin-a11yinspect (MIT, `THIRD_PARTY_NOTICES.md`); one element walk with per-tag dispatch (`engine.ts`), rules in `a11y/rules/*`, message/WCAG metadata in `catalog.ts`/`meta.ts`. Every rule needs positive + negative tests in `a11y/__tests__` (`coverage.test.ts` checks all messageIds are exercised).
- IBM `accessibility-checker-engine` and `axe-core` are pinned exact core devDependencies and vendored UNCHANGED (`extension/vendor/ibm-ace.js`, `axe.min.js`; generated header, license banners kept) — never hand-port or edit their rules. They are injected wrapped (`loaders.ts`) so page globals (`window.ace`, `window.axe`, AMD `define`) are never clobbered. Tests run the real engines in jsdom (`ibm.test.ts`, `axe.test.ts`, `unify.test.ts`); contrast needs real layout (review in jsdom), check it in Chrome.
- Upgrading an engine: bump the exact version in `core/package.json` (and `demo/package.json`), update `IBM_ACE_VERSION` / `AXE_CORE_VERSION` in `a11y/loaders.ts` (build:a11y refuses a mismatch), `npm install`, `npm run build:extension`, `npm test`. `unified-coverage.test.ts` lists new source ids that have no unified rule and stale ones: map each new id into an existing unified rule in `catalog/unified.ts` (or add a rule in our own words), rerun. Unmapped ids still work at runtime (fallback rule "other"). Update the version/copyright lines in `THIRD_PARTY_NOTICES.md` and rebuild (it is copied to `extension/THIRD_PARTY_NOTICES.txt`).
- **No PII**: findings carry rule ids, a CSS path (ids, tag names, `:nth-of-type` only; XPath for shadow/frame nodes) and a redacted opening-tag snippet (value-like attributes redacted, URL queries stripped; IBM/axe snippets are regenerated from the live element or `snippetFromMarkup`). Never put form values, input text, free page text or vendor messages / message args into a finding (`detail` is non-PII context such as an attribute name or a contrast ratio). Single exception: `name`, a ≤60-char preview of what the element says (aria name / alt / text) that tells identical-looking rows apart; `namePreview` returns "" for form fields and options, anything inside or containing a field or contenteditable, the page root and large containers.
- Read text with `textContent` only (never `innerText`, which forces layout), and never mutate the audited DOM except the `A11Y_IGNORE_ATTR` highlight overlay. The audit never throws (per-rule try/catch, time and findings budgets).
- `browser.ts` is the only file with side effects (installs `window.__PERF_INTEL_A11Y__`, incl. `start/poll/cancel` for the async engines); it is excluded from the npm build. `core/index.ts` re-exports only named, side-effect-free API. `inject/a11yRules.ts` -> `vendor/a11y-rules.mjs` is the DOM-free half the panel imports (catalog, WCAG table, merge, wrappers).

## Demo

- Deliberate performance problems live ONLY in `demo/src/scenarios/` (marked INTENTIONAL); each Scenario Lab card targets one issueType and has a "Fixed version" that must NOT produce it; the Healthy control must produce zero insights. Exception: the "Accessibility issues" card (`catalog.ts` `detect: "a11y"`) expects no perf insight; its badge lazily imports `scenarios/a11yAudit.ts`, which runs all three engines on the card element (detached; engines loaded as lazy `?raw` chunks) and merges them into the unified rules. The Fixed version must have zero errors and warnings ("needs review" items are listed, not counted). Keep the engines out of the main bundle. The Workspace tab is the "reasonably performant" control surface — don't add jank there.
- `EngineStatus` is excluded from `instrumentReact` and must not select values its own renders feed (feedback loop).
- Mock API: one deterministic handler (`mock/api.ts`), two transports — Vite middleware in dev (`server/mockApi.ts`), Service Worker `mock-api-sw.js` (from `mock/sw.ts`, registered by `src/lib/api.ts` before first render) in the build; requests stay real fetches. Production build = React profiling build + esbuild keepNames (`DEMO_REACT_PROFILING=0` for plain production; `DEMO_BASE` for sub-path hosting).
- New Scenario Lab card: register in `catalog.ts` + `ScenarioLab.tsx` AND in `CASES` in `e2e/scenarios.spec.ts`. The demo chrome must stay accessible (zero audit errors, both themes). Non-user updates run detached; navigation uses `trackAction('Open …', { newTrace: true })`.
- Lint: react-hooks v7 strict (no sync setState in effects, no refs during render, exact deps); react-refresh only-export-components; `noUnusedLocals`/`noUnusedParameters` fail the build.

## Extension

- Views: one row in the `VIEWS` array in `devtools/panel/main.js` (`{ id, label, icon, create }`) derives the tab, panel, keyboard shortcut (1-9 by position) and dirty tracking. A view is `create(ctx) => { el, render(topic), focusSearch?, clearSearch? }` (`ctx = { store, actions, statusEmpty }`); it must handle every mode (`store.mode`: app / injected / devtools / imported; `store.readOnly` for imported bundles). Styles for a big view go in their own CSS file linked from `devtools/panel.html` and `dev/preview.html`. The Accessibility view (7) owns its data (audits via `inspectedWindow.eval`), exposes `getReport()` for Export and `onNavigated()` (called from main.js). It must never render engine names, vendor messages or vendor help URLs (W3C Understanding links only); `sources` stay hidden.
- Preview harness (`dev/`): `mock-chrome.js` routes non-collector `inspectedWindow.eval` calls into an off-screen iframe of `dev/a11y-fixture.html` (deliberately broken markup, page-owned `ace`/`axe` globals), so the Accessibility tab runs the real `vendor/a11y-audit.js`, `ibm-ace.js` and `axe.min.js`.
- Popup (`popup/`, classic script, no extra permissions): per-site status + Enable/Disable/Remove access; talks to background via runtime messages and to the content script via `PAGE_INFO` (origin + title only). Preview: `dev/popup-preview.html` + `dev/mock-popup.js`.
- `devtools/panel/report.js`: "Copy as Markdown" (insight) / "Copy summary" (Overview); URLs reduced to origin+path. Never store full URLs with query strings in `chrome.storage.session`.
- The `<all_urls>` relay content script is kept deliberately (app-mode pages must work without any grant); reasoning in `docs/PRIVACY.md`. Don't widen what it reads.
- Never use `innerHTML` with page data — page payloads are untrusted; all validation is in `devtools/panel/validate.js` (caps + drop malformed items). Keep it in sync with `core/types`.
- Only top-frame messages accepted. Permissions: `storage`, `scripting` + `optional_host_permissions: ["<all_urls>"]` (granted per site only when the user enables injection) — don't add more without need.
- Two core copies can share a page (app bundle + injected bundle): they coordinate via `globalThis.__PERF_ENGINE_GLOBAL__`; app always wins (docs/PROTOCOL.md "Engine modes"). Module-level state is per copy — never assume a singleton across bundles.
- MV3 service worker can die anytime: background persists per-tab state to `chrome.storage.session` (global LRU budget), panel auto-reconnects. Streaming is ATTACH/DETACH-gated so pages pay nothing when DevTools is closed; orphaned streams are DETACHed by background/content script.
