// @vitest-environment jsdom
// Coexistence with the real React DevTools (see the header of "Hook installation" in
// react/instrumentReact.ts): our hook yields to RDT's installHook, adopts assigned hooks and
// keeps recording commits after the hand-off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCompatibleHook, getReactInstrumentationStatus, instrumentReact, resetReactInstrumentation } from "../react/instrumentReact.js";
import { getEvents, resetStore } from "../logger/store.js";
import { setRenderTrackingEnabled } from "../tracker/renderTracker.js";
import { resetTraceContext } from "../trace/traceContext.js";

const HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
type Win = Record<string, unknown>;
type AnyFn = (...args: any[]) => any;
type Hook = Record<string, any>;
const win = (): Win => window as unknown as Win;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function App(): null {
  return null;
}

/** Committed tree HostRoot(element) > App, App performed work. */
function root(): { current: object } {
  const app = { tag: 0, type: App, elementType: App, flags: 1, actualDuration: 2, memoizedProps: {}, child: null, sibling: null, alternate: null };
  return { current: { tag: 3, type: null, flags: 0, memoizedState: { element: {} }, child: app, sibling: null, alternate: null } };
}

const renderCount = (): number => getEvents().filter((e) => e.type === "render").length;

/**
 * Faithful model of react-devtools-shared installHook(): bails when the key is an own property,
 * attaches the renderer interface inside its own inject(), defines the hook with defineProperty.
 * (Real RDT uses configurable: false in production builds; true here so tests can clean up.)
 */
function simulateRdtInstallHook(target: Win): Hook | null {
  if ((target as { hasOwnProperty: (k: string) => boolean }).hasOwnProperty(HOOK)) return null;
  const listeners: Record<string, AnyFn[]> = {};
  const renderers = new Map<number, unknown>();
  const rendererInterfaces = new Map<number, Hook>();
  let uid = 0;
  const hook: Hook = {
    isRealRdt: true,
    renderers,
    rendererInterfaces,
    backends: new Map(),
    listeners,
    supportsFiber: true,
    on: (e: string, fn: AnyFn) => (listeners[e] ??= []).push(fn),
    emit: (e: string, d: unknown) => listeners[e]?.map((fn) => fn(d)),
    sub: (e: string, fn: AnyFn) => (hook.on(e, fn), () => undefined),
    inject(renderer: unknown) {
      const id = ++uid;
      renderers.set(id, renderer);
      const ri = { handleCommitFiberRoot: vi.fn(), handleCommitFiberUnmount: vi.fn(), handlePostCommitFiberRoot: vi.fn() };
      rendererInterfaces.set(id, ri);
      hook.emit("renderer-attached", { id, rendererInterface: ri });
      return id;
    },
    onCommitFiberRoot(id: number, r: unknown) {
      rendererInterfaces.get(id)?.handleCommitFiberRoot(r);
    },
  };
  Object.defineProperty(target, HOOK, { configurable: true, enumerable: false, get: () => hook });
  return hook;
}

let stops: Array<() => void> = [];
function install(): void {
  stops.push(instrumentReact());
}

beforeEach(() => {
  resetStore();
  resetTraceContext();
  resetReactInstrumentation();
  setRenderTrackingEnabled(true);
  delete win()[HOOK];
});

afterEach(() => {
  for (const s of stops) s();
  stops = [];
  setRenderTrackingEnabled(false);
  delete win()[HOOK];
});

describe("RDT-compatible hook shape", () => {
  it("exposes everything the React DevTools backend uses", () => {
    const hook = createCompatibleHook() as Hook;
    for (const k of ["renderers", "rendererInterfaces", "backends"]) expect(hook[k]).toBeInstanceOf(Map);
    expect(typeof hook.listeners).toBe("object");
    for (const k of ["inject", "sub", "on", "off", "emit", "getFiberRoots", "checkDCE", "onCommitFiberRoot", "onCommitFiberUnmount", "onPostCommitFiberRoot", "onScheduleFiberRoot", "setStrictMode", "getInternalModuleRanges", "registerInternalModuleStart", "registerInternalModuleStop"]) {
      expect(typeof hook[k], k).toBe("function");
    }
    expect(hook.supportsFiber).toBe(true);
    expect(hook.supportsFlight).toBe(true);
  });

  it("sub/on/off/emit, inject emits 'renderer', commits track roots and reach renderer interfaces", () => {
    const hook = createCompatibleHook() as Hook;
    const seen: unknown[] = [];
    const unsub = hook.sub("renderer", (d: unknown) => seen.push(d));
    hook.on("renderer", () => {
      throw new Error("listener bug");
    });
    const renderer = { version: "19.0.0" };
    expect(() => hook.inject(renderer)).not.toThrow();
    expect(seen).toEqual([{ id: 1, renderer }]);
    unsub();
    hook.inject({});
    expect(seen).toHaveLength(1);

    const ri = { handleCommitFiberRoot: vi.fn(), handleCommitFiberUnmount: vi.fn(), handlePostCommitFiberRoot: vi.fn() };
    hook.rendererInterfaces.set(1, ri);
    const r = root();
    hook.onCommitFiberRoot(1, r, 3);
    expect(hook.getFiberRoots(1).has(r)).toBe(true);
    expect(ri.handleCommitFiberRoot).toHaveBeenCalledWith(r, 3);
    hook.onCommitFiberUnmount(1, "fiber");
    hook.onPostCommitFiberRoot(1, r);
    expect(ri.handleCommitFiberUnmount).toHaveBeenCalledWith("fiber");
    expect(ri.handlePostCommitFiberRoot).toHaveBeenCalledWith(r);
    // unmount (element null) removes the root; bad input never throws
    hook.onCommitFiberRoot(1, { current: { memoizedState: { element: null } } });
    expect(() => hook.onCommitFiberRoot(1, null)).not.toThrow();
    ri.handleCommitFiberRoot.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => hook.onCommitFiberRoot(1, r)).not.toThrow();
  });
});

