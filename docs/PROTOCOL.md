# Perf Engine ⇄ DevTools Protocol (v2)

Single source of truth for data crossing the page / extension boundary.
Types referenced here live in `core/types/events.ts` and `core/types/insights.ts`.

## Transport

```
page (core/bridge/devtoolsBridge.ts)
  window.postMessage(PageMessage, window.location.origin... "*")
    -> extension/contentScript.js   (validates source === "perf-engine", top frame only)
      -> chrome.runtime.sendMessage({ type: "PERF_MESSAGE", payload: PageMessage })
        -> extension/background.js  (stores latest per tabId in memory + chrome.storage.session)
          -> port "devtools" -> extension/devtools/panel

panel command
  port.postMessage({ type: "PANEL_COMMAND", tabId, command, payload })
    -> background.js -> chrome.tabs.sendMessage(tabId, { type: "PANEL_COMMAND", command, payload }, { frameId: 0 })
      -> contentScript.js -> window.postMessage(PanelCommandMessage, "*")
        -> core bridge executes it
```

## Page -> extension (`PageMessage`)

Every message: `{ source: "perf-engine", version: 2, type, payload, timestamp }` where `timestamp` is `performance.now()`.

| type | payload | when |
|------|---------|------|
| `HELLO` | `{ sessionId, engineVersion, url, title, timeOrigin, config: { trackEvents, trackNetwork, trackRenders, trackLongTasks, trackInteractions, react, mode? } }` | on bridge start (injected mode: after `DOMContentLoaded`, see "Deferred HELLO"), and in reply to `PING` |
| `SNAPSHOT` | `PerfSnapshot` (below) | only while attached: throttled (default every 1000ms) **only when data changed**, plus on `REQUEST_SNAPSHOT` / `ATTACH` |
| `RESET` | `{ sessionId }` | after `clear` command or new session |

```ts
interface PerfSnapshot {
  sessionId: string;
  engineVersion: string;
  capturedAt: number;          // performance.now()
  timeOrigin: number;          // performance.timeOrigin (epoch ms) for wall-clock display
  paused: boolean;
  insights: Insight[];         // full current list (never the deduped "fresh" subset)
  events: TrackedEvent[];      // most recent N (default 1500), sorted by timestamp
  droppedEvents: number;       // events trimmed from the store since session start
  traces: TraceSummary[];      // most recent 100
  summary: SessionSummary;
  budgets: PerformanceBudgets;
}
```

Legacy v1 messages (`INSIGHTS_UPDATE`, `EVENTS_UPDATE`) may still be accepted by the panel for backward compatibility but are no longer produced.

## Extension -> page (`PanelCommandMessage`)

`{ source: "perf-engine-devtools", version: 2, type: "COMMAND", command, payload? }`

| command | payload | effect |
|---------|---------|--------|
| `PING` | – | page replies `HELLO` (used to detect "no engine on this page") |
| `ATTACH` | – | a DevTools panel is open for this tab: bridge starts streaming `SNAPSHOT`s and replies with one immediately |
| `DETACH` | – | last panel closed: bridge stops streaming (HELLO still answered). Zero overhead when DevTools is closed. |
| `REQUEST_SNAPSHOT` | – | page replies `SNAPSHOT` immediately |
| `CLEAR` | – | clears store + insights, replies `RESET` then `SNAPSHOT` |
| `PAUSE` / `RESUME` | – | stops/starts recording (trackers stay installed, events dropped while paused) |
| `SET_BUDGETS` | `Partial<PerformanceBudgets>` | updates budgets, re-analyses, replies `SNAPSHOT` |

## Background <-> panel (port name `devtools`)

Panel -> background: `DEVTOOLS_INIT { tabId }`, `REQUEST_SNAPSHOT`, `PANEL_COMMAND { command, payload }`.
Background also sends `ATTACH` to the tab when its first panel port connects and `DETACH` when its last port disconnects — and whenever a `SNAPSHOT` arrives for a tab with no connected panel (a stream orphaned by a service-worker restart). An orphaned content script (extension reloaded/updated) posts `DETACH` to the page when it tears down. When a `HELLO` arrives (e.g. page reloaded while DevTools is open) and the tab has a connected panel, background resets that tab's stored state if the `sessionId` changed and immediately sends `ATTACH` back so streaming resumes.

