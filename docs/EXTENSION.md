# Perf Intelligence DevTools: user guide

A Chrome DevTools panel that explains why an interaction was slow: which click caused which requests, long tasks and React renders, which of them matter, and how to fix them. It also shows Web Vitals and runs an accessibility audit. It works on any website. Apps that bundle the `performance-engine` package get the most data.

Wire format and internals: [PROTOCOL.md](./PROTOCOL.md). What the extension reads and stores: [PRIVACY.md](./PRIVACY.md).

## Install

**From source (unpacked):**

1. Clone the repository. The extension has no build step: `extension/vendor/*` (the engine and audit bundles) is checked in.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the `extension/` folder.
3. Optional: pin **Perf Intelligence** from the Extensions (puzzle) menu so its toolbar button is visible.
4. Open DevTools on any page (`⌥⌘I` on macOS, `Ctrl+Shift+I` elsewhere) and choose the **Perf Intelligence** tab (it may be under `»`).

After pulling changes, click the reload icon on the extension's card in `chrome://extensions`, then close and reopen DevTools.

**Store zip:** `npm run package:extension` (or `node scripts/package-extension.mjs`) writes `dist-extension/perf-intelligence-devtools-<version>.zip` without the dev-only preview harness, after checking that every file the manifest references exists. Requires the `zip` command.

Requirements: Chrome 116 or later (any Chromium browser with MV3 DevTools extensions).

## The three modes

The panel picks the best source for the inspected page on its own. The badge next to the status in the toolbar shows which one is active; click it for **Site settings**. The **?** button (or the `?` key) opens a short guide to the modes.

| Mode | Badge | How you get it | What you see |
|------|-------|----------------|--------------|
| DevTools only | orange, "DevTools only · limited" | Nothing to do: any http(s) page | Network (from DevTools), long tasks / long animation frames with script attribution, interactions (Event Timing), Web Vitals, accessibility audit, and the insights the analyzer can derive from that data. No causal traces, no React renders, no component stats |
| Injected engine | blue, "Injected engine" | **Enable on this site** (panel banner, Site settings, an empty Traces / Components view, or the toolbar popup). Chrome asks for access to that one site; the page reloads with the engine injected at page start | Everything above plus causal traces (click → requests → long tasks → renders), React renders and wasted renders on React sites, render insights, engine-measured Web Vitals with attribution |
| App engine | green, "App engine" | The app bundles `performance-engine` and calls `initPerfEngine()` (see **How to install in your app** in the panel, or `core/README.md`) | Full data on every load without granting anything. Render timings in React development builds. An app engine always wins over an injected one |

React production builds: renders, wasted renders and component counts are exact, but React does not measure render time there (shown as 0 ms, with a note) and component names are usually minified. Use a development or profiling build for render cost.

## Site access: enable, revoke, troubleshoot

- **Enable:** click **Enable on this site**. Chrome shows "Allow Perf Intelligence to read and change data on <site>?". Accept, and the page reloads with the engine. Access is per origin (`https://shop.example.com` does not cover `https://www.shop.example.com`).
- **No prompt from DevTools?** Chrome sometimes does not show permission prompts from inside DevTools. Click the **Perf Intelligence toolbar button** and choose **Enable on this site** there. The open panel picks it up after the reload. If you grant the site any other way within 5 minutes of clicking Enable (for example from the Extensions menu), injection is switched on automatically.
- **Enabled but no engine:** the banner says "Injection is enabled on this site, but its engine hasn't started on this page yet". Click **Reload page**. This happens when you enabled the site from another tab, or the page was open before.
- **Disable:** Site settings (click the badge) or the toolbar popup → **Disable on this site**. "Also remove site access" (on by default) also makes Chrome forget the permission. The page reloads without the engine.
- **Remove site access only:** shown in Site settings and the popup when access is granted but injection is off.
- Removing the site from `chrome://extensions` → Details → Site access also stops injection there.
- **Pages extensions can't touch:** `chrome://` pages, other extensions, the Chrome Web Store and (unless you allow it in the extension's details) `file://` URLs. The panel shows a red banner and disables Enable. The toolbar popup says "Can't reach this page".
- **App mode shows nothing / toolbar popup says "Can't reach this page" on a normal site:** reload the tab. Tabs opened before the extension was installed, updated or reloaded have no relay content script yet. If you restricted the extension's site access to "On click" in `chrome://extensions`, the relay can't run either: allow it on the site.

