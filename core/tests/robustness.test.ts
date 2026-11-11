/**
 * Regression tests for v0.4 robustness fixes: untyped / non-finite config,
 * stale session handles, malformed events and custom-rule output, sampling.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveSession, initPerfEngine, isSampledIn, type PerfEngineConfig, type PerfEngineSession } from "../session.js";
import { getEvents, getMaxStoreSize, getRecentEvents, getStoreStats, MAX_STORE_SIZE, pushEvent, pushEvents, resetStore, setMaxStoreSize } from "../logger/store.js";
import { isRenderTrackingEnabled, setRenderTrackingEnabled, trackRender } from "../tracker/renderTracker.js";
import { isActionTrackingEnabled } from "../trace/actions.js";
import { analyzeEvents } from "../analyzer/engine.js";
import { readEngineGlobal } from "../runtime/engineGlobal.js";
import { startDevtoolsBridge, type BridgeSession } from "../bridge/devtoolsBridge.js";
import { setTimeSource } from "../tracker/time.js";
import { ENGINE_VERSION } from "../types/protocol.js";
import type { Insight } from "../types/insights.js";
import type { RenderEvent } from "../types/events.js";
import { render, TraceBuilder } from "./fixtures.js";

let clock = 0;
let session: PerfEngineSession | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  setTimeSource(() => clock);
});

afterEach(() => {
  session?.stop();
  getActiveSession()?.stop();
  session = null;
  vi.useRealTimers();
  setTimeSource(undefined);
  resetStore();
});

function slowClick(at: number): void {
  const b = new TraceBuilder();
  b.trigger("click", at);
  b.commitAt(at + 300, ["App"]);
  for (const e of b.events) pushEvent(e);
}

describe("bounded store with untyped sizes", () => {
  it("NaN / Infinity / strings fall back to the default size instead of disabling the bound", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "500" as unknown as number]) {
      setMaxStoreSize(bad);
      expect(getMaxStoreSize()).toBe(2000);
    }
    setMaxStoreSize(10_000_000);
    expect(getMaxStoreSize()).toBe(MAX_STORE_SIZE);
    setMaxStoreSize(3);
    expect(getMaxStoreSize()).toBe(100);
  });

  it("initPerfEngine({ maxEvents: NaN }) keeps the store bounded", () => {
    session = initPerfEngine({ maxEvents: Number.NaN });
    for (let i = 0; i < 2600; i += 1) pushEvent(render("A", i));
    expect(getStoreStats().size).toBeLessThanOrEqual(2000);
    expect(Number.isFinite(getStoreStats().trimmedEvents)).toBe(true);
  });

  it("rejects events without a finite timestamp so the store stays sorted", () => {
    resetStore(100);
    pushEvent(render("A", 10));
    expect(pushEvent(render("Bad", Number.NaN))).toBe(false);
    expect(pushEvents([render("Bad", Number.POSITIVE_INFINITY), render("B", 5), null as unknown as RenderEvent])).toBe(1);
    pushEvent(render("C", 7));
    expect(getEvents().map((e) => e.timestamp)).toEqual([5, 7, 10]);
  });

  it("getRecentEvents tolerates NaN and negative counts", () => {
    resetStore(100);
    for (let i = 0; i < 5; i += 1) pushEvent(render("A", i));
    expect(getRecentEvents(Number.NaN)).toHaveLength(5);
    expect(getRecentEvents(-3)).toHaveLength(0);
    expect(getRecentEvents(2.7).map((e) => e.timestamp)).toEqual([3, 4]);
  });

  it("trackRender with a NaN start time records it at the current time", () => {
    resetStore(100);
    setRenderTrackingEnabled(true);
    try {
      clock = 1234;
      trackRender("A", 3, undefined, undefined, { timestamp: Number.NaN });
      trackRender("" as string, 1);
      const [a, b] = getEvents() as RenderEvent[];
      expect(a).toMatchObject({ componentName: "A", timestamp: 1234 });
      expect(b!.componentName).toBe("Anonymous");
    } finally {
      setRenderTrackingEnabled(false);
    }
  });
});

describe("session config hardening", () => {
  it("a null config (plain JS) does not throw", () => {
    session = initPerfEngine(null as unknown as PerfEngineConfig);
    expect(session.features.trackEvents).toBe(true);
  });

  it("non-finite analysisIntervalMs falls back to the default instead of a busy timer", () => {
    const listener = vi.fn();
    for (const analysisIntervalMs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      session = initPerfEngine({ analysisIntervalMs });
      session.subscribe(listener);
      slowClick(0);
      vi.advanceTimersByTime(1999);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);
      listener.mockClear();
      session.stop();
    }
  });

  it("ignores custom rules that are not rule objects", () => {
    const run = vi.fn(() => []);
    session = initPerfEngine({ customRules: ["oops", null, { name: "ok", run }] as unknown as PerfEngineConfig["customRules"] });
    slowClick(0);
    expect(() => session!.analyzeNow()).not.toThrow();
    expect(run).toHaveBeenCalled();
  });
});

describe("stale session handles", () => {
  it("a stopped, replaced session cannot clear, pause or read the active session's store", () => {
    const first = initPerfEngine();
    slowClick(0);
    const firstInsights = first.analyzeNow();
    expect(firstInsights.length).toBeGreaterThan(0);
    session = initPerfEngine();
    slowClick(5000);
    const before = session.getEvents().length;
    expect(before).toBeGreaterThan(0);

    first.clear();
    first.pause();
    expect(session.getEvents()).toHaveLength(before);
    expect(session.isPaused()).toBe(false);
    expect(first.getEvents()).toEqual([]);
    expect(first.getSnapshot().events).toEqual([]);
    // It keeps its own last results instead of analysing the newer session's events.
    expect(first.getInsights().map((i) => i.id)).toEqual(firstInsights.map((i) => i.id));
  });

  it("a stopped session without a successor still reads its data", () => {
    const only = initPerfEngine();
    slowClick(0);
    only.stop();
    expect(only.getEvents().length).toBeGreaterThan(0);
    expect(only.analyzeNow().length).toBeGreaterThan(0);
  });
});

describe("custom rule output normalisation", () => {
  it("fills string fields a JS custom rule left out", () => {
    const sloppy = {
      name: "sloppy",
      run: () => [{ id: "x", issueType: "long-task", category: "main-thread", severity: "high", confidence: 0.5, evidence: [], impact: { estimatedDelayMs: Number.NaN } } as unknown as Insight],
    };
    const [insight] = analyzeEvents([], { rules: [sloppy] });
    expect(insight).toMatchObject({ id: "x", source: "unknown", message: "", cause: "", possibleFix: "" });
    expect(insight!.impact.estimatedDelayMs).toBe(0);
  });
});

describe("sampling", () => {
  it("isSampledIn: 1 / undefined / NaN always, 0 never, otherwise by the random draw", () => {
    expect(isSampledIn(undefined)).toBe(true);
    expect(isSampledIn(Number.NaN)).toBe(true);
    expect(isSampledIn(1)).toBe(true);
    expect(isSampledIn(0)).toBe(false);
    expect(isSampledIn(-1)).toBe(false);
    expect(isSampledIn(0.25, () => 0.2)).toBe(true);
    expect(isSampledIn(0.25, () => 0.25)).toBe(false);
  });

  it("an unsampled session installs nothing, records nothing and does not claim the page", () => {
    const listener = vi.fn();
    session = initPerfEngine({ sampleRate: 0 });
    session.subscribe(listener);
    expect(session.sampled).toBe(false);
    expect(Object.values(session.features).every((v) => v === false)).toBe(true);
    expect(isRenderTrackingEnabled()).toBe(false);
    expect(isActionTrackingEnabled()).toBe(false);
    expect(readEngineGlobal()).toBeUndefined();
    trackRender("A", 5);
    vi.advanceTimersByTime(10_000);
    expect(session.getEvents()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSnapshot().insights).toEqual([]);
  });

  it("a sampled session registers itself and enables recording", () => {
    session = initPerfEngine({ sampleRate: 1 });
    expect(session.sampled).toBe(true);
    expect(readEngineGlobal()?.sessionId).toBe(session.sessionId);
    expect(isActionTrackingEnabled()).toBe(true);
    session.stop();
    expect(isActionTrackingEnabled()).toBe(false);
  });
});

describe("devtools bridge timers", () => {
  it("a non-finite snapshotIntervalMs falls back to 1s", () => {
    const win = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), document: undefined, location: { origin: "", pathname: "" } };
    const getSnapshot = vi.fn(() => ({ events: [], insights: [], summary: { renders: 0 }, paused: false }) as unknown as ReturnType<BridgeSession["getSnapshot"]>);
    let sig = 0;
    const fake: BridgeSession = {
      sessionId: "s",
      getSnapshot,
      isPaused: () => false,
      pause: () => undefined,
      resume: () => undefined,
      clear: () => undefined,
      setBudgets: () => undefined,
      getChangeSignature: () => String((sig += 1)),
    };
    const stop = startDevtoolsBridge(fake, { target: win as unknown as Window, snapshotIntervalMs: Number.POSITIVE_INFINITY });
    const onMessage = win.addEventListener.mock.calls.find((c) => c[0] === "message")![1] as (e: unknown) => void;
    onMessage({ source: win, data: { source: "perf-engine-devtools", version: 2, type: "COMMAND", command: "ATTACH" } });
    getSnapshot.mockClear();
    vi.advanceTimersByTime(999);
    expect(getSnapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("release metadata", () => {
  it("ENGINE_VERSION matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});
