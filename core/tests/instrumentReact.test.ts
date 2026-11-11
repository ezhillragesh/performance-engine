// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectCommitRenders,
  createProfilerOnRender,
  FiberTag,
  getFiberDisplayName,
  instrumentReact,
  resetReactInstrumentation,
  type FiberLike,
  type FiberRootLike,
} from "../react/instrumentReact.js";
import { getEvents, resetStore } from "../logger/store.js";
import { setRenderTrackingEnabled } from "../tracker/renderTracker.js";
import { beginTrace, resetTraceContext } from "../trace/traceContext.js";
import type { RenderEvent } from "../types/events.js";

const HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
type Win = Record<string, unknown>;

function App(): null {
  return null;
}
function Item(): null {
  return null;
}
function Fancy(): null {
  return null;
}
function Input(): null {
  return null;
}
const MemoFancy = { $$typeof: Symbol.for("react.memo"), type: Fancy };
const ForwardInput = { $$typeof: Symbol.for("react.forward_ref"), render: Input };

function fiber(tag: number, type: unknown, props: unknown, extra: Partial<FiberLike> = {}): FiberLike {
  return { tag, type, elementType: type, memoizedProps: props, memoizedState: null, flags: 0, child: null, sibling: null, return: null, alternate: null, ...extra };
}

function link(parent: FiberLike, children: FiberLike[]): FiberLike {
  parent.child = children[0] ?? null;
  children.forEach((c, i) => {
    c.return = parent;
    c.sibling = children[i + 1] ?? null;
  });
  return parent;
}

/** Work-in-progress copy of `current` (like React's createWorkInProgress). */
function wip(current: FiberLike, overrides: Partial<FiberLike> = {}): FiberLike {
  const next: FiberLike = { ...current, flags: 0, alternate: current, ...overrides };
  current.alternate = next;
  return next;
}

const stateHook = (value: unknown): object => ({ memoizedState: value, queue: { dispatch: () => undefined }, next: null });

interface Tree {
  root: FiberRootLike;
  app: FiberLike;
  itemA: FiberLike;
  itemB: FiberLike;
  fancy: FiberLike;
  input: FiberLike;
}

function mountTree(): Tree {
  const app = fiber(FiberTag.FunctionComponent, App, {}, { flags: 1, actualDuration: 5, selfBaseDuration: 1, memoizedState: stateHook(0) });
  const div = fiber(FiberTag.HostComponent, "div", {});
  const itemA = fiber(FiberTag.FunctionComponent, Item, { id: "a" }, { flags: 1, actualDuration: 2 });
  const itemB = fiber(FiberTag.FunctionComponent, Item, { id: "b", done: false }, { flags: 1, actualDuration: 2 });
  const fancy = fiber(FiberTag.SimpleMemoComponent, Fancy, {}, { elementType: MemoFancy, flags: 1 });
  const input = fiber(FiberTag.ForwardRef, ForwardInput, {}, { flags: 1 });
  link(div, [itemA, itemB, fancy, input]);
  link(app, [div]);
  const host = link(fiber(FiberTag.HostRoot, null, null), [app]);
  return { root: { current: host }, app, itemA, itemB, fancy, input };
}

/** Next commit: App state changed, item A re-rendered with equal props (wasted), B got new props, Fancy/Input bailed out. */
function updateTree(prev: Tree): Tree {
  const host = prev.root.current!;
  const div = prev.app.child!;
  const app = wip(prev.app, { flags: 1, memoizedState: stateHook(1), actualDuration: 4 });
  const newDiv = wip(div);
  const itemA = wip(prev.itemA, { flags: 1, memoizedProps: { id: "a" } });
  const itemB = wip(prev.itemB, { flags: 1, memoizedProps: { id: "b", done: true } });
  const fancy = wip(prev.fancy); // no PerformedWork flag: bailed out
  const input = wip(prev.input);
  link(newDiv, [itemA, itemB, fancy, input]);
  link(app, [newDiv]);
  const newHost = link(wip(host), [app]);
  return { root: { current: newHost }, app, itemA, itemB, fancy, input };
}

function renders(): RenderEvent[] {
  return getEvents().filter((e): e is RenderEvent => e.type === "render");
}

beforeEach(() => {
  resetStore();
  resetTraceContext();
  resetReactInstrumentation();
  setRenderTrackingEnabled(true);
  delete (window as unknown as Win)[HOOK];
});

afterEach(() => {
  setRenderTrackingEnabled(false);
});