## The toolbar popup

Click the Perf Intelligence button in Chrome's toolbar to see, for the active tab: the site, which engine runs there (app, injected, none) with its version and whether React was detected, the last health score and insight counts (when a DevTools panel streamed data for that page), and buttons to enable, disable or remove site access. It is the reliable place to grant access.

## Panel views

Keys `1`–`7` switch views, `/` focuses the current view's search, `Space` pauses / resumes recording, `Esc` clears search or closes a dialog, arrow keys and `Enter` move through lists, `?` opens the guide.

1. **Overview:** health score, interaction p75, renders, long tasks, requests, insight counts, Web Vitals (LCP, INP, CLS, FCP, TTFB with good / poor thresholds; with an engine, an **INP trace** link opens the slowest interaction's trace), activity sparkline, budgets, top components, top requests. **Copy summary** puts a Markdown performance report (score, metrics, vitals, budgets over limit, top insights) on the clipboard for an issue or pull request.
2. **Insights:** the analyzer's findings with severity, category, cause, suggested fix, confidence and the evidence behind it. Filter by severity / category, sort, search. **Show in timeline**, **Open trace**, and **Copy as Markdown** (an issue-ready report of that insight: severity, cause, fix, evidence table, ids, page origin and path).
3. **Timeline:** interactions, main thread, network and renders on one time axis. Ctrl/⌘ + wheel zooms, Shift + wheel or drag pans, drag the time axis to zoom to a range, click an event for details.
4. **Traces:** one row per causal trace (trigger, duration, latency, renders, requests, long tasks; named actions from `trackAction()` / `startAction()` are shown next to the trigger) and a span waterfall with linked insights. Needs an engine.
5. **Components:** renders, mounts, wasted renders and render cost per component. Click a row to filter insights by it. Needs an engine.
6. **Network:** requests with status, duration, size and the trace that triggered them. Filter failed requests.
7. **Accessibility:** audits the live DOM (no engine needed) against WCAG 2.0 / 2.1 / 2.2 A / AA / AAA, Section 508 or EN 301 549, with "Needs review" items and best practices as options. **Live** re-audits as the page changes. Each finding has how-to-fix guidance, WCAG links, **Highlight on page** and **Inspect in Elements**.

Toolbar: **Pause / Record**, **Clear**, **Export**, **Import**, **Budgets**, **?**.

- **Budgets:** limits for interaction latency, long tasks, component render time, renders per interaction, request duration and wasted render share. Saved in the extension and re-applied to every page.
- **Export** downloads a JSON bundle (snapshot, insight history, Web Vitals, the last accessibility audit). **Import** opens one read-only: every view works on it, live-only actions (rescan, inspect, budgets, site access) are disabled. **Return to live** goes back.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Extension was updated — close and reopen DevTools" | The extension was reloaded. Close DevTools and open it again |
| Status stays "Waiting for engine…" then switches to DevTools only | No engine on the page. Expected without app integration or injection. Enable the site for full data |
| "Disconnected" | The background service worker restarted. The panel reconnects by itself within a few seconds and replays the last data |
| Injected mode on a page that also bundles the package | The app engine takes over (green badge). Expected |
| No Web Vitals | The page has not painted yet or the browser does not support the entry type (INP needs an interaction) |
| Insights say "unavailable" in DevTools-only mode | `extension/vendor/perf-analyzer.mjs` is missing. Rebuild: `cd core && npm run build:extension` |

## Developing the extension

- No build step: edit files under `extension/` and reload the extension. Never edit `extension/vendor/*` (generated from `core/` by `cd core && npm run build:extension`).
- Preview without installing: serve `extension/` (for example `cd extension && python3 -m http.server 8080`) and open `/dev/preview.html` (`?theme=dark|light`, `?mode=app|injected|devtools`, `?state=noengine`, `?perm=deny`, `?site=webstore|blocked`, `?guide=1`) or `/dev/popup-preview.html` (`?mode=app|injected|devtools|enabled|unreachable|webstore`, `?theme=`). The panel preview runs the real accessibility engines against `dev/a11y-fixture.html`.
- Syntax gate: `node scripts/check-extension.mjs` from the repository root.
