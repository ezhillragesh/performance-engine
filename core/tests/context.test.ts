import { describe, expect, it } from "vitest";
import { buildAnalysisContext } from "../analyzer/context.js";
import type { TrackedEvent } from "../types/events.js";
import { net, render, TraceBuilder, ui } from "./fixtures.js";

describe("buildAnalysisContext — legacy (untagged) events", () => {
  it("sorts events by timestamp", () => {
    const ctx = buildAnalysisContext([ui("click", 100), render("App", 50), render("Button", 150)]);
    expect(ctx.events.map((e) => e.timestamp)).toEqual([50, 100, 150]);
  });

  it("groups a click and its renders into one trace", () => {
    const ctx = buildAnalysisContext([ui("click", 100), render("App", 110), render("Button", 120), render("TaskList", 130)]);
    expect(ctx.traces).toHaveLength(1);
    expect(ctx.traces[0]!.trigger.eventType).toBe("click");
    expect(ctx.traces[0]!.renders).toHaveLength(3);
    expect(ctx.traces[0]!.renderChains).toHaveLength(1);
    expect(ctx.traces[0]!.causal).toBe(false);
  });

  it("includes a network request in the interaction trace", () => {
    const ctx = buildAnalysisContext([ui("click", 100), render("App", 110), net("/api/task", 115, 200), render("TaskList", 320)]);
    expect(ctx.traces).toHaveLength(1);
    expect(ctx.traces[0]!.networkRequests.map((n) => n.url)).toEqual(["/api/task"]);
  });

  it("separate interactions produce separate traces", () => {
    const ctx = buildAnalysisContext([
      ui("click", 100, { target: "button1" }),
      render("App", 110),
      render("Button", 120),
      ui("click", 500, { target: "button2" }),
      render("App", 510),
      render("Modal", 520),
    ]);
    expect(ctx.traces.map((t) => [t.trigger.target, t.renders.length])).toEqual([
      ["button1", 2],
      ["button2", 2],
    ]);
    expect(ctx.traces[0]!.traceId).not.toBe(ctx.traces[1]!.traceId);
  });

  it("does not attach background renders before or long after an interaction", () => {
    const ctx = buildAnalysisContext([render("Background", 10), ui("click", 100), render("App", 110), render("Background2", 5000)]);
    expect(ctx.traces).toHaveLength(1);
    expect(ctx.traces[0]!.renders.map((r) => r.componentName)).toEqual(["App"]);
    expect(ctx.untracedRenders.map((r) => r.componentName)).toEqual(["Background", "Background2"]);
  });

  it("assigns each event to exactly one window (no overlap between rapid clicks)", () => {
    // Old behaviour: both windows contained the Modal render.
    const ctx = buildAnalysisContext([
      ui("click", 100, { target: "button1" }),
      render("App", 110),
      ui("click", 150, { target: "button2" }),
      render("Modal", 160),
    ]);
    expect(ctx.traces).toHaveLength(2);
    expect(ctx.traces[0]!.renders.map((r) => r.componentName)).toEqual(["App"]);
    expect(ctx.traces[1]!.renders.map((r) => r.componentName)).toEqual(["Modal"]);
    const all = ctx.traces.flatMap((t) => t.events.map((e) => e.eventId));
    expect(new Set(all).size).toBe(all.length);
  });

  it("groups pointerdown + click into one gesture, never focus/pointerup", () => {
    const ctx = buildAnalysisContext([
      ui("pointerdown", 100),
      ui("focus", 101),
      ui("pointerup", 180),
      ui("click", 181),
      render("App", 200),
    ]);
    expect(ctx.traces).toHaveLength(1);
    expect(ctx.traces[0]!.trigger.eventType).toBe("pointerdown");
    expect(ctx.traces[0]!.committedTrigger.eventType).toBe("click");
  });

  it("keeps click and later keydown traces apart", () => {
    const ctx = buildAnalysisContext([
      ui("click", 100),
      render("App", 110),
      net("/api/data", 115, 200),
      render("List", 320),
      ui("keydown", 500, { target: "input" }),
      render("Input", 510),
    ]);
    expect(ctx.traces).toHaveLength(2);
    expect(ctx.traces[0]!.renders).toHaveLength(2);
    expect(ctx.traces[0]!.networkRequests).toHaveLength(1);
    expect(ctx.traces[1]!.renders).toHaveLength(1);
    expect(ctx.traces[1]!.networkRequests).toHaveLength(0);
  });

  it("respects the interactionWindowMs option", () => {
    const events = [ui("click", 100), render("A", 350)];
    expect(buildAnalysisContext(events, { interactionWindowMs: 300 }).traces[0]!.renders).toHaveLength(1);
    expect(buildAnalysisContext(events, { interactionWindowMs: 100 }).traces[0]!.renders).toHaveLength(0);
  });
});

describe("buildAnalysisContext — causal traces", () => {
  it("groups by traceId regardless of timing and without mutating input", () => {
    const a = new TraceBuilder("trace-a");
    a.trigger("click", 100);
    a.request("/api/slow", 105, 1500);
    a.commitAt(1610, ["List", "Row"]);
    const background = render("Clock", 150); // untagged, inside a's time range
    const events: TrackedEvent[] = [...a.events, background];
    const frozen = events.map((e) => Object.freeze({ ...e }));
    const ctx = buildAnalysisContext(frozen);
    expect(ctx.traces).toHaveLength(1);
    const trace = ctx.traces[0]!;
    expect(trace.causal).toBe(true);
    expect(trace.renders.map((r) => r.componentName)).toEqual(["List", "Row"]);
    expect(trace.endTime).toBeGreaterThanOrEqual(1610);
    expect(ctx.untracedRenders.map((r) => r.componentName)).toEqual(["Clock"]);
    for (const e of frozen) expect(Object.isFrozen(e)).toBe(true);
    expect(frozen.find((e) => e.eventId === background.eventId)!.traceId).toBeUndefined();
  });

  it("drops traces whose trigger was trimmed from the store", () => {
    const ctx = buildAnalysisContext([render("App", 10, { traceId: "gone" })]);
    expect(ctx.traces).toHaveLength(0);
  });

  it("groups commits by commitId", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, ["A", "B", "C"]);
    b.commitAt(10, ["A"]);
    const ctx = buildAnalysisContext(b.events);
    expect(ctx.traces[0]!.commits.map((c) => c.renders.length)).toEqual([3, 1]);
  });
});
