/**
 * Automatic React render instrumentation via the DevTools global hook.
 *
 * No React dependency: we only rely on the (stable, DevTools-facing) fiber
 * shape. Must run before `react-dom` evaluates, because React registers with
 * `__REACT_DEVTOOLS_GLOBAL_HOOK__` at module load. If the hook already exists
 * (React DevTools installed) we chain its `onCommitFiberRoot`.
 *
 * Everything here is defensive — a failure in the walk is swallowed so the
 * host application is never affected.
 */

import type { RenderEvent } from "../types/events.js";
import { pushEvents } from "../logger/store.js";
import { captureTraceId } from "../trace/traceContext.js";
import { generateEventId, getCurrentSessionId } from "../tracker/id.js";
import { shouldRecordRenders, trackRender } from "../tracker/renderTracker.js";
import { now } from "../tracker/time.js";
import { isOwnerCopy } from "../runtime/engineGlobal.js";

// ── Fiber shape (subset) ─────────────────────────────────────────────

export interface FiberLike {
  tag: number;
  type?: unknown;
  elementType?: unknown;
  child?: FiberLike | null;
  sibling?: FiberLike | null;
  return?: FiberLike | null;
  alternate?: FiberLike | null;
  flags?: number;
  /** React < 17 name for `flags`. */
  effectTag?: number;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  dependencies?: { firstContext?: ContextDependencyLike | null } | null;
  actualDuration?: number;
  selfBaseDuration?: number;
  /** `performance.now()` when this fiber started rendering (profiling/dev builds). */
  actualStartTime?: number;
}

interface ContextDependencyLike {
  memoizedValue?: unknown;
  next?: ContextDependencyLike | null;
}

interface HookLike {
  memoizedState?: unknown;
  queue?: unknown;
  next?: HookLike | null;
}

export interface FiberRootLike {
  current?: FiberLike | null;
}

export const FiberTag = {
  FunctionComponent: 0,
  ClassComponent: 1,
  HostRoot: 3,
  HostComponent: 5,
  HostText: 6,
  ForwardRef: 11,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
} as const;

const PERFORMED_WORK = 1;

const COMPOSITE_TAGS: ReadonlySet<number> = new Set([
  FiberTag.FunctionComponent,
  FiberTag.ClassComponent,
  FiberTag.ForwardRef,
  FiberTag.MemoComponent,
  FiberTag.SimpleMemoComponent,
]);

/** Library/framework wrappers that are never interesting as render sources. */
const INTERNAL_NAMES: ReadonlySet<string> = new Set([
  "StrictMode",
  "Profiler",
  "Suspense",
  "SuspenseList",
  "Fragment",
  "Offscreen",
  "Activity",
  "ViewTransition",
]);

export interface InstrumentReactOptions {
  /** Component names (exact string or RegExp) to skip. */
  ignore?: (string | RegExp)[];
  /** Host components are never tracked (reserved for future use). */
  trackHostComponents?: false;
  /** Max fiber depth to walk (default 1000). */
  maxDepth?: number;
  /** Max fibers visited per commit (default 50 000). */
  maxFibers?: number;
}

// ── Naming ───────────────────────────────────────────────────────────

function fnName(value: unknown): string | undefined {
  if (typeof value === "function") {
    const named = value as { displayName?: unknown; name?: unknown };
    if (typeof named.displayName === "string" && named.displayName) return named.displayName;
    if (typeof named.name === "string" && named.name) return named.name;
  }
  return undefined;
}

/** Resolves names through memo()/forwardRef() wrappers. */
function nameOfType(type: unknown, depth = 0): string | undefined {
  if (type === null || type === undefined || depth > 5) return undefined;
  const direct = fnName(type);
  if (direct) return direct;
  if (typeof type === "object") {
    const wrapper = type as { displayName?: unknown; render?: unknown; type?: unknown };
    if (typeof wrapper.displayName === "string" && wrapper.displayName) return wrapper.displayName;
    if (wrapper.render !== undefined) {
      const inner = fnName(wrapper.render);
      if (inner) return inner;
    }
    if (wrapper.type !== undefined) return nameOfType(wrapper.type, depth + 1);
  }
  return undefined;
}

