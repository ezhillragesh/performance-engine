# 0003. Keep a bounded, in-memory, append-only event store

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively)

## Context

The engine runs inside someone else's app, possibly for hours. An unbounded event log is a memory
leak in the host. Analysis must also be repeatable: the same events must give the same insights, and
the extension must be able to show exactly what the analyzer saw.

## Decision

- `core/logger/store.ts` keeps at most `maxEvents` events (default 2000, minimum 100), sorted by
  timestamp. Late events, such as network requests pushed at response time with their start
  timestamp, are inserted in order.
- When full, the oldest 25 % are dropped at once, which amortises the cost. Trimmed events and events
  dropped while paused are counted and reported as `droppedEvents` in snapshots.
- Events are immutable once stored, and analysis reads them without mutating them. A version counter
  lets consumers (the analysis tick, the bridge's change signature) skip work when nothing changed.
- There is no persistence in the page. Export to JSON is the user's archive, and the extension keeps
  only the latest snapshot per tab, in session storage.

## Consequences

- Memory is bounded, and analysis cost is bounded by the store size (O(n log n),
  `tests/perf-budget.test.ts`).
- Long sessions lose old history, and insights about trimmed events disappear on the next analysis.
  The panel shows the drop count, so users can tell.
- Module-level store state is per core copy. Two copies on one page have two stores, which is why only
  one copy may own the session ([ADR 0008](./0008-engine-modes-and-app-wins-handoff.md)).

## Alternatives considered

- **Unbounded log**: a leak in the host app.
- **IndexedDB persistence in the page**: writes to the host's origin storage and adds I/O on the main
  thread, for a debugging tool. Export covers the need.
- **Per-type ring buffers**: each would need its own sizing, and they make ordered, cross-type trace
  grouping harder.
