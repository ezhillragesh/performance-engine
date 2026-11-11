# Privacy policy: Perf Intelligence DevTools

Applies to the Chrome extension "Perf Intelligence DevTools" (`extension/` in this repository), version 0.4.0 and later. Last updated: 2026-11-11.

## Summary

Perf Intelligence is a developer tool. Everything it measures stays in your browser. It has no server, no account, no analytics, no telemetry, no ads, and it never sends data anywhere. The only things that leave your machine are files you export yourself and text you copy yourself.

## What the extension reads

Only while you use it, and only on the tab you inspect:

| Source | What | When |
|--------|------|------|
| The perf engine inside the page (your app's own copy, or the one you injected on a site you enabled) | Performance events: interactions (CSS-like target descriptors such as `button#save`, short labels), long tasks with script attribution, network requests (sanitized URL: path plus query parameter **names**, no values), React render timings and component names, Web Vitals, computed insights | Streamed only while a Perf Intelligence DevTools panel is open for that tab |
| Chrome DevTools APIs (`chrome.devtools.network`, `chrome.devtools.inspectedWindow`) | Request timings and sizes, Performance API entries (long tasks / frames, event timing, paints, layout shifts), page origin, URL and title | Only while the panel is open |
| The page DOM, for the accessibility audit | Element tag names, ids, ARIA attributes, a CSS path, a redacted opening tag, a ≤ 60-character text preview of non-form elements | Only when you run or enable the audit in the Accessibility tab |
| The relay content script | `location.origin` and `document.title` of the active tab | Only when you open the toolbar popup |

The extension never reads form field values, input text, contenteditable content, cookies, storage of the page, request or response bodies, or request headers. Page URLs in reports and exports are reduced to origin and path (no query string or fragment).

## What is stored, where, and for how long

All storage is local to your Chrome profile (`chrome.storage`, the panel's own `localStorage`). Nothing is synced.

| Storage | Content | Lifetime |
|---------|---------|----------|
| `chrome.storage.session` | Per tab: the engine's last HELLO and snapshot (trimmed), page URL (origin and path), so the panel survives the background service worker restarting. Pending "Enable on this site" requests (origin, tab id) for at most 5 minutes | Cleared when the tab closes or navigates, and when Chrome exits |
| `chrome.storage.local` | Your performance budgets, which sites have the injected engine enabled (origins only), whether you have seen the "Getting started" guide | Until you change them or remove the extension |
| Panel `localStorage` | Your chosen accessibility standard (for example WCAG 2.2 AA) | Until you remove the extension |

## What leaves your browser

Nothing, unless you do it:

- **Export** writes a JSON file to your disk (snapshot, insight history, Web Vitals, last accessibility audit). It contains the same sanitized data the panel shows. Review it before sharing.
- **Copy as Markdown / Copy summary** puts a text report on your clipboard (insight details, metrics, page origin and path).

The extension makes no network requests of its own. It loads only its own packaged files.

## Permissions and why they are needed

| Permission | Why |
|------------|-----|
| `storage` | Keep per-tab state across service-worker restarts, your budgets and the list of sites you enabled (see above) |
| `scripting` | Register the injected engine (`vendor/perf-engine.inject.js`) as a content script, only on sites you enable |
| `optional_host_permissions: <all_urls>` | Requested **per site** at runtime, only when you click "Enable on this site". Chrome asks you first, for that one site. You can remove it from Site settings in the panel, from the toolbar popup, or from `chrome://extensions` |
| Content script on all pages (`contentScript.js`) | A ~70-line relay. It forwards messages that a perf engine already running in the page posts with `source: "perf-engine"` to the panel, forwards panel commands back, and answers the toolbar popup with the page's origin and title. It reads nothing else, injects nothing and changes nothing on the page. Chrome lists it as "Read and change your data on all websites" at install |

### Why the relay is declared for all pages

Apps that bundle the engine through the npm package (app mode) must work on any origin, including `localhost` and staging hosts, without asking for site access first. Messages from the page reach an extension only through a content script, and Chrome runs content scripts, static or registered at runtime, only where the extension has host access. So the alternatives cost the same warning or break app mode:

- Registering the relay only for granted sites removes the warning but makes app mode require a per-site grant, the friction the npm integration exists to avoid.
- `externally_connectable` can't match all sites, and the page would need to know the extension id.
- Reading the engine through `chrome.devtools.inspectedWindow.eval` polling (no content script at all) would work while DevTools is open, but it needs an engine API and protocol change. It is a candidate for a later version, after which the relay and the broad install warning could go.

The relay does nothing until a page engine talks to it, and engine data only streams while a panel is attached.

## Children, sale of data, contact

The extension is a developer tool, not directed at children. No data is collected, so none is sold or shared with third parties. Questions or reports: open an issue at <https://github.com/ezhillragesh/performance-engine/issues> (security issues: see `SECURITY.md`).
