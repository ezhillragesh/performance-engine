# 0008. Support three engine modes, and let the app engine win

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively, protocol v2.1)

## Context

Requiring every site to install the npm package limits the extension to apps we control. Injecting
an engine into arbitrary sites needs host permissions, which should be granted per site rather than
asked for at install. A page can then contain **two** copies of core (the app's bundle and the
injected one) with separate module state. Without coordination they would double-count events and
both talk to the panel.

## Decision

- Three modes, reported in `HELLO.config.mode` ([`PROTOCOL.md`](../PROTOCOL.md), "Engine modes"):
  - **app**: the page bundles core.
  - **injected**: on **Enable on this site**, the panel requests the optional host permission for that
    one origin, and the service worker registers `vendor/perf-engine.inject.js` as a MAIN-world
    content script at `document_start` for it.
  - **DevTools only**: no engine. The panel builds data from HAR, a passive collector and the bundled
    analyzer.
- Manifest `permissions` are `storage` and `scripting`, with `optional_host_permissions: ["<all_urls>"]`.
  Revoking access unregisters the injection.
- Copies coordinate through `globalThis.__PERF_ENGINE_GLOBAL__`. `initPerfEngine` stops a session
  registered by another copy, and stopping fully uninstalls it. The injected bundle does nothing if an
  app engine is registered, and its bridge stays silent until `DOMContentLoaded`, so an app engine
  that starts during parsing always wins before the panel sees the injected one.

## Consequences

- The extension is useful on any site, with least privilege by default.
- Only one engine talks to the panel, and no event is counted twice. React commit wrappers from both
  copies may stay chained, but only the owner records.
- Module-level state is per copy, and code must never assume a singleton across bundles.
  `tests/handoff.test.ts` covers the handoff.
- Apps built with core 0.2 or earlier do not know the registry. With injection also enabled, two
  engines run on such sites.
- In injected mode the first HELLO can arrive only after the page has parsed. The panel's no-engine
  timeout shows DevTools-only data until then.

## Alternatives considered

- **App mode only**: excludes every site that does not ship the package.
- **Broad host permissions at install**: an alarming install prompt, and access to sites the user never
  debugs.
- **Last engine wins, or first wins**: injected code starts first (at `document_start`), so "first wins"
  would always pick the less capable copy. App code carries custom rules and budgets.