Background -> panel: `PERF_MESSAGE { payload: PageMessage }`, `TAB_NAVIGATED { url }`, `CONNECTION { engineDetected: boolean }`.

## Invariants

- `RenderEvent.timestamp` is the render *start*; `commitTime` (optional) is when its commit was applied. Draw renders as `[timestamp, timestamp + durationMs]`. `durationMs` includes children (React `actualDuration`); use `selfDurationMs` for per-component cost.
- A `long-animation-frame` long-task event with `blockingDuration` 0 is a long frame, not a long (blocking) task.
- The HELLO `config` may be re-sent (same `sessionId`) when it changes after start, e.g. `react` becomes true once React registers.

- All timestamps are page-relative monotonic ms. Wall clock = `timeOrigin + timestamp`.
- Everything page-provided is untrusted: the panel must render strings with `textContent`, never `innerHTML`.
- Only messages from the top frame (`sender.frameId === 0`) are accepted.
- Tab state is cleared on navigation (`chrome.tabs.onUpdated` status `loading` with a URL change) and on tab close.

## Engine modes & DevTools-only layer (v2.1)

The panel works in three modes. `HELLO.config.mode` tells the panel which engine it's talking to.

| Mode | Source | `HELLO.config.mode` |
|------|--------|---------------------|
| App engine | Page bundles core and calls `initPerfEngine` | `"app"` |
| Injected engine | Extension injects `extension/vendor/perf-engine.inject.js` (core bundle, IIFE) into the page MAIN world at `document_start` for sites the user enabled | `"injected"` |
| DevTools only | No engine; panel builds data itself from DevTools APIs | – (no HELLO) |

### Handoff between two engine copies

Every core copy registers `globalThis.__PERF_ENGINE_GLOBAL__ = { kind: "app" | "injected", sessionId, stop }` when a session starts. `initPerfEngine` stops a session registered by *another* copy before starting its own, so an app engine always replaces an injected one and only one bridge ever talks to the extension. The injected bundle does nothing if an `"app"` engine is already registered.

### Injection control (panel ⇄ background, port `devtools`)

Panel → background messages are flat: `{ type, tabId, origin, removePermission?, payload: { origin } }` (`payload` is a legacy copy; background reads the top-level `origin`). `origin` must be exactly `http(s)://host[:port]` (no path, query, hash or credentials), otherwise bg replies at once with `error: "invalid-origin"`.

| Message | Direction | Fields | Effect |
|---------|-----------|--------|--------|
| `INJECTION_STATUS_REQUEST` | panel → bg | `origin` | bg replies `INJECTION_STATUS` |
| `ENABLE_INJECTION` | panel → bg | `origin` | Panel first calls `chrome.permissions.request({ origins: [origin + "/*"] })` in the click handler (user gesture). bg checks the permission, then `chrome.scripting.registerContentScripts` (id `perf-inject:<origin>` with non `[A-Za-z0-9.-]` chars hex-escaped, `world: "MAIN"`, `runAt: "document_start"`, `persistAcrossSessions: true`), reloads the tab, replies `INJECTION_STATUS`. Without the permission nothing is registered and the reply has `enabled: false` |
| `DISABLE_INJECTION` | panel → bg | `origin`, `removePermission?: boolean` | Unregisters the script; when `removePermission === true` also `chrome.permissions.remove`s the site's host permission (failures ignored). Reloads the tab, replies `INJECTION_STATUS` |
| `INJECTION_STATUS` | bg → panel | see below | Reply to each of the above |

`INJECTION_STATUS` is a flat message (no `payload` wrapper):

```ts
{ type: "INJECTION_STATUS", origin: string, enabled: boolean, granted: boolean, error?: string }
```

- `enabled` = a content script is registered for the origin; `granted` = the host permission is present. Both are re-read after the change, so they are authoritative even when it failed.
- `error` (max 300 chars) is set only when the change threw (e.g. `registerContentScripts` failed) or the origin was invalid (`"invalid-origin"`). The panel shows it verbatim (textContent).
- Changes are serialized in bg (duplicate script ids throw). The panel still accepts a payload-wrapped reply (`{ type, payload: { origin, enabled, granted } }`) and ignores replies whose `origin` is not the current page's.
- Revoking site access elsewhere (`chrome.permissions.onRemoved`) also unregisters injection for that origin.