export function getFiberDisplayName(fiber: FiberLike): string {
  return nameOfType(fiber.elementType) ?? nameOfType(fiber.type) ?? "Anonymous";
}

// ── Change detection ─────────────────────────────────────────────────

const MAX_CHANGED_PROPS = 20;

export function diffProps(prev: unknown, next: unknown): string[] {
  if (prev === next) return [];
  if (!prev || !next || typeof prev !== "object" || typeof next !== "object") return ["props"];
  const changed: string[] = [];
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const key in b) {
    if (a[key] !== b[key] || !(key in a)) {
      changed.push(key);
      if (changed.length >= MAX_CHANGED_PROPS) return changed;
    }
  }
  for (const key in a) {
    if (!(key in b)) {
      changed.push(key);
      if (changed.length >= MAX_CHANGED_PROPS) return changed;
    }
  }
  return changed;
}

/**
 * Effect hooks (useEffect/useLayoutEffect/useInsertionEffect/
 * useImperativeHandle) store an effect object `{ tag, create, deps, ... }` that
 * React recreates on every render, so a changed identity means nothing.
 */
function isEffectState(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const effect = value as { tag?: unknown; create?: unknown };
  return typeof effect.tag === "number" && typeof effect.create === "function";
}

/**
 * Function components: a hook's memoizedState changed. Covers queue-backed
 * hooks (useState/useReducer/useSyncExternalStore) and queue-less value hooks
 * such as useDeferredValue (whose deferred re-render only changes the hook
 * value) or a recomputed useMemo. Effect hooks are skipped (see above).
 */
function hooksChanged(prev: unknown, next: unknown): boolean {
  let a = prev as HookLike | null | undefined;
  let b = next as HookLike | null | undefined;
  let guard = 0;
  while (b && typeof b === "object" && guard < 500) {
    guard += 1;
    const hasQueue = b.queue !== null && b.queue !== undefined;
    if (hasQueue || !isEffectState(b.memoizedState)) {
      if (!a || a.memoizedState !== b.memoizedState) return true;
    }
    a = a?.next;
    b = b.next;
  }
  return false;
}

function stateChanged(fiber: FiberLike, alternate: FiberLike): boolean {
  if (fiber.memoizedState === alternate.memoizedState) return false;
  if (fiber.tag === FiberTag.ClassComponent) return true;
  return hooksChanged(alternate.memoizedState, fiber.memoizedState);
}

function contextChanged(fiber: FiberLike, alternate: FiberLike): boolean {
  let a = alternate.dependencies?.firstContext ?? null;
  let b = fiber.dependencies?.firstContext ?? null;
  let guard = 0;
  while (b && guard < 100) {
    guard += 1;
    if (!a) return false; // new dependency: cannot tell
    if (a.memoizedValue !== b.memoizedValue) return true;
    a = a.next ?? null;
    b = b.next ?? null;
  }
  return false;
}

// ── Instance identity ────────────────────────────────────────────────

let instanceIds = new WeakMap<object, string>();
let instanceCounter = 0;

/** Stable id per component instance: shared by a fiber and its alternate. */
export function getInstanceId(fiber: FiberLike, name: string): string {
  const existing = instanceIds.get(fiber) ?? (fiber.alternate ? instanceIds.get(fiber.alternate) : undefined);
  if (existing) {
    instanceIds.set(fiber, existing);
    return existing;
  }
  instanceCounter += 1;
  const id = `${name}#${instanceCounter}`;
  instanceIds.set(fiber, id);
  if (fiber.alternate) instanceIds.set(fiber.alternate, id);
  return id;
}

// ── Commit walk ──────────────────────────────────────────────────────

let commitCounter = 0;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Render start of `fiber` on the `performance.now()` clock: React's
 * `actualStartTime` when plausible, else commit time minus the render
 * duration, else the commit time (durations unknown).
 */
