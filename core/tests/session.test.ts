import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initPerfEngine, getActiveSession, type PerfEngineSession } from "../session.js";
import { getMaxStoreSize, pushEvent } from "../logger/store.js";
import { isRenderTrackingEnabled, trackRender } from "../tracker/renderTracker.js";
import { setTimeSource } from "../tracker/time.js";
import { ENGINE_VERSION } from "../types/protocol.js";
import type { Insight } from "../types/insights.js";
import { longTask, TraceBuilder } from "./fixtures.js";
import { captureTraceId, getActiveTraceId, onUserEvent } from "../trace/traceContext.js";

let clock = 0;
let session: PerfEngineSession | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  setTimeSource(() => clock);
});

afterEach(() => {
  session?.stop();
  session = null;
  vi.useRealTimers();
  setTimeSource(undefined);
});

function slowClick(at: number): void {
  const b = new TraceBuilder();
  b.trigger("click", at);
  b.commitAt(at + 300, ["App"]);
  for (const e of b.events) pushEvent(e);
}

describe("session lifecycle", () => {
  it("defaults all trackers on and is SSR-safe in Node", () => {
    session = initPerfEngine();
    expect(session.features).toEqual({
      trackEvents: true,
      trackNetwork: true,
      trackRenders: true,
      trackLongTasks: true,
      trackInteractions: true,
      trackWebVitals: true,
    });
    expect(session.sampled).toBe(true);
    expect(isRenderTrackingEnabled()).toBe(true);
    expect(session.getSnapshot().engineVersion).toBe(ENGINE_VERSION);
  });

  it("stop() is idempotent and a stale session cannot disable the active one (#22)", () => {
    const first = initPerfEngine();
    session = initPerfEngine();
    expect(getActiveSession()).toBe(session);
    first.stop();
    first.stop();
    expect(isRenderTrackingEnabled()).toBe(true);
    session.stop();
    session.stop();
    expect(isRenderTrackingEnabled()).toBe(false);
    expect(getActiveSession()).toBeNull();
  });

  it("resets maxEvents per session (#23)", () => {
    initPerfEngine({ maxEvents: 150 });
    expect(getMaxStoreSize()).toBe(150);
    session = initPerfEngine();
    expect(getMaxStoreSize()).toBe(2000);
  });

  it("publishes the full insight list only when it changes; analyzeNow publishes too (#20, #21)", () => {
    const onInsights = vi.fn<(insights: Insight[]) => void>();
    session = initPerfEngine({ onInsights, analysisIntervalMs: 1000 });
    slowClick(0);
    vi.advanceTimersByTime(1000);
    expect(onInsights).toHaveBeenCalledTimes(1);
    const firstList = onInsights.mock.calls[0]![0];
    expect(firstList.length).toBeGreaterThan(0);

    vi.advanceTimersByTime(5000); // nothing new
    expect(onInsights).toHaveBeenCalledTimes(1);

    slowClick(2000);
    const now = session.analyzeNow();
    expect(onInsights).toHaveBeenCalledTimes(2);
    const secondList = onInsights.mock.calls[1]![0];
    expect(secondList).toEqual(now);
    // Full list, including the insight that was already published.
    for (const i of firstList) expect(secondList.some((s) => s.id === i.id)).toBe(true);
  });

  it("pause drops events and counts them; resume records again", () => {
    session = initPerfEngine();
    session.pause();
    expect(session.isPaused()).toBe(true);
    trackRender("A", 1);
    trackRender("B", 1);
    expect(session.getEvents()).toHaveLength(0);
    expect(session.getSnapshot().droppedEvents).toBe(2);
    expect(session.getSnapshot().paused).toBe(true);
    session.resume();
    trackRender("C", 1);
    expect(session.getEvents().map((e) => (e.type === "render" ? e.componentName : ""))).toEqual(["C"]);
  });

  it("clear() empties events and insights and notifies", () => {
    const onInsights = vi.fn<(insights: Insight[]) => void>();
    session = initPerfEngine({ onInsights });
    const onReset = vi.fn();
    session.onReset(onReset);
    slowClick(0);
    expect(session.analyzeNow().length).toBeGreaterThan(0);
    session.clear();
    expect(session.getEvents()).toHaveLength(0);
    expect(session.getInsights()).toEqual([]);
    expect(onInsights).toHaveBeenLastCalledWith([]);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("setBudgets re-analyses with the new limits", () => {
    session = initPerfEngine({ budgets: { longTaskMs: 50 } });
    pushEvent(longTask(0, 80));
    expect(session.analyzeNow().some((i) => i.issueType === "long-task")).toBe(true);
    session.setBudgets({ longTaskMs: 100 });
    expect(session.getBudgets().longTaskMs).toBe(100);
    expect(session.getInsights().some((i) => i.issueType === "long-task")).toBe(false);
    expect(session.getSummary().budgets.find((b) => b.key === "longTaskMs")!.limit).toBe(100);
  });

  it("subscribe() fires after analysis ticks with a structured-clone-safe snapshot", () => {
    session = initPerfEngine({ analysisIntervalMs: 500 });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    slowClick(0);
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = listener.mock.calls[0]![0];
    expect(snapshot.events.length).toBeGreaterThan(0);
    expect(snapshot.traces).toHaveLength(1);
    expect(() => structuredClone(snapshot)).not.toThrow();
    unsubscribe();
    slowClick(1000);
    vi.advanceTimersByTime(500);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a throwing custom rule does not break the analysis tick (#19)", () => {
    const onInsights = vi.fn();
    session = initPerfEngine({
      onInsights,
      analysisIntervalMs: 100,
      customRules: [{ name: "boom", run: () => { throw new Error("x"); } }],
    });
    slowClick(0);
    vi.advanceTimersByTime(100);
    expect(onInsights).toHaveBeenCalledTimes(1);
  });

  it("change signature moves with data, pause state and budgets", () => {
    session = initPerfEngine();
    const a = session.getChangeSignature();
    trackRender("A");
    const b = session.getChangeSignature();
    session.pause();
    const c = session.getChangeSignature();
    session.setBudgets({ longTaskMs: 10 });
    const d = session.getChangeSignature();
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
});

describe("session notifications and trace attribution", () => {
  it("getters refresh lazily but never notify synchronously; the next tick delivers", () => {
    const onInsights = vi.fn();
    session = initPerfEngine({ onInsights, analysisIntervalMs: 1000 });
    const listener = vi.fn();
    session.subscribe(listener);
    slowClick(0);
    // e.g. called from inside an app click handler
    expect(session.getInsights().length).toBeGreaterThan(0);
    expect(onInsights).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onInsights).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("work done by subscribers on an analysis tick is not attributed to the user's open trace", () => {
    session = initPerfEngine({ analysisIntervalMs: 1000 });
    const seen: (string | undefined)[] = [];
    session.subscribe(() => {
      seen.push(captureTraceId()); // e.g. a UI re-rendering engine stats
    });
    trackRender("A");
    vi.advanceTimersByTime(999);
    const { traceId } = onUserEvent("click"); // user clicks just before the tick
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([undefined]);
    expect(traceId).toBeDefined();
    // The trace itself stays open for the user's own work.
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      expect(getActiveTraceId()).toBe(traceId);
    });
  });
});

