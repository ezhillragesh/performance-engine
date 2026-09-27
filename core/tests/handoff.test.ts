// @vitest-environment jsdom
/**
 * Two independent copies of core on one page (extension-injected bundle +
 * the app's own bundle): docs/PROTOCOL.md "Handoff between two engine copies".
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { PANEL_MESSAGE_SOURCE, PROTOCOL_VERSION, type HelloMessage, type PageMessage } from "../types/protocol.js";
import type { RenderEvent } from "../types/events.js";

type Core = typeof import("../index.js");
type Win = Record<string, unknown>;

const HOOK = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
const GLOBAL = "__PERF_ENGINE_GLOBAL__";

/** A fresh, independent module copy of core (own store, trackers, hook wrapper). */
async function loadCopy(): Promise<Core> {
  vi.resetModules();
  return (await import("../index.js")) as Core;
}

let postSpy: MockInstance<typeof window.postMessage>;
let fetchSpy: ReturnType<typeof vi.fn>;
const nativeFetch = globalThis.fetch;

function sent(): PageMessage[] {
  return postSpy.mock.calls.map((call) => call[0] as PageMessage);
}

function ping(): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { source: PANEL_MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: "COMMAND", command: "PING" },
      source: window,
    }),
  );
}

function App(): null {
  return null;
}
function Item(): null {
  return null;
}

/** Minimal committed tree: HostRoot > App > Item (both performed work). */
function mountRoot(): { current: object } {
  const item = { tag: 0, type: Item, elementType: Item, flags: 1, actualDuration: 1, memoizedProps: {}, child: null, sibling: null, alternate: null };
  const app = { tag: 0, type: App, elementType: App, flags: 1, actualDuration: 2, memoizedProps: {}, child: item, sibling: null, alternate: null };
  const host = { tag: 3, type: null, elementType: null, flags: 0, child: app, sibling: null, alternate: null };
  return { current: host };
}

function commit(): void {
  const hook = (window as unknown as Win)[HOOK] as { onCommitFiberRoot: (id: number, root: object) => void };
  hook.onCommitFiberRoot(1, mountRoot());
}

function renders(core: Core): RenderEvent[] {
  return core.getEvents().filter((e): e is RenderEvent => e.type === "render");
}

let copies: Core[] = [];

beforeEach(() => {
  delete (window as unknown as Win)[HOOK];
  delete (window as unknown as Win)[GLOBAL];
  postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
  fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  copies = [];
});

afterEach(() => {
  for (const core of copies) core.getActiveSession()?.stop();
  postSpy.mockRestore();
  globalThis.fetch = nativeFetch;
  delete (window as unknown as Win)[GLOBAL];
});