function renderStart(fiber: FiberLike, commitTime: number, durationMs: number): number {
  const start = fiber.actualStartTime;
  if (typeof start === "number" && Number.isFinite(start) && start >= 0 && start <= commitTime + 1 && commitTime - start <= 60_000) {
    return Math.min(start, commitTime);
  }
  return durationMs > 0 ? commitTime - durationMs : commitTime;
}

function didPerformWork(fiber: FiberLike): boolean {
  const flags = typeof fiber.flags === "number" ? fiber.flags : fiber.effectTag;
  return typeof flags === "number" && (flags & PERFORMED_WORK) !== 0;
}

function isIgnored(name: string, ignore: readonly (string | RegExp)[]): boolean {
  if (INTERNAL_NAMES.has(name)) return true;
  for (const pattern of ignore) {
    if (typeof pattern === "string" ? pattern === name : pattern.test(name)) return true;
  }
  return false;
}

export interface CommitWalkOptions {
  ignore?: readonly (string | RegExp)[];
  maxDepth?: number;
  maxFibers?: number;
}

/**
 * Walks a committed fiber tree and returns one RenderEvent per composite
 * fiber that rendered in this commit. Subtrees whose child pointer did not
 * change since the previous commit are skipped (they did not re-render),
 * which keeps the walk proportional to the rendered part of the tree.
 */
export function collectCommitRenders(root: FiberRootLike, options: CommitWalkOptions = {}): RenderEvent[] {
  const current = root.current;
  if (!current) return [];
  const ignore = options.ignore ?? [];
  const maxDepth = options.maxDepth ?? 1000;
  const maxFibers = options.maxFibers ?? 50_000;
  commitCounter += 1;
  const commitId = commitCounter;
  const commitTime = now();
  const sessionId = getCurrentSessionId();
  const out: RenderEvent[] = [];

  // Parallel stacks avoid allocating a frame object per fiber.
  const fibers: FiberLike[] = [current];
  const depths: number[] = [0];
  const parents: (string | undefined)[] = [undefined];
  let visited = 0;

  while (fibers.length > 0 && visited < maxFibers) {
    const fiber = fibers.pop()!;
    const depth = depths.pop()!;
    let parentName = parents.pop();
    visited += 1;

    const alternate = fiber.alternate ?? null;
    if (COMPOSITE_TAGS.has(fiber.tag)) {
      const name = getFiberDisplayName(fiber);
      if (!isIgnored(name, ignore)) {
        if (didPerformWork(fiber) && fiber.tag !== FiberTag.MemoComponent) {
          const isMount = alternate === null;
          const durationMs = round(typeof fiber.actualDuration === "number" && fiber.actualDuration > 0 ? fiber.actualDuration : 0);
          const event: RenderEvent = {
            type: "render",
            componentName: name,
            instanceId: getInstanceId(fiber, name),
            durationMs,
            phase: isMount ? "mount" : "update",
            source: "react-hook",
            commitId,
            timestamp: round(renderStart(fiber, commitTime, durationMs)),
            commitTime: round(commitTime),
            eventId: generateEventId(),
            sessionId,
          };
          if (typeof fiber.selfBaseDuration === "number") event.selfDurationMs = round(fiber.selfBaseDuration);
          if (parentName !== undefined) event.parentComponent = parentName;
          if (!isMount) {
            const changedProps = diffProps(alternate.memoizedProps, fiber.memoizedProps);
            const sChanged = stateChanged(fiber, alternate);
            const cChanged = contextChanged(fiber, alternate);
            event.changedProps = changedProps;
            event.stateChanged = sChanged;
            event.contextChanged = cChanged;
            event.wasted = changedProps.length === 0 && !sChanged && !cChanged;
          }
          out.push(event);
        }
        if (fiber.tag !== FiberTag.MemoComponent) parentName = name;
      }
    }

    const child = fiber.child ?? null;
    if (!child || depth >= maxDepth) continue;
    // Unchanged child pointer => the subtree bailed out entirely this commit.
    if (alternate !== null && alternate.child === child) continue;
    // Push siblings in reverse so they are visited in document order.
    const base = fibers.length;
    let next: FiberLike | null = child;
    let siblings = 0;
    while (next && siblings < maxFibers) {
      fibers.push(next);
      next = next.sibling ?? null;
      siblings += 1;
    }
    for (let lo = base, hi = fibers.length - 1; lo < hi; lo += 1, hi -= 1) {
      const tmp = fibers[lo]!;
      fibers[lo] = fibers[hi]!;
      fibers[hi] = tmp;
    }
    for (let i = 0; i < siblings; i += 1) {
      depths.push(depth + 1);
      parents.push(parentName);
    }
  }

  if (out.length > 0) {
    const traceId = captureTraceId();
    if (traceId !== undefined) {
      for (const event of out) event.traceId = traceId;
    }
  }
  return out;
}