### Deferred HELLO (injected mode)

The injected bundle starts its bridge with `deferInitialHello` (`core/bridge/devtoolsBridge.ts`): while `document.readyState === "loading"` it sends **no** HELLO and **ignores every panel command** (PING, ATTACH, …). After `DOMContentLoaded` (in a `setTimeout(0)`, so after the page's own DOMContentLoaded handlers) it sends the initial HELLO with `config.mode: "injected"`; background then sends ATTACH as for any HELLO. If an app engine starts during parsing, it replaces the injected session first, so the panel only ever sees the app engine. Consequences for the panel: in injected mode the first HELLO can arrive up to the page's parse time after navigation (the panel's no-engine timeout only switches to DevTools-only data, which the later HELLO replaces), and a PING sent during parsing is never answered.

Manifest: `permissions: ["storage", "scripting"]`, `optional_host_permissions: ["<all_urls>"]`. No site access is granted until the user enables a site.

### DevTools-only layer (always on in the panel)

- **Network:** `chrome.devtools.network.getHAR()` on start plus `onRequestFinished`. Each HAR entry maps to a `NetworkEvent` with `timestamp = Date.parse(startedDateTime) - timeOrigin`, `duration = entry.time`, `fromCache` from `_fromCache`, `responseSize` from `_transferSize`/`bodySize`, url through `sanitizeUrl`, `eventId = "har-<n>"`, `sessionId = "devtools"`.
- **Page collector:** the panel installs a small passive collector via `chrome.devtools.inspectedWindow.eval` (not subject to page CSP). It installs buffered `PerformanceObserver`s for `long-animation-frame` (fallback `longtask`), `event` (`durationThreshold: 16`), `largest-contentful-paint`, `layout-shift`, `paint` and `navigation`, into bounded ring buffers on `window.__PERF_INTEL_COLLECTOR__` (idempotent, versioned). The panel polls it via `eval` every ~1.5s with a cursor, maps entries to `LongTaskEvent` / `InteractionEvent`, and reads Web Vitals.
- **Web Vitals** (shown in every mode): LCP (good ≤ 2500 ms, poor > 4000), INP (≤ 200, > 500), CLS (≤ 0.1, > 0.25), FCP (≤ 1800, > 3000), TTFB (≤ 800, > 1800).
- **Analysis:** with no engine, the panel runs the bundled analyzer (`extension/vendor/perf-analyzer.mjs`, ESM build of core: `analyzeEvents`, `buildAnalysisContext`, `computeSummary`, `buildTraceSummaries`, `resolveBudgets`, `DEFAULT_BUDGETS`, `sanitizeUrl`, `ENGINE_VERSION`) over the DevTools-layer events and builds a synthetic `PerfSnapshot`. Traces and Components views show an "Enable on this site" call to action instead.
- With an engine present, engine data wins; the DevTools layer only contributes Web Vitals.

### Accessibility audit (v2.3, panel-only)

The Accessibility tab needs no engine and works in every mode. It presents one **unified rule set**
(`core/a11y/catalog/unified.ts`, 174 rules) evaluated by three internal engines; the UI never names
them. All page access goes through `chrome.devtools.inspectedWindow.eval`:

1. `extension/vendor/a11y-audit.js` (IIFE build of `core/a11y/browser.ts`) defines
   `window.__PERF_INTEL_A11Y__ = { version, run(options), highlight(selector, node?), clearHighlight(), find(selector, node?),
   watch(), unwatch(), consumeDirty(), state(), engines(), runIbm(options), runAxe(options), start(engine, options),
   poll(token), cancel(token), merge(reports, options) }` (idempotent; replaced when `version` differs; re-installed
   after navigation). `run()` returns the built-in engine's JSON-safe engine-level `A11yReport` synchronously.
2. On demand (probe `ENGINES_PROBE_EXPR` first; cached source per panel), the panel fetches
   `vendor/axe.min.js` / `vendor/ibm-ace.js` and evals them **wrapped** by `wrapAxeSource` / `wrapAceSource`
   (`core/a11y/loaders.ts`, vendored in `vendor/a11y-rules.mjs`). They install `window.__PERF_INTEL_AXE__ = { axe, version }`
   and `window.__PERF_INTEL_ACE__ = { ace, version }` and leave any page-owned `window.axe` / `window.ace` (and AMD
   `define`) untouched. A page-provided `ace` / `axe` object is used only if ours is absent.
3. `inspectedWindow.eval` cannot await promises, so the other engines run through
   `start("axe" | "ibm", { standard }) -> token` (the scan starts in a `setTimeout`, so the start eval returns at once),
   `poll(token) -> { state: "running", elapsedMs } | { state: "done", elapsedMs, report } | { state: "error", error } | { state: "unknown" }`
   (every 250 ms; a poll blocks while the page is busy scanning), and `cancel(token)` (drops the result; the IBM scan is
   synchronous and cannot be interrupted). Order: built-in first (shown immediately), then axe, then IBM.
4. The panel validates each engine report (`validateReport` in `views/accessibility.js`) and merges them itself with
   `mergeA11yReports(reports, { standard })` from `vendor/a11y-rules.mjs` (one finding per element + unified rule).
   Findings are keyed by the element's `node` key (the same element gets the same key in all three engine reports of a
   page load), not by selector strings; the panel keeps `node` / `pos` / `name` through validation. Each rescan, Live
   re-audit or standard switch rebuilds the list from the latest engine reports (never appends).

`A11yReport` (`core/a11y/types.ts`), fields added in v2.3:

- findings: `kind: "error" | "warning" | "review"` ("Needs review" = possible issue); unified findings have
  `ruleId` = unified rule id, `message` = the rule's title (our own wording), `help` = our how-to-fix,
  `criteria: string[]` (all WCAG criteria of the rule; `wcag`/`level` = the first in the standard),
  `bestPractice?: true`, `xpath?` (shadow DOM / frame findings without a document CSS path: our own XPath, also used as
  `selector`), `node?` (per-page element key, hidden), `pos?` (composed-tree position such as `"1.2.4.1"`, hidden: document
  order and ancestry for the merge), `name?` (≤60-char text / accessible-name preview shown on the row; never from form
  fields or contenteditable content), and the hidden
  **`sources: [{ engine: "a11yinspect" | "ibm" | "axe", rule, check?, kind }]`** (never rendered; for exports and
  debugging). Engine-level findings carry `engine` instead.
- report: `counts.reviews`; engine-level `engine`, `sourceRules` (source rule ids that ran); unified `standard`
  (`{ profile: "wcag" | "section508" | "en301549", version: "2.0" | "2.1" | "2.2", level: "A" | "AA" | "AAA",
  bestPractices, includeReview }`), `rulesChecked` (unified rule ids that ran) and `engines: [{ engine, version,
  durationMs, findings, error? }]` (internal timings, not rendered).

"Inspect in Elements" evals `inspect(__PERF_INTEL_A11Y__.find(selector, node))` (the exact element while its node key is
still connected, else the CSS selector or XPath); "Highlight on page" calls `highlight(selector, node)`. Findings carry only rule ids, a CSS path / XPath, a redacted opening-tag snippet,
non-PII detail (attribute names, contrast ratios) and the short `name` preview of non-form elements: form values,
input and contenteditable text never leave the page. Help links are W3C
"Understanding WCAG 2.2" pages only.

Export bundles (`format: "perf-engine-devtools-export"`, `version: 2`) carry the last live **unified** audit as optional
`a11y: A11yReport | null` (with `standard`, `rulesChecked`, `engines` and each finding's hidden `sources`). An imported
bundle shows it read-only (no rescan / inspect) with its own standard; older exports (engine-level A11yInspect
findings) are folded into the unified rules on import. The import validator caps `sources` (12 per finding),
`criteria` (8), `sourceRules` / `rulesChecked` (600) and `engines` (6), and drops unknown engine ids.

`extension/vendor/*` (`perf-engine.inject.js`, `perf-analyzer.mjs`, `a11y-audit.js`, `a11y-rules.mjs`, plus unchanged copies of `ibm-ace.js` (+ `ibm-ace.LICENSE.txt`) and `axe.min.js` from the pinned core devDependencies) and `extension/THIRD_PARTY_NOTICES.txt` are generated by `cd core && npm run build:extension` (esbuild / copy) and checked in, so the extension still loads unpacked without a build step. Regenerate it after any core change.