describe("engine handoff between two core copies", () => {
  it("app engine replaces the injected one: one bridge, one recorder", async () => {
    const injected = await loadCopy();
    const app = await loadCopy();
    copies = [injected, app];
    expect(injected.initPerfEngine).not.toBe(app.initPerfEngine);

    // Extension bundle at document_start.
    injected.instrumentReact();
    const injectedSession = injected.initPerfEngine({ mode: "injected" });
    expect((window as unknown as Win)[GLOBAL]).toMatchObject({ kind: "injected", sessionId: injectedSession.sessionId });
    expect(injectedSession.mode).toBe("injected");
    const helloInjected = sent().find((m): m is HelloMessage => m.type === "HELLO");
    expect(helloInjected?.payload.config.mode).toBe("injected");
    const patchedByInjected = globalThis.fetch;
    expect(patchedByInjected).not.toBe(fetchSpy);

    // App bundle (its perf.ts runs before react-dom).
    app.instrumentReact();
    const appSession = app.initPerfEngine();
    expect(appSession.mode).toBe("app");
    expect(injected.getActiveSession()).toBeNull();
    expect(app.getActiveSession()).toBe(appSession);
    expect((window as unknown as Win)[GLOBAL]).toMatchObject({ kind: "app", sessionId: appSession.sessionId });

    // Injected fetch patch removed, app patch installed over the native fetch.
    expect(globalThis.fetch).not.toBe(patchedByInjected);
    await globalThis.fetch("/api/x");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Exactly one bridge answers PING, reporting the app engine.
    postSpy.mockClear();
    ping();
    const hellos = sent().filter((m): m is HelloMessage => m.type === "HELLO");
    expect(hellos).toHaveLength(1);
    expect(hellos[0]!.payload.sessionId).toBe(appSession.sessionId);
    expect(hellos[0]!.payload.config.mode).toBe("app");

    // Both wrappers are chained on the hook; only the owner records.
    commit();
    expect(renders(injected)).toHaveLength(0);
    expect(renders(app).map((r) => r.componentName).sort()).toEqual(["App", "Item"]);

    // Stopping flushes fetches still waiting for their resource-timing entry.
    appSession.stop();
    expect(injected.getEvents().filter((e) => e.type === "network")).toHaveLength(0);
    expect(app.getEvents().filter((e) => e.type === "network")).toHaveLength(1);
    expect(globalThis.fetch).toBe(fetchSpy);
  });

  it("app copy instrumenting after the injected copy chained the hook does not double count", async () => {
    const injected = await loadCopy();
    const app = await loadCopy();
    copies = [injected, app];
    injected.instrumentReact();
    injected.initPerfEngine({ mode: "injected" });

    // Before the app engine starts, the injected engine records.
    commit();
    expect(renders(injected)).toHaveLength(2);

    // App starts its session first and instruments React afterwards.
    app.initPerfEngine();
    app.instrumentReact();
    commit();
    expect(renders(app)).toHaveLength(2);
    expect(renders(injected)).toHaveLength(2); // stopped copy stays inert

    // A stopped foreign copy re-enabling its own render flag still cannot emit.
    injected.setRenderTrackingEnabled(true);
    commit();
    expect(renders(injected)).toHaveLength(2);
    expect(renders(app)).toHaveLength(4);
  });

  it("when the app copy stops, the global registration is cleared", async () => {
    const app = await loadCopy();
    copies = [app];
    const session = app.initPerfEngine();
    expect((window as unknown as Win)[GLOBAL]).toMatchObject({ kind: "app" });
    session.stop();
    expect((window as unknown as Win)[GLOBAL]).toBeUndefined();
  });

  it("a stopped copy's fetch patch becomes a pass-through when it cannot be unhooked", async () => {
    const injected = await loadCopy();
    const app = await loadCopy();
    copies = [injected, app];
    injected.initPerfEngine({ mode: "injected" });
    // A third party wraps fetch on top of the injected patch.
    const inner = globalThis.fetch;
    const thirdParty = vi.fn((input: RequestInfo | URL, init?: RequestInit) => inner(input, init));
    globalThis.fetch = thirdParty as unknown as typeof fetch;
    app.initPerfEngine();
    await globalThis.fetch("/api/y");
    expect(thirdParty).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    app.getActiveSession()!.stop();
    expect(injected.getEvents().filter((e) => e.type === "network")).toHaveLength(0);
    expect(app.getEvents().filter((e) => e.type === "network")).toHaveLength(1);
  });

  it("injected engine defers its first HELLO to DOMContentLoaded and never announces if replaced before", async () => {
    const injected = await loadCopy();
    const app = await loadCopy();
    copies = [injected, app];
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    try {
      injected.initPerfEngine({ mode: "injected" });
      expect(sent().filter((m) => m.type === "HELLO")).toHaveLength(0);
      const appSession = app.initPerfEngine(); // app bundle runs before DOMContentLoaded
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await new Promise((r) => setTimeout(r, 5));
      const hellos = sent().filter((m): m is HelloMessage => m.type === "HELLO");
      expect(hellos.map((h) => [h.payload.sessionId, h.payload.config.mode])).toEqual([[appSession.sessionId, "app"]]);
    } finally {
      delete (document as unknown as Win).readyState;
    }
  });

  it("injected engine alone stays silent until DOMContentLoaded, then announces", async () => {
    const injected = await loadCopy();
    copies = [injected];
    Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
    try {
      const session = injected.initPerfEngine({ mode: "injected" });
      ping(); // e.g. the background's PING on tab "loading": answered by the deferred HELLO
      expect(sent().filter((m) => m.type === "HELLO")).toHaveLength(0);
      document.dispatchEvent(new Event("DOMContentLoaded"));
      await new Promise((r) => setTimeout(r, 5));
      let hellos = sent().filter((m): m is HelloMessage => m.type === "HELLO");
      expect(hellos.map((h) => [h.payload.sessionId, h.payload.config.mode])).toEqual([[session.sessionId, "injected"]]);
      ping();
      hellos = sent().filter((m): m is HelloMessage => m.type === "HELLO");
      expect(hellos).toHaveLength(2);
    } finally {
      delete (document as unknown as Win).readyState;
    }
  });
});
