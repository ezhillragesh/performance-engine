# 0005. Stream to DevTools only while a panel is attached

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively, protocol v2)

## Context

v0.1 pushed `INSIGHTS_UPDATE` and `EVENTS_UPDATE` messages continuously, and sent only "fresh"
insights. Every page paid for serialisation and `postMessage` even with DevTools closed, which is
always true for real users. A panel that opened late saw no state, and a service-worker restart lost
whatever it held.

## Decision

- Protocol v2 ([`PROTOCOL.md`](../PROTOCOL.md)): the page sends `HELLO` (at start and in reply to `PING`),
  full-state `SNAPSHOT`s and `RESET`. The panel sends commands.
- The service worker sends `ATTACH` when a tab's first panel port connects and `DETACH` when its last
  one disconnects. The bridge (`core/bridge/devtoolsBridge.ts`) streams snapshots **only between ATTACH
  and DETACH**, throttled (default 1 s) and only when a cheap change signature differs.
- A snapshot always carries the full current insight list, never a "fresh" subset.
- Orphaned streams are stopped. The service worker sends DETACH when a snapshot arrives for a tab with
  no panel (for example, after a worker restart), and an orphaned content script posts DETACH itself.

## Consequences

- With DevTools closed, the cost is the trackers and the periodic analysis tick (which runs only when
  the store changed). Messaging is limited to the one-time HELLO and PING replies.
- Full snapshots make the panel stateless with respect to history: it can open late, reconnect, or
  restore from `chrome.storage.session` after the worker dies.
- Snapshots are larger than deltas. This is bounded by the snapshot caps (1500 events, 100 traces)
  and the change signature.
- Every component on the path (bridge, content script, service worker) must keep the gating
  invariants. `bridge.test.ts` covers the page side.

## Alternatives considered

- **Always-on push** (v0.1): constant cost for every user.
- **Deltas**: smaller messages, but fragile across service-worker death and late-opening panels.
- **Panel polling via `inspectedWindow.eval`**: works without a content script, but serialises large
  results through eval and couples the panel to the engine's internals. It is used only for the
  DevTools-only collector and the accessibility audit, where there is no engine.
