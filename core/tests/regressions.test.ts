/**
 * Regression tests for issues found by driving the demo with a real browser
 * (React 19 dev build, Event Timing, real input). One block per issue.
 */
import { describe, expect, it } from "vitest";
import { analyzeEvents } from "../analyzer/engine.js";
import { buildAnalysisContext, buildCommits } from "../analyzer/context.js";
import { renderTime } from "../analyzer/rules/shared.js";
import { computeSummary, topComponents } from "../analyzer/summary.js";
import { buildTraceSummaries } from "../analyzer/traces.js";
import { groupInteractionTimings } from "../analyzer/interactions.js";
import type { TrackedEvent } from "../types/events.js";
import type { Insight, IssueType } from "../types/insights.js";
import { interaction, net, render, TraceBuilder } from "./fixtures.js";

function ofType(insights: Insight[], type: IssueType): Insight[] {
  return insights.filter((i) => i.issueType === type);
}

describe("render cost is not double counted (actualDuration includes children)", () => {
  it("sums self times: parent 21ms (1ms self) + child 20ms = 21ms, not 41ms", () => {
    const parent = render("Parent", 0, { durationMs: 21, selfDurationMs: 1, commitId: 1 });
    const child = render("Child", 0, { durationMs: 20, selfDurationMs: 20, commitId: 1, parentComponent: "Parent" });
    expect(renderTime([parent, child])).toEqual({ totalMs: 21, known: true });
  });

  it("falls back to durationMs when no self time is reported (manual tracking)", () => {
    expect(renderTime([render("A", 0, { durationMs: 4 }), render("B", 10, { durationMs: 6 })]).totalMs).toBe(10);
  });

  it("component stats use self time, so a cheap wrapper is not a top component", () => {
    const events = [
      render("Wrapper", 0, { durationMs: 40.2, selfDurationMs: 0.2, commitId: 1 }),
      render("Heavy", 0, { durationMs: 40, selfDurationMs: 40, commitId: 1 }),
    ];
    const [top, second] = topComponents(buildAnalysisContext(events));
    expect(top).toMatchObject({ name: "Heavy", totalMs: 40 });
    expect(second).toMatchObject({ name: "Wrapper", totalMs: 0.2 });
    expect(ofType(analyzeEvents(events), "slow-component").map((i) => i.source)).toEqual(["Heavy"]);
  });
});

describe("render timestamps are render starts", () => {
  it("commit spans run from the first render start to the commit time; render spans draw forward", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(5, ["Card"], { durationMs: 40, commitTime: 45 });
    const [summary] = buildTraceSummaries(buildAnalysisContext(b.events));
    const commit = summary!.spans.find((s) => s.kind === "commit")!;
    const card = summary!.spans.find((s) => s.kind === "render")!;
    expect([commit.start, commit.end]).toEqual([5, 45]);
    expect([card.start, card.end]).toEqual([5, 45]);
    expect(summary!.end).toBeGreaterThanOrEqual(45);
  });

  it("groups renders of one commit even when other renders start in between", () => {
    const commits = buildCommits([
      render("A", 0, { commitId: 7 }),
      render("B", 1, { commitId: 8 }),
      render("C", 2, { commitId: 7 }),
    ]);
    expect(commits.map((c) => [c.commitId, c.renders.map((r) => r.componentName).join("")])).toEqual([
      [7, "AC"],
      [8, "B"],
    ]);
  });
});