describe("fiber walk", () => {
  it("emits mount renders with names, parents, durations and commit ids", () => {
    const tree = mountTree();
    const events = collectCommitRenders(tree.root);
    expect(events.map((e) => e.componentName)).toEqual(expect.arrayContaining(["App", "Item", "Item", "Fancy", "Input"]));
    expect(events).toHaveLength(5);
    for (const e of events) {
      expect(e.phase).toBe("mount");
      expect(e.source).toBe("react-hook");
      expect(e.commitId).toBe(events[0]!.commitId);
    }
    const app = events.find((e) => e.componentName === "App")!;
    expect(app).toMatchObject({ durationMs: 5, selfDurationMs: 1 });
    expect(events.find((e) => e.componentName === "Fancy")!.parentComponent).toBe("App");
  });

  it("detects changed props, state changes and wasted updates", () => {
    const mounted = mountTree();
    const first = collectCommitRenders(mounted.root);
    const updated = updateTree(mounted);
    const events = collectCommitRenders(updated.root);
    expect(events.map((e) => e.componentName).sort()).toEqual(["App", "Item", "Item"]);
    const app = events.find((e) => e.componentName === "App")!;
    expect(app).toMatchObject({ phase: "update", stateChanged: true, wasted: false });
    const [a, b] = events.filter((e) => e.componentName === "Item").sort((x, y) => (x.instanceId! < y.instanceId! ? -1 : 1));
    const firstA = first.find((e) => e.componentName === "Item" && e.instanceId === a!.instanceId);
    expect(firstA).toBeDefined(); // instance id stable across the alternate swap
    expect(a).toMatchObject({ changedProps: [], stateChanged: false, contextChanged: false, wasted: true });
    expect(b).toMatchObject({ changedProps: ["done"], wasted: false });
    expect(events[0]!.commitId).toBe(first[0]!.commitId! + 1);
  });

  it("keeps instance ids stable when React reuses the old fiber object", () => {
    const mounted = mountTree();
    const [firstA] = collectCommitRenders(mounted.root).filter((e) => e.componentName === "Item");
    const second = updateTree(mounted);
    collectCommitRenders(second.root);
    const third = updateTree(second);
    const ids = collectCommitRenders(third.root).filter((e) => e.componentName === "Item").map((e) => e.instanceId);
    expect(ids).toContain(firstA!.instanceId);
  });

  it("skips subtrees whose child pointer did not change", () => {
    const mounted = mountTree();
    collectCommitRenders(mounted.root);
    const host = mounted.root.current!;
    const nextHost = wip(host); // child pointer identical: nothing below re-rendered
    mounted.itemA.flags = 1; // stale flag from the previous commit must not be reported
    expect(collectCommitRenders({ current: nextHost })).toHaveLength(0);
  });

  it("unwraps memo / forwardRef names and honours displayName", () => {
    expect(getFiberDisplayName(fiber(FiberTag.SimpleMemoComponent, Fancy, {}, { elementType: MemoFancy }))).toBe("Fancy");
    expect(getFiberDisplayName(fiber(FiberTag.ForwardRef, ForwardInput, {}))).toBe("Input");
    expect(getFiberDisplayName(fiber(FiberTag.MemoComponent, { type: ForwardInput }, {}))).toBe("Input");
    expect(getFiberDisplayName(fiber(FiberTag.FunctionComponent, Object.assign(() => null, { displayName: "Named" }), {}))).toBe("Named");
    expect(getFiberDisplayName(fiber(FiberTag.FunctionComponent, {}, {}))).toBe("Anonymous");
  });

  it("applies the ignore list and depth cap", () => {
    const events = collectCommitRenders(mountTree().root, { ignore: ["Item", /^Fan/] });
    expect(events.map((e) => e.componentName).sort()).toEqual(["App", "Input"]);
    expect(collectCommitRenders(mountTree().root, { maxDepth: 1 }).map((e) => e.componentName)).toEqual(["App"]);
  });

  it("a /g or /y ignore RegExp matches on every commit, not every other one (lastIndex)", () => {
    const ignore = [/Item/g, /^Fan/y];
    for (let commit = 0; commit < 3; commit += 1) {
      const names = collectCommitRenders(mountTree().root, { ignore }).map((e) => e.componentName);
      expect(names.sort()).toEqual(["App", "Input"]);
    }
  });

  it("stamps the active trace on every render of the commit", () => {
    const traceId = beginTrace("click");
    const events = collectCommitRenders(mountTree().root);
    expect(new Set(events.map((e) => e.traceId))).toEqual(new Set([traceId]));
  });
});

