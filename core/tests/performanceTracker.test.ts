import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interactionFromEntry, isBetterInteractionEntry, longTaskFromEntry, startPerformanceTracking } from "../tracker/performanceTracker.js";
import { getEvents, resetStore } from "../logger/store.js";
import { onUserEvent, resetTraceContext } from "../trace/traceContext.js";
import { setTimeSource } from "../tracker/time.js";

let clock = 0;
const g = globalThis as { PerformanceObserver?: unknown };
const realObserver = g.PerformanceObserver;

type Callback = (list: { getEntries(): unknown[] }) => void;
const observers: { type: string; options: Record<string, unknown>; cb: Callback }[] = [];

class FakeObserver {
  static supportedEntryTypes: string[] = ["long-animation-frame", "longtask", "event"];
  constructor(private cb: Callback) {}
  observe(options: { type: string } & Record<string, unknown>): void {
    observers.push({ type: options.type, options, cb: this.cb });
  }
  disconnect(): void {
    const idx = observers.findIndex((o) => o.cb === this.cb);
    if (idx >= 0) observers.splice(idx, 1);
  }
}

function emit(type: string, entries: unknown[]): void {
  for (const o of observers.filter((x) => x.type === type)) o.cb({ getEntries: () => entries });
}

beforeEach(() => {
  clock = 1000;
  setTimeSource(() => clock);
  resetStore();
  resetTraceContext();
  observers.length = 0;
  FakeObserver.supportedEntryTypes = ["long-animation-frame", "longtask", "event"];
  g.PerformanceObserver = FakeObserver;
});

afterEach(() => {
  g.PerformanceObserver = realObserver;
  setTimeSource(undefined);
});

describe("performance tracker", () => {
  it("maps LoAF entries with script attribution and the active trace", () => {
    const { traceId } = onUserEvent("click", 1000);
    const event = longTaskFromEntry(
      {
        startTime: 1010,
        duration: 180,
        blockingDuration: 130,
        scripts: [
          { invoker: "BUTTON#save.onclick", sourceURL: "https://app/x.js?v=1", sourceFunctionName: "save", duration: 150 },
          { invokerType: "event-listener", duration: 10 },
        ],
      },
      "long-animation-frame",
    );
    expect(event).toMatchObject({ type: "longtask", duration: 180, blockingDuration: 130, traceId, timestamp: 1010 });
    expect(event.scripts![0]).toEqual({ invoker: "BUTTON#save.onclick", sourceURL: "https://app/x.js", sourceFunctionName: "save", duration: 150 });
    expect(event.scripts![1]!.invoker).toBe("event-listener");
  });

  it("derives blocking time for the legacy longtask API", () => {
    expect(longTaskFromEntry({ startTime: 0, duration: 120 }, "longtask").blockingDuration).toBe(70);
  });

  it("maps Event Timing entries to phases and the trace with the closest trigger", () => {
    const { traceId } = onUserEvent("click", 1000);
    const event = interactionFromEntry({
      name: "click",
      startTime: 1003,
      duration: 240,
      processingStart: 1033,
      processingEnd: 1183,
      interactionId: 5,
      target: null,
    });
    expect(event).toMatchObject({ inputDelay: 30, processingMs: 150, presentationDelay: 60, interactionId: 5, traceId });
    expect(interactionFromEntry({ name: "click", startTime: 5000, duration: 50 }).traceId).toBeUndefined();
  });

  it("observes LoAF + event timing, dedupes one interaction and stops cleanly", () => {
    const stop = startPerformanceTracking();
    expect(observers.map((o) => o.type).sort()).toEqual(["event", "long-animation-frame"]);
    expect(observers.find((o) => o.type === "event")!.options).toMatchObject({ durationThreshold: 16, buffered: true });
    emit("long-animation-frame", [{ startTime: 10, duration: 90, blockingDuration: 40, scripts: [] }]);
    emit("event", [
      { name: "pointerdown", startTime: 100, duration: 120, interactionId: 9 },
      { name: "click", startTime: 101, duration: 120, interactionId: 9 },
      { name: "mousemove", startTime: 200, duration: 40, interactionId: 0 },
    ]);
    const types = getEvents().map((e) => e.type);
    expect(types).toEqual(["longtask", "interaction"]);
    stop();
    stop();
    expect(observers).toHaveLength(0);
  });

  it("on a duration tie keeps the entry with the most processing time (Chrome rounds to 8ms)", () => {
    const stop = startPerformanceTracking();
    // Regression: pointerdown (no listener) used to win because it arrives first.
    emit("event", [
      { name: "pointerdown", startTime: 100, duration: 104, processingStart: 102, processingEnd: 102.5, interactionId: 7 },
      { name: "pointerup", startTime: 150, duration: 56, processingStart: 151, processingEnd: 151.2, interactionId: 7 },
      { name: "click", startTime: 152, duration: 104, processingStart: 153, processingEnd: 233, interactionId: 7 },
    ]);
    const interactions = getEvents().filter((e) => e.type === "interaction");
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ name: "click", interactionId: 7, processingMs: 80 });
    // A later, worse (or equal) entry of the same interaction is not reported again.
    emit("event", [{ name: "keyup", startTime: 300, duration: 104, processingStart: 301, processingEnd: 302, interactionId: 7 }]);
    expect(getEvents().filter((e) => e.type === "interaction")).toHaveLength(1);
    stop();
  });

  it("drops id-0 pointer/mouse/touch companions but keeps id-0 keyboard/click entries", () => {
    const stop = startPerformanceTracking();
    emit("event", [
      { name: "mousedown", startTime: 100, duration: 40, interactionId: 0 },
      { name: "mouseup", startTime: 120, duration: 40, interactionId: 0 },
      { name: "pointerdown", startTime: 100, duration: 40, interactionId: 0 },
      { name: "touchstart", startTime: 100, duration: 40, interactionId: 0 },
      { name: "click", startTime: 121, duration: 40, interactionId: 3 },
      { name: "keydown", startTime: 400, duration: 32, interactionId: 0 },
    ]);
    expect(getEvents().map((e) => (e.type === "interaction" ? `${e.name}:${e.interactionId}` : e.type))).toEqual(["click:3", "keydown:0"]);
    stop();
  });

  it("isBetterInteractionEntry prefers longer, then more processing", () => {
    expect(isBetterInteractionEntry({ duration: 16, processing: 0 }, undefined)).toBe(true);
    expect(isBetterInteractionEntry({ duration: 112, processing: 0 }, { duration: 104, processing: 90 })).toBe(true);
    expect(isBetterInteractionEntry({ duration: 104, processing: 90 }, { duration: 104, processing: 1 })).toBe(true);
    expect(isBetterInteractionEntry({ duration: 104, processing: 1 }, { duration: 104, processing: 1 })).toBe(false);
  });

  it("falls back to longtask when LoAF is unsupported and is a no-op without PerformanceObserver", () => {
    FakeObserver.supportedEntryTypes = ["longtask"];
    const stop = startPerformanceTracking();
    expect(observers.map((o) => o.type)).toEqual(["longtask"]);
    stop();
    g.PerformanceObserver = undefined;
    expect(() => startPerformanceTracking()()).not.toThrow();
  });
});
