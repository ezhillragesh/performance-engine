# 0004. Instrument React through an RDT-compatible DevTools hook

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively, introduced after v0.1)

## Context

v0.1 required manual `trackRender("Component")` calls. Coverage depended on discipline, and the data
could not tell 24 list rows apart from one component re-rendering 24 times. React has no public
commit API. The stable integration point is `__REACT_DEVTOOLS_GLOBAL_HOOK__`, which React reads
**once, when `react-dom` is evaluated**, and which the React DevTools extension also owns. Breaking
React DevTools for our users is not acceptable.

## Decision

- `instrumentReact()` (`core/react/instrumentReact.ts`) walks each committed fiber tree from
  `onCommitFiberRoot`. It records per-instance render events (`instanceId`, `commitId`, `phase`,
  `durationMs`, `selfDurationMs`, `changedProps`, `stateChanged`, `contextChanged`, `wasted`,
  `parentComponent`) and skips bailed-out subtrees. Core keeps no React dependency and relies only on
  the DevTools-facing fiber shape.
- If a hook exists, we chain its `onCommitFiberRoot`. Otherwise we install a hook that is
  **compatible with React DevTools** (`renderers`, `rendererInterfaces`, `backends`, `sub/on/off/emit`,
  `inject` emitting `"renderer"`, `getFiberRoots`, commit forwarding) as a configurable accessor.
- We **yield** to a real React DevTools that installs later. While the hook is still ours *and no
  renderer has registered*, a window-scoped `hasOwnProperty` shim reports the key as absent, so React
  DevTools' `installHook` proceeds. We then re-chain onto its hook. Once React has registered with our
  hook we never yield, because nothing may be lost.
- `instrumentReact()` must run before `react-dom` loads (the demo imports `./perf` first in `main.tsx`).
  Everything is wrapped in `try`/`catch`.

## Consequences

- Render tracking needs no component changes and distinguishes instances.
- Durations are real only in development or profiling builds, so in production `slow-component`
  cannot fire.
- The shim is delicate. `tests/rdtCoexistence.test.ts` simulates React DevTools with the real
  `react-devtools-core` backend, and any change to the hook must be verified against it.
- With two core copies, both wrappers can stay chained, but only the session-owning copy records
  (`isOwnerCopy`).

## Alternatives considered

- **Manual `trackRender` only**: incomplete coverage, kept as a fallback for non-React code.
- **`<Profiler>` only**: requires wrapping the tree, and gives per-subtree timings without per-instance
  props and state change data. Kept as `createProfilerOnRender()`.
- **Patching React internals or `react-dom` exports**: version-fragile and breaks with bundling.
- **Requiring the React DevTools extension**: excludes most users and the injected mode.