describe("state-thrashing is not raised for input-paced or child renders", () => {
  it("useDeferredValue: two renders per keystroke across many keystrokes is not thrashing", () => {
    const events: TrackedEvent[] = [];
    for (let k = 0; k < 6; k += 1) {
      const b = new TraceBuilder();
      const t = k * 30;
      b.trigger("keydown", t);
      b.commitAt(t + 2, ["HealthySearch"], { instanceId: "HealthySearch#1", stateChanged: true });
      b.commitAt(t + 12, ["HealthySearch"], { instanceId: "HealthySearch#1", stateChanged: true });
      events.push(...b.events);
    }
    expect(ofType(analyzeEvents(events), "state-thrashing")).toHaveLength(0);
  });

  it("reports the component whose own state flips, not the child it re-renders", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    for (let i = 0; i < 12; i += 1) {
      const t = 10 + i * 25;
      b.render("ThrashMeter", t, { instanceId: "ThrashMeter#1", commitId: 500 + i, stateChanged: true, changedProps: [] });
      b.render("MeterView", t, { instanceId: "MeterView#1", commitId: 500 + i, stateChanged: false, changedProps: ["side"] });
    }
    expect(ofType(analyzeEvents(b.events), "state-thrashing").map((i) => i.source)).toEqual(["ThrashMeter"]);
  });
});

describe("wasted-render severity follows measured cost", () => {
  it("many wasted renders of a trivially cheap component stay low", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      render("PauseIcon", i * 1500, { instanceId: "PauseIcon#1", commitId: i + 1, phase: "update", wasted: true, durationMs: 0.3, selfDurationMs: 0.3 }),
    );
    const [insight] = ofType(analyzeEvents(events), "wasted-render");
    expect(insight).toBeDefined();
    expect(insight!.severity).toBe("low");
  });

  it("expensive wasted renders are still high", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      render("ExpensiveChart", i * 200, { instanceId: "Chart#1", commitId: i + 1, phase: "update", wasted: true, durationMs: 8, selfDurationMs: 8 }),
    );
    const [insight] = ofType(analyzeEvents(events), "wasted-render");
    expect(["high", "critical"]).toContain(insight!.severity);
  });
});

describe("one gesture is one latency sample", () => {
  it("drops interactionId-0 entries (mousedown/mouseup) that overlap a real interaction", () => {
    const grouped = groupInteractionTimings([
      interaction(100, 120, { name: "pointerdown", interactionId: 7 }),
      interaction(100, 120, { name: "mousedown", interactionId: 0 }),
      interaction(101, 119, { name: "mouseup", interactionId: 0 }),
      interaction(105, 110, { name: "click", interactionId: 7 }),
      interaction(900, 40, { name: "mouseup", interactionId: 0 }), // no overlapping interaction: kept
    ]);
    expect(grouped.map((t) => `${t.name}:${t.interactionId}`)).toEqual(["pointerdown:7", "mouseup:0"]);
  });
});

describe("aborted requests are not failures", () => {
  it("excludes error === 'aborted' from failedRequests and request errors", () => {
    const events = [
      net("/api/a", 0, 10, { status: 0, error: "aborted" }),
      net("/api/b", 20, 10, { status: 500, error: "HTTP 500" }),
    ];
    const summary = computeSummary(events, []);
    expect(summary.failedRequests).toBe(1);
    expect(summary.topRequests.find((r) => r.url === "/api/a")!.errors).toBe(0);
  });
});

describe("a keystroke's renders are reported once", () => {
  it("keystroke-render-loop wins over a render burst for the same trace", () => {
    const b = new TraceBuilder();
    b.trigger("keydown", 0);
    b.commitAt(10, ["Workbench", "Panels", "A", "B", "C", "D", "E", "F"], { durationMs: 3 });
    const insights = analyzeEvents(b.events);
    expect(ofType(insights, "keystroke-render-loop")).toHaveLength(1);
    expect(ofType(insights, "interaction-induced-render-burst")).toHaveLength(0);
  });

  it("a click burst is still a render burst", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, ["Workbench", "Panels", "A", "B", "C", "D", "E", "F"], { durationMs: 3 });
    expect(ofType(analyzeEvents(b.events), "interaction-induced-render-burst")).toHaveLength(1);
  });
});