// ── Hook installation ────────────────────────────────────────────────
//
// Coexistence with the real React DevTools (RDT extension / react-devtools-core):
// RDT's installHook() bails out when `window.hasOwnProperty("__REACT_DEVTOOLS_GLOBAL_HOOK__")`
// is already true, and modern RDT attaches its renderer interface inside *its own* hook's
// `inject()`. So a hook of ours installed first would silently break RDT on that page (the
// injected engine runs at document_start, racing the RDT content script). Approach (same idea as
// bippy / React Scan):
//  1. RDT first: we only chain its `onCommitFiberRoot` (below).
//  2. We first: install an RDT-compatible hook (renderers, rendererInterfaces, backends,
//     listeners, sub/on/off/emit, inject -> "renderer", getFiberRoots, commit forwarding...) as a
//     *configurable accessor*, so an RDT backend initialised on top of it still works, and
//     - yield: while it is still our hook with zero renderers, a window-scoped `hasOwnProperty`
//       shim reports the key as absent, so RDT installs its own hook (Object.defineProperty
//       replaces our configurable accessor); a microtask then re-chains onto the new hook;
//     - adopt: plain assignment of another hook hits our setter, which copies our renderers
//       into it and re-chains immediately;
//     - the shim is removed as soon as React registered, the hook was replaced, or on uninstall.
//  3. `ensureChained()` (also run by getReactInstrumentationStatus) re-chains if the hook was
//     replaced behind our back. Re-chain callbacks live on our hook, so every core copy chained
//     on it follows a replacement.

type CommitHandler = (rendererId: unknown, root: FiberRootLike, ...rest: unknown[]) => unknown;
type Listener = (data: unknown) => unknown;

interface RendererInterfaceLike {
  handleCommitFiberRoot?: (root: unknown, priority?: unknown) => void;
  handleCommitFiberUnmount?: (fiber: unknown) => void;
  handlePostCommitFiberRoot?: (root: unknown) => void;
}

interface DevtoolsHookLike {
  renderers?: Map<number, unknown>;
  supportsFiber?: boolean;
  inject?: (renderer: unknown) => number;
  onCommitFiberRoot?: CommitHandler;
  onCommitFiberUnmount?: (...args: unknown[]) => void;
  onPostCommitFiberRoot?: (...args: unknown[]) => void;
  checkDCE?: (...args: unknown[]) => void;
  [key: string]: unknown;
}

const HOOK_KEY = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
const MARK = "__perfEngineInstrumented";
/** Marker on a hook created by (any copy of) core: `{ rechain: Set<(next) => void> }`. */
const OWN_HOOK = "__perfEngineHook";

interface OwnHookMeta {
  rechain: Set<(next: DevtoolsHookLike) => void>;
}

function ownMeta(hook: unknown): OwnHookMeta | undefined {
  try {
    const meta = hook && typeof hook === "object" ? (hook as Record<string, unknown>)[OWN_HOOK] : undefined;
    return meta && typeof meta === "object" && (meta as OwnHookMeta).rechain instanceof Set ? (meta as OwnHookMeta) : undefined;
  } catch {
    return undefined;
  }
}

