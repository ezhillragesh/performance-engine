# 0001. Stamp the trace at capture time and never infer it by time

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively, decision made during 0.2–0.3)

## Context

The product's value is a causal answer: *this click caused this request, which caused these renders*.
v0.1 grouped events into "interaction windows" by timestamp proximity. That fails exactly when it
matters. Overlapping interactions, a slow handler that outlives the window, a response that lands
after the user has clicked something else, and unrelated timers that fire inside a window all end up
attributed to the wrong gesture, and the resulting insight blames the wrong component.

## Decision

- A trigger UI event (`click`, `dblclick`, `keydown`, `input`, `change`, `submit`, `pointerdown`) opens
  a trace in `core/trace/traceContext.ts`. Every tracker reads `getActiveTraceId()` **when the event is
  created** and stores it on the event. Analysis never re-tags or mutates events.
- The trace's idle clock (120 ms, with a 2 s cap per segment) starts only when the triggering task
  ends, because the trace is pinned until a zero-delay timer fires. A slow synchronous handler
  therefore does not expire its own trace.
- `fetch` and XHR remember the trace at request start and re-activate it for the response's
  synchronous continuation. If a newer interaction is live, the response borrows the old trace and
  then restores the live one.
- Engine and tooling work runs in `runDetached`, so it is never attributed to the user.
- The analyzer groups by `traceId`. A time-window fallback exists only for untagged (legacy or manual)
  events, and each untagged event joins at most one window.

## Consequences

- Attribution is exact for synchronous work, microtasks, following frames and request continuations.
- Work that escapes the tracked async boundaries (for example, a `setTimeout` chain longer than the idle
  window, or `await res.json()` after a newer interaction) is not attributed. This is documented as a
  known limitation rather than guessed at.
- Every tracker must stamp the trace when it creates an event (`captureTraceId()`, or the trigger path
  for UI events). Reviewers check this, and
  `traceContext.test.ts`, `traces.test.ts` and `regressions.test.ts` cover the edge cases.
- Rules must scope to `context.traces`, never to the global `context.events`.

## Alternatives considered

- **Time-window inference** (v0.1): simple, but wrong for overlapping and async work, and impossible to
  make right after the fact.
- **Zone.js-style patching of every async API**: broader coverage, but invasive, costly, and likely to
  break host apps, which violates "never harm the host app".
- **Long Animation Frame attribution only**: precise for main-thread blocking, but says nothing about
  network or render causality.