describe("our hook installed first, then React DevTools", () => {
  it("yields to RDT's installHook, re-chains, and both RDT and the engine see commits", async () => {
    install();
    const ours = win()[HOOK] as Hook;
    // The extension's content script checks too before installHook's own check: both must yield.
    expect((window as unknown as { hasOwnProperty: (k: string) => boolean }).hasOwnProperty(HOOK)).toBe(false);
    const rdt = simulateRdtInstallHook(win());
    expect(rdt).not.toBeNull();
    expect(win()[HOOK]).toBe(rdt);
    expect(win()[HOOK]).not.toBe(ours);
    await flush(); // re-chain happens in a microtask, before any later script (React) runs
    expect(Object.prototype.hasOwnProperty.call(window, "hasOwnProperty")).toBe(false); // shim removed

    const attached = vi.fn();
    rdt!.on("renderer-attached", attached);
    const id = rdt!.inject({ version: "19.0.0" });
    expect(attached).toHaveBeenCalledTimes(1);
    const r = root();
    rdt!.onCommitFiberRoot(id, r);
    expect(rdt!.rendererInterfaces.get(id).handleCommitFiberRoot).toHaveBeenCalledWith(r);
    expect(renderCount()).toBe(1);
    // The old wrapper on our abandoned hook is inert: no double counting.
    ours.onCommitFiberRoot(id, root());
    expect(renderCount()).toBe(1);
    expect(getReactInstrumentationStatus()).toBe("active");
  });

  it("does not yield once React registered with our hook (nothing may be lost)", () => {
    install();
    const ours = win()[HOOK] as Hook;
    ours.inject({});
    expect(simulateRdtInstallHook(win())).toBeNull();
    expect(win()[HOOK]).toBe(ours);
    ours.onCommitFiberRoot(1, root());
    expect(renderCount()).toBe(1);
  });

  it("adopts a hook assigned with '=' (renderers copied, re-chained synchronously)", () => {
    install();
    const ours = win()[HOOK] as Hook;
    const renderer = {};
    ours.inject(renderer);
    const original = vi.fn();
    const other: Hook = { renderers: new Map(), supportsFiber: true, inject: () => 9, onCommitFiberRoot: original };
    win()[HOOK] = other;
    expect(win()[HOOK]).toBe(other);
    expect(other.renderers.get(1)).toBe(renderer);
    other.onCommitFiberRoot(1, root());
    expect(original).toHaveBeenCalledTimes(1);
    expect(renderCount()).toBe(1);
  });

  it("re-chains lazily (status check) when the hook was replaced without a hasOwnProperty probe", () => {
    install();
    const replacement: Hook = { renderers: new Map([[1, {}]]), supportsFiber: true, inject: () => 1, onCommitFiberRoot: vi.fn() };
    Object.defineProperty(window, HOOK, { configurable: true, get: () => replacement });
    expect(getReactInstrumentationStatus()).toBe("active");
    replacement.onCommitFiberRoot(1, root());
    expect(renderCount()).toBe(1);
  });

  it("a second core copy chained on our hook follows the hand-off too", async () => {
    install();
    vi.resetModules();
    const copy2 = await import("../react/instrumentReact.js");
    const store2 = await import("../logger/store.js");
    const tracker2 = await import("../tracker/renderTracker.js");
    tracker2.setRenderTrackingEnabled(true);
    const stop2 = copy2.instrumentReact();
    const rdt = simulateRdtInstallHook(win())!;
    await flush();
    const id = rdt.inject({});
    rdt.onCommitFiberRoot(id, root());
    expect(renderCount()).toBe(1);
    expect(store2.getEvents().filter((e) => e.type === "render")).toHaveLength(1);
    stop2();
    tracker2.setRenderTrackingEnabled(false);
  });

  it("uninstall removes the hasOwnProperty shim", () => {
    const stop = instrumentReact();
    expect(Object.prototype.hasOwnProperty.call(window, "hasOwnProperty")).toBe(true);
    stop();
    expect(Object.prototype.hasOwnProperty.call(window, "hasOwnProperty")).toBe(false);
    expect(window.hasOwnProperty(HOOK)).toBe(true); // the (inert) hook itself stays
  });
});

describe("React DevTools installed first", () => {
  it("chains RDT's hook and installs no shim", () => {
    const rdt = simulateRdtInstallHook(win())!;
    install();
    expect(win()[HOOK]).toBe(rdt);
    expect(Object.prototype.hasOwnProperty.call(window, "hasOwnProperty")).toBe(false);
    const id = rdt.inject({});
    const r = root();
    rdt.onCommitFiberRoot(id, r);
    expect(rdt.rendererInterfaces.get(id).handleCommitFiberRoot).toHaveBeenCalledWith(r);
    expect(renderCount()).toBe(1);
  });
});
