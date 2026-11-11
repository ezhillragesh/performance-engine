import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ACTION_NAME_LENGTH, setActionTrackingEnabled, startAction, trackAction } from "../trace/actions.js";
import { findTraceByTriggerTime, getActiveTraceId, onUserEvent, resetTraceContext, TRACE_IDLE_MS } from "../trace/traceContext.js";
import { getEvents, pushEvent, resetStore } from "../logger/store.js";
import { setRenderTrackingEnabled, trackRender } from "../tracker/renderTracker.js";
import { setTimeSource } from "../tracker/time.js";
import { buildAnalysisContext } from "../analyzer/context.js";
import { analyzeEvents } from "../analyzer/engine.js";
import { buildTraceSummaries } from "../analyzer/traces.js";
import { computeSummary } from "../analyzer/summary.js";
import { initPerfEngine } from "../session.js";
import type { UIEvent } from "../types/events.js";
import { net } from "./fixtures.js";

let clock = 0;

beforeEach(() => {
  clock = 1000;
  setTimeSource(() => clock);
  resetStore();
  resetTraceContext();
  setActionTrackingEnabled(true);
  setRenderTrackingEnabled(true);
});

afterEach(() => {
  setActionTrackingEnabled(false);
  setRenderTrackingEnabled(false);
  setTimeSource(undefined);
  vi.useRealTimers();
});

const uiEvents = (): UIEvent[] => getEvents().filter((e): e is UIEvent => e.type === "ui");

describe("startAction / trackAction", () => {
  it("outside a trace, opens a new trace triggered by an action event", () => {
    const action = startAction("  checkout\n flow ");
    expect(action).toMatchObject({ name: "checkout flow", startsTrace: true });
    expect(getActiveTraceId()).toBe(action.traceId);
    const [event] = uiEvents();
    expect(event).toMatchObject({ eventType: "action", target: "checkout flow", traceId: action.traceId, startsTrace: true });
    clock += 5;
    trackRender("Cart", 3);
    expect(getEvents().find((e) => e.type === "render")!.traceId).toBe(action.traceId);
  });

  it("inside a live trace (a click handler) joins it; the click stays the trigger", () => {
    const { traceId } = onUserEvent("click", clock);
    pushEvent({ type: "ui", eventType: "click", target: "button#buy", timestamp: clock, eventId: "c1", sessionId: "s", traceId, startsTrace: true });
    clock += 1;
    const action = startAction("checkout");
    expect(action).toMatchObject({ traceId, startsTrace: false });
    action.end(); // must not cut the click's trace
    expect(getActiveTraceId()).toBe(traceId);

    clock += 10;
    trackRender("Cart", 4, undefined, undefined, { commitId: 1 });
    const context = buildAnalysisContext(getEvents());
    expect(context.traces).toHaveLength(1);
    const [summary] = buildTraceSummaries(context, []);
    expect(summary!.trigger.eventType).toBe("click");
    expect(summary!.action).toBe("checkout");
  });

  it("{ newTrace: true } splits off its own trace even inside a live one", () => {
    const { traceId } = onUserEvent("click", clock);
    const action = startAction("sync", { newTrace: true });
    expect(action.startsTrace).toBe(true);
    expect(action.traceId).not.toBe(traceId);
  });

  it("end() stops attribution to the action's own trace", () => {
    const action = startAction("load");
    action.end();
    action.end();
    expect(getActiveTraceId()).toBeUndefined();
    trackRender("Late", 1);
    expect(getEvents().find((e) => e.type === "render")!.traceId).toBeUndefined();
  });

  it("run() re-attaches after a non-network await and keeps the promise semantics", async () => {
    const action = startAction("save");
    await new Promise((resolve) => setTimeout(resolve, 0)); // the starting task ends (unpins the trace)
    clock += TRACE_IDLE_MS * 3; // the trace has gone idle meanwhile (e.g. a 500ms timer)
    expect(getActiveTraceId()).toBeUndefined();
    const value = await action.run(async () => {
      trackRender("Saved", 2);
      return 42;
    });
    expect(value).toBe(42);
    expect(getEvents().find((e) => e.type === "render")!.traceId).toBe(action.traceId);
    // Continuation after the awaited promise is attributed too.
    expect(getActiveTraceId()).toBe(action.traceId);

    await expect(trackAction("fail", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(() => trackAction("sync-throw", () => {
      throw new Error("sync");
    })).toThrow("sync");
    expect(trackAction("plain", () => "ok")).toBe("ok");
  });

  it("records nothing while no session runs, but still runs the code", () => {
    setActionTrackingEnabled(false);
    const action = startAction("idle");
    expect(action.traceId).toBeUndefined();
    expect(action.run(() => 7)).toBe(7);
    action.end();
    expect(getEvents()).toEqual([]);
    expect(getActiveTraceId()).toBeUndefined();
  });

  it("bounds the name and falls back for non-strings", () => {
    expect(startAction("x".repeat(500)).name).toHaveLength(MAX_ACTION_NAME_LENGTH);
    expect(startAction(undefined as unknown as string).name).toBe("action");
  });

  it("an action trace is never matched to browser input timing", () => {
    startAction("route:/inbox");
    expect(findTraceByTriggerTime(clock, 50)).toBeUndefined();
  });
});

describe("analysis of action traces", () => {
  it("is analysed like a trace, but does not count as an interaction or input latency", () => {
    const action = startAction("route:/inbox");
    const traceId = action.traceId!;
    const events = [
      ...getEvents(),
      net("/api/inbox", clock + 1, 400, { traceId }),
      ...Array.from({ length: 30 }, (_, i) => ({
        type: "render" as const,
        componentName: `Row`,
        instanceId: `Row#${i}`,
        durationMs: 2,
        timestamp: clock + 450,
        commitId: 9,
        phase: "update" as const,
        eventId: `r${i}`,
        sessionId: "s",
        traceId,
      })),
    ];
    const insights = analyzeEvents(events);
    expect(insights.some((i) => i.traceId === traceId)).toBe(true);
    const latency = insights.find((i) => i.issueType === "interaction-render-latency");
    expect(latency?.message).toContain('action "route:/inbox"');

    const summary = computeSummary(events, insights);
    expect(summary.interactions).toBe(0);
    expect(summary.interactionP75Ms).toBeNull();
    expect(summary.budgets.find((b) => b.key === "interactionLatencyMs")!.status).toBe("no-data");
  });

  it("works end to end with a session", () => {
    const session = initPerfEngine({ devtools: false });
    try {
      const action = startAction("open-modal");
      trackRender("Modal", 5);
      const [trace] = session.getTraces();
      expect(trace).toMatchObject({ traceId: action.traceId, action: "open-modal", trigger: { eventType: "action", target: "open-modal" } });
    } finally {
      session.stop();
    }
  });
});