/** Hook object compatible with what the React DevTools backend expects (react-devtools-shared/src/hook.js). */
export function createCompatibleHook(onRendererInjected?: () => void): DevtoolsHookLike {
  const renderers = new Map<number, unknown>();
  const rendererInterfaces = new Map<number, RendererInterfaceLike>();
  const fiberRoots = new Map<unknown, Set<unknown>>();
  const listeners: Record<string, Listener[]> = {};
  let nextId = 0;
  const noop = (): void => undefined;
  const iface = (id: unknown): RendererInterfaceLike | undefined => rendererInterfaces.get(id as number);
  const hook: DevtoolsHookLike = {
    renderers,
    rendererInterfaces,
    backends: new Map<string, unknown>(),
    listeners,
    supportsFiber: true,
    supportsFlight: true,
    hasUnsupportedRendererAttached: false,
    checkDCE: noop,
    inject(renderer: unknown): number {
      nextId += 1;
      renderers.set(nextId, renderer);
      try {
        onRendererInjected?.();
      } catch {
        // ignore
      }
      (hook.emit as (e: string, d: unknown) => void)("renderer", { id: nextId, renderer });
      return nextId;
    },
    sub(event: string, fn: Listener): () => void {
      (hook.on as (e: string, f: Listener) => void)(event, fn);
      return () => (hook.off as (e: string, f: Listener) => void)(event, fn);
    },
    on(event: string, fn: Listener): void {
      (listeners[event] ??= []).push(fn);
    },
    off(event: string, fn: Listener): void {
      const list = listeners[event];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
      if (list.length === 0) delete listeners[event];
    },
    emit(event: string, data?: unknown): void {
      const list = listeners[event];
      if (!list) return;
      for (const fn of list.slice()) {
        try {
          fn(data);
        } catch {
          // a listener must never break React
        }
      }
    },
    getFiberRoots(rendererId: unknown): Set<unknown> {
      let roots = fiberRoots.get(rendererId);
      if (!roots) fiberRoots.set(rendererId, (roots = new Set()));
      return roots;
    },
    onCommitFiberRoot(rendererId: unknown, root: FiberRootLike, priority?: unknown): void {
      try {
        const roots = (hook.getFiberRoots as (id: unknown) => Set<unknown>)(rendererId);
        const state = root.current?.memoizedState as { element?: unknown } | null | undefined;
        const unmounting = state == null || state.element == null;
        if (!roots.has(root) && !unmounting) roots.add(root);
        else if (roots.has(root) && unmounting) roots.delete(root);
        iface(rendererId)?.handleCommitFiberRoot?.(root, priority);
      } catch {
        // never break the host app
      }
    },
    onCommitFiberUnmount(rendererId: unknown, fiber: unknown): void {
      try {
        iface(rendererId)?.handleCommitFiberUnmount?.(fiber);
      } catch {
        // ignore
      }
    },
    onPostCommitFiberRoot(rendererId: unknown, root: unknown): void {
      try {
        iface(rendererId)?.handlePostCommitFiberRoot?.(root);
      } catch {
        // ignore
      }
    },
    onScheduleFiberRoot: noop,
    setStrictMode: noop,
    getInternalModuleRanges: (): unknown[] => [],
    registerInternalModuleStart: noop,
    registerInternalModuleStop: noop,
  };
  Object.defineProperty(hook, OWN_HOOK, { value: { rechain: new Set() } satisfies OwnHookMeta, enumerable: false });
  return hook;
}

/** Copies renderers registered with `from` (same ids) into `to`, so React keeps working after a hand-off. */
function adoptRenderers(from: DevtoolsHookLike, to: DevtoolsHookLike): void {
  try {
    const src = from.renderers;
    if (!src || src.size === 0) return;
    if (!(to.renderers instanceof Map)) to.renderers = new Map();
    const dst = to.renderers;
    src.forEach((renderer, id) => {
      if (!dst.has(id)) dst.set(id, renderer);
    });
  } catch {
    // ignore
  }
}

/** Our hook as installed by this copy (null when the hook existed or was created by another copy). */
let ownInstall: { hook: DevtoolsHookLike; restoreShim: () => void } | null = null;