describe("instrumentReact hook", () => {
  it("creates a minimal hook when none exists", () => {
    const stop = instrumentReact();
    const hook = (window as unknown as Win)[HOOK] as { supportsFiber: boolean; inject: (r: unknown) => number; renderers: Map<number, unknown> };
    expect(hook.supportsFiber).toBe(true);
    expect(hook.inject({})).toBe(1);
    expect(hook.renderers.size).toBe(1);
    (hook as unknown as { onCommitFiberRoot: (id: number, root: FiberRootLike) => void }).onCommitFiberRoot(1, mountTree().root);
    expect(renders()).toHaveLength(5);
    stop();
  });

  it("chains an existing hook and restores it on uninstall", () => {
    const original = vi.fn(() => "orig");
    const hook = { renderers: new Map(), supportsFiber: true, inject: () => 1, onCommitFiberRoot: original };
    (window as unknown as Win)[HOOK] = hook;
    const stop = instrumentReact();
    expect(hook.onCommitFiberRoot).not.toBe(original);
    const tree = mountTree();
    const result = (hook.onCommitFiberRoot as (...args: unknown[]) => unknown)(1, tree.root, 3, false);
    expect(result).toBe("orig");
    expect(original).toHaveBeenCalledWith(1, tree.root, 3, false);
    expect(renders()).toHaveLength(5);
    stop();
    stop();
    expect(hook.onCommitFiberRoot).toBe(original);
  });

  it("records nothing while render tracking is disabled, and never throws on bad trees", () => {
    const stop = instrumentReact();
    const hook = (window as unknown as Win)[HOOK] as { onCommitFiberRoot: (...args: unknown[]) => void };
    setRenderTrackingEnabled(false);
    hook.onCommitFiberRoot(1, mountTree().root);
    expect(renders()).toHaveLength(0);
    setRenderTrackingEnabled(true);
    const evil = { get current(): FiberLike { throw new Error("boom"); } };
    expect(() => hook.onCommitFiberRoot(1, evil)).not.toThrow();
    expect(() => hook.onCommitFiberRoot(1, null)).not.toThrow();
    stop();
  });

  it("createProfilerOnRender records profiler renders (start/commit times, no fake self time)", () => {
    const t = performance.now();
    createProfilerOnRender()("Sidebar", "update", 12, 8, t - 30, t - 18);
    const event = renders()[0]!;
    expect(event).toMatchObject({ componentName: "Sidebar", durationMs: 12, phase: "update", source: "react-profiler" });
    // baseDuration is the un-memoized subtree cost, not a self time.
    expect(event.selfDurationMs).toBeUndefined();
    expect(event.timestamp).toBeCloseTo(t - 30);
    expect(event.commitTime).toBeCloseTo(t - 18);
  });
});

describe("instrumentation status (react flag in HELLO)", () => {
  it("is 'waiting' until a renderer registers or a commit is seen", async () => {
    const { getReactInstrumentationStatus, isReactInstrumented } = await import("../react/instrumentReact.js");
    expect(getReactInstrumentationStatus()).toBe("not-installed");
    const stop = instrumentReact();
    expect(getReactInstrumentationStatus()).toBe("waiting"); // React loaded before the hook would stay here
    expect(isReactInstrumented()).toBe(false);
    const hook = (window as unknown as Win)[HOOK] as { inject: (r: unknown) => number };
    hook.inject({});
    expect(isReactInstrumented()).toBe(true);
    stop();
    resetReactInstrumentation();
  });

  it("reports 'waiting' for a disabled hook even with renderers, until a commit is observed", async () => {
    const { getReactInstrumentationStatus } = await import("../react/instrumentReact.js");
    const hook = { renderers: new Map([[1, {}]]), supportsFiber: true, isDisabled: true, inject: () => 1, onCommitFiberRoot: () => undefined };
    (window as unknown as Win)[HOOK] = hook;
    const stop = instrumentReact();
    expect(getReactInstrumentationStatus()).toBe("waiting");
    (hook.onCommitFiberRoot as (id: number, root: FiberRootLike) => void)(1, mountTree().root);
    expect(getReactInstrumentationStatus()).toBe("active");
    stop();
    resetReactInstrumentation();
  });
});

describe("render start timestamps and deferred-value state", () => {
  it("uses actualStartTime for the render start and records the commit time", () => {
    const t = performance.now();
    const tree = mountTree();
    tree.app.actualStartTime = t - 12;
    const events = collectCommitRenders(tree.root);
    const app = events.find((e) => e.componentName === "App")!;
    expect(app.timestamp).toBeCloseTo(t - 12, 0);
    expect(app.commitTime).toBeGreaterThanOrEqual(t);
    // No actualStartTime: commit time minus the render duration.
    const item = events.find((e) => e.componentName === "Item")!;
    expect(item.commitTime! - item.timestamp).toBeCloseTo(2, 1);
  });

  it("a useDeferredValue re-render (queue-less hook value changed) is a state change, not wasted", () => {
    const deferredHook = (value: unknown): object => ({ memoizedState: value, queue: null, next: null });
    const effectHook = (): object => ({ memoizedState: { tag: 9, create: () => undefined, deps: [] }, queue: null, next: null });
    const first = fiber(FiberTag.FunctionComponent, App, {}, { flags: 1, memoizedState: deferredHook("a") });
    const host = link(fiber(FiberTag.HostRoot, null, null), [first]);
    collectCommitRenders({ current: host });
    const deferred = wip(first, { flags: 1, memoizedState: deferredHook("ab") });
    const [ev] = collectCommitRenders({ current: link(wip(host), [deferred]) });
    expect(ev).toMatchObject({ stateChanged: true, wasted: false });
    // Only an effect object was recreated: still wasted.
    const withEffect = fiber(FiberTag.FunctionComponent, App, {}, { flags: 1, memoizedState: effectHook() });
    const host2 = link(fiber(FiberTag.HostRoot, null, null), [withEffect]);
    collectCommitRenders({ current: host2 });
    const again = wip(withEffect, { flags: 1, memoizedState: effectHook() });
    const [ev2] = collectCommitRenders({ current: link(wip(host2), [again]) });
    expect(ev2).toMatchObject({ stateChanged: false, wasted: true });
  });
});