describe("a long animation frame without blocking time is not a long task", () => {
  it("880ms frame with blockingDuration 0: no long-task insight, no budget failure, no span", () => {
    const b = new TraceBuilder();
    b.trigger("keydown", 0);
    b.longTask(5, 880, { blockingDuration: 0 });
    const insights = analyzeEvents(b.events);
    expect(ofType(insights, "long-task")).toHaveLength(0);
    const summary = computeSummary(b.events, insights);
    expect(summary.longTasks).toBe(0);
    expect(summary.budgets.find((r) => r.key === "longTaskMs")!.status).toBe("no-data");
    const [trace] = buildTraceSummaries(buildAnalysisContext(b.events));
    expect(trace!.spans.some((s) => s.kind === "longtask")).toBe(false);
  });

  it("a frame with 244ms blocking is a ~294ms long task", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.longTask(1, 300, { blockingDuration: 244 });
    const [insight] = ofType(analyzeEvents(b.events), "long-task");
    expect(insight!.message).toContain("longest 294ms");
  });
});

describe("render-count severity follows measured cost", () => {
  it("a cheap 28-render click (12ms, under one frame) is medium, not high", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, Array.from({ length: 28 }, (_, i) => `Row${i}`), { durationMs: 0.43, selfDurationMs: 0.43 });
    const [insight] = ofType(analyzeEvents(b.events), "interaction-induced-render-burst");
    expect(insight!.severity).toBe("medium");
  });

  it("a controlled input re-rendering its form (3 renders, 2ms) is low", () => {
    const b = new TraceBuilder();
    b.trigger("keydown", 0);
    b.commitAt(3, ["TaskPanel", "TaskForm", "Button"], { durationMs: 0.7, selfDurationMs: 0.7 });
    const [insight] = ofType(analyzeEvents(b.events), "keystroke-render-loop");
    expect(insight!.severity).toBe("low");
  });

  it("frame-dropping cascades still escalate; unknown durations use the count", () => {
    const heavy = new TraceBuilder();
    heavy.trigger("keydown", 0);
    heavy.commitAt(3, ["Panels", "A", "B", "C", "D", "E", "F", "G", "H", "I"], { durationMs: 3, selfDurationMs: 3 });
    expect(ofType(analyzeEvents(heavy.events), "keystroke-render-loop")[0]!.severity).toBe("high");
    const prod = new TraceBuilder();
    prod.trigger("click", 0);
    prod.commitAt(10, Array.from({ length: 28 }, (_, i) => `Row${i}`));
    expect(ofType(analyzeEvents(prod.events), "interaction-induced-render-burst")[0]!.severity).toBe("high");
  });
});

describe("summary.interactions counts measured interactions", () => {
  it("counts distinct Event Timing interactionIds, not entries or traces", () => {
    const a = new TraceBuilder();
    a.trigger("click", 0);
    const b = new TraceBuilder();
    b.trigger("click", 500);
    const events = [
      ...a.events,
      ...b.events,
      // Gesture 1: pointerdown + pointerup + click share id 11; gesture 2 has id 12; an extra id-0 keydown.
      interaction(0, 104, { name: "pointerdown", interactionId: 11 }),
      interaction(40, 56, { name: "pointerup", interactionId: 11 }),
      interaction(42, 104, { name: "click", interactionId: 11 }),
      interaction(500, 64, { name: "click", interactionId: 12 }),
      interaction(900, 24, { name: "keydown", interactionId: 0 }),
      interaction(1300, 32, { name: "click", interactionId: 13 }), // measured without a trace
    ];
    expect(computeSummary(events, []).interactions).toBe(3);
  });

  it("falls back to the number of traces without Event Timing data", () => {
    const a = new TraceBuilder();
    a.trigger("click", 0);
    const b = new TraceBuilder();
    b.trigger("keydown", 800);
    const events = [...a.events, ...b.events];
    expect(computeSummary(events, []).interactions).toBe(2);
    // id-0 entries alone are not measured interactions either.
    expect(computeSummary([...events, interaction(10, 30, { interactionId: 0 })], []).interactions).toBe(2);
  });
});