/** Installs our RDT-compatible hook on `w` with the yield/adopt behaviour described above. */
function installOwnHook(w: Record<string, unknown>): DevtoolsHookLike {
  let restoreShim = (): void => undefined;
  const own = createCompatibleHook(() => restoreShim());
  const meta = ownMeta(own)!;
  let current: unknown = own;
  let handedOff = false;
  const handOff = (next: unknown): void => {
    if (handedOff || !next || typeof next !== "object" || next === own) return;
    handedOff = true;
    restoreShim();
    adoptRenderers(own, next as DevtoolsHookLike);
    for (const fn of Array.from(meta.rechain)) {
      try {
        fn(next as DevtoolsHookLike);
      } catch {
        // ignore
      }
    }
  };
  Object.defineProperty(w, HOOK_KEY, {
    configurable: true,
    enumerable: false,
    get: () => current,
    set: (value: unknown) => {
      current = value;
      handOff(value);
    },
  });

  // Scoped hasOwnProperty shim (see header). Only ever lies about HOOK_KEY on `w`, and only while
  // our hook is current and no renderer registered, i.e. while yielding cannot lose anything.
  try {
    const previous = Object.getOwnPropertyDescriptor(w, "hasOwnProperty");
    const base = (previous && typeof previous.value === "function" ? previous.value : Object.prototype.hasOwnProperty) as (this: unknown, key: PropertyKey) => boolean;
    const shim = function hasOwnProperty(this: unknown, key: PropertyKey): boolean {
      const self = this == null ? w : this;
      try {
        if (self === w && key === HOOK_KEY && !handedOff && w[HOOK_KEY] === own && own.renderers!.size === 0) {
          queueMicrotask(() => {
            try {
              const now = w[HOOK_KEY];
              if (now !== own) handOff(now);
            } catch {
              // ignore
            }
          });
          return false;
        }
      } catch {
        // fall through to the real answer
      }
      return base.call(self, key);
    };
    Object.defineProperty(w, "hasOwnProperty", { configurable: true, writable: true, enumerable: false, value: shim });
    restoreShim = () => {
      restoreShim = (): void => undefined;
      try {
        if (Object.getOwnPropertyDescriptor(w, "hasOwnProperty")?.value !== shim) return; // someone wrapped it later
        if (previous) Object.defineProperty(w, "hasOwnProperty", previous);
        else Reflect.deleteProperty(w, "hasOwnProperty");
      } catch {
        // ignore
      }
    };
  } catch {
    // no shim: a later RDT keeps using our compatible hook instead
  }
  ownInstall = { hook: own, restoreShim: () => restoreShim() };
  return own;
}

let installed: { hook: DevtoolsHookLike; wrapper: CommitHandler; original: CommitHandler | undefined } | null = null;
let commitSeen = false;
let installRefs = 0;
let activeOptions: CommitWalkOptions = {};

function handleCommit(root: FiberRootLike): void {
  commitSeen = true;
  if (!shouldRecordRenders()) return;
  // Two core copies can both be chained on the hook (app bundle + injected
  // bundle): only the copy owning the registered session records.
  if (!isOwnerCopy()) return;
  try {
    const events = collectCommitRenders(root, activeOptions);
    if (events.length > 0) pushEvents(events);
  } catch {
    // never break the host app
  }
}

/** Follows a hook replacement (RDT installed its own hook after ours). */
function rechain(next: DevtoolsHookLike): void {
  if (!installed || installed.hook === next || !next || typeof next !== "object") return;
  ownMeta(installed.hook)?.rechain.delete(rechain);
  // The wrapper left on the old hook turns inert (it checks `installed.wrapper`).
  chainOnto(next);
}

function chainOnto(hook: DevtoolsHookLike): void {
  const original = typeof hook.onCommitFiberRoot === "function" ? hook.onCommitFiberRoot : undefined;
  const wrapper: CommitHandler = function perfEngineOnCommitFiberRoot(this: unknown, rendererId, root, ...rest) {
    if (installed !== null && installed.wrapper === wrapper) handleCommit(root);
    return original ? original.call(this, rendererId, root, ...rest) : undefined;
  };
  (wrapper as unknown as Record<string, unknown>)[MARK] = true;
  hook.onCommitFiberRoot = wrapper;
  installed = { hook, wrapper, original };
  ownMeta(hook)?.rechain.add(rechain);
}

/** Re-chains when the global hook was replaced without us noticing. Never throws. */
function ensureChained(): void {
  if (!installed || typeof window === "undefined") return;
  try {
    const current = (window as unknown as Record<string, unknown>)[HOOK_KEY] as DevtoolsHookLike | undefined;
    if (!current || typeof current !== "object" || current === installed.hook) return;
    if (ownMeta(installed.hook)) adoptRenderers(installed.hook, current);
    rechain(current);
  } catch {
    // ignore
  }
}

export type ReactInstrumentationStatus =
  /** `instrumentReact()` was not called (or was uninstalled). */
  | "not-installed"
  /**
   * Installed, but no React renderer has registered with the hook and no
   * commit was seen yet: normal for a moment during startup, permanent when
   * React was loaded before `instrumentReact()` ran or the hook is disabled.
   */
  | "waiting"
  /** A renderer registered or a commit was observed: renders are recorded. */
  | "active";

export function getReactInstrumentationStatus(): ReactInstrumentationStatus {
  if (installed === null) return "not-installed";
  ensureChained();
  if (commitSeen) return "active";
  try {
    const { hook } = installed;
    if (hook.isDisabled === true) return "waiting";
    const renderers = hook.renderers;
    if (renderers && typeof renderers.size === "number" && renderers.size > 0) return "active";
  } catch {
    // ignore
  }
  return "waiting";
}

/** True only when React renders are actually being observed (see status). */
export function isReactInstrumented(): boolean {
  return getReactInstrumentationStatus() === "active";
}

/**
 * Installs (or chains) the React DevTools global hook. Returns an idempotent
 * uninstall function. Calling it again while installed updates the options.
 */
export function instrumentReact(options: InstrumentReactOptions = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  activeOptions = {
    ignore: options.ignore ?? [],
    maxDepth: options.maxDepth ?? 1000,
    maxFibers: options.maxFibers ?? 50_000,
  };

  if (installed) ensureChained();
  else {
    try {
      const w = window as unknown as Record<string, unknown>;
      let hook = w[HOOK_KEY] as DevtoolsHookLike | undefined;
      if (!hook || typeof hook !== "object") {
        hook = installOwnHook(w);
      }
      chainOnto(hook);
    } catch {
      return () => undefined;
    }
  }

  installRefs += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installRefs -= 1;
    if (installRefs > 0 || !installed) return;
    const { hook, wrapper, original } = installed;
    // Only unwrap when nobody chained on top of us; otherwise stay as a no-op.
    if (hook.onCommitFiberRoot === wrapper) {
      hook.onCommitFiberRoot = original ?? ((): undefined => undefined);
    }
    ownMeta(hook)?.rechain.delete(rechain);
    if (ownInstall) {
      ownInstall.restoreShim();
      ownInstall = null;
    }
    installed = null;
  };
}

/** Test helper: forget instance ids and commit counter. */
export function resetReactInstrumentation(): void {
  instanceIds = new WeakMap();
  instanceCounter = 0;
  commitCounter = 0;
  commitSeen = false;
}

/**
 * `<Profiler onRender>` callback that records one render per profiler id.
 * Signature matches React's `ProfilerOnRenderCallback`.
 */
export function createProfilerOnRender(): (
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => void {
  // `baseDuration` is the cost of re-rendering the whole subtree without
  // memoization, not a self time, so it is deliberately not recorded.
  return (id, phase, actualDuration, _baseDuration, startTime, commitTime) => {
    const t = now();
    const plausible = (v: number): boolean => Number.isFinite(v) && v >= 0 && v <= t + 1 && t - v <= 60_000;
    const extra: Partial<RenderEvent> = { phase, source: "react-profiler", instanceId: `profiler:${id}` };
    if (plausible(startTime)) extra.timestamp = startTime;
    if (plausible(commitTime)) extra.commitTime = commitTime;
    trackRender(id, actualDuration, undefined, undefined, extra);
  };
}
