import { describe, expect, it } from "vitest";
import { analyzeEvents } from "../analyzer/engine.js";
import type { TrackedEvent } from "../types/events.js";
import type { Insight, IssueType, PerformanceBudgets } from "../types/insights.js";
import { longTask, net, render, TraceBuilder, ui } from "./fixtures.js";

function run(events: TrackedEvent[], budgets?: Partial<PerformanceBudgets>): Insight[] {
  return analyzeEvents(events, budgets ? { budgets } : {});
}

function ofType(insights: Insight[], type: IssueType): Insight[] {
  return insights.filter((i) => i.issueType === type);
}

const names = (n: number, prefix = "C"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("interaction-induced-render-burst", () => {
  it("flags ≥6 renders within 160ms of a trace", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(20, names(8), { durationMs: 3 });
    const [insight] = ofType(run(b.events), "interaction-induced-render-burst");
    expect(insight).toBeDefined();
    expect(insight!.metadata?.renderCount).toBe(8);
    expect(insight!.traceId).toBe(b.traceId);
    expect(insight!.impact.renderCostMs).toBe(24);
  });

  it("does not flag small render counts", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(20, names(4));
    expect(ofType(run(b.events), "interaction-induced-render-burst")).toHaveLength(0);
  });

  it("collapses duplicate reports of one instance in a commit (StrictMode)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    const rs = b.commitAt(20, ["A", "A", "A", "B", "B", "B"]);
    rs.forEach((r, i) => (r.instanceId = i < 3 ? "A#0" : "B#0"));
    expect(ofType(run(b.events), "interaction-induced-render-burst")).toHaveLength(0);
  });
});

describe("keystroke-render-loop", () => {
  it("flags ≥3 renders within 120ms of a keystroke", () => {
    const b = new TraceBuilder();
    b.trigger("keydown", 0, { target: "input#search" });
    b.trigger("input", 1, { target: "input#search" });
    b.commitAt(15, ["SearchBox", "Results", "Row"]);
    expect(ofType(run(b.events), "keystroke-render-loop")).toHaveLength(1);
  });

  it("ignores clicks and late renders", () => {
    const click = new TraceBuilder();
    click.trigger("click", 0);
    click.commitAt(15, ["A", "B", "C"]);
    const late = new TraceBuilder();
    late.trigger("keydown", 1000);
    late.commitAt(1200, ["A", "B", "C"]);
    expect(ofType(run([...click.events, ...late.events]), "keystroke-render-loop")).toHaveLength(0);
  });
});

describe("interaction-render-latency", () => {
  it("measures from the committed trigger and reports severity by band", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(250, ["App"]);
    const [insight] = ofType(run(b.events), "interaction-render-latency");
    expect(insight!.severity).toBe("high");
    expect(insight!.impact.estimatedDelayMs).toBe(250);
  });

  it("measures from the click, not the pointerdown that opened the trace (#7)", () => {
    const b = new TraceBuilder();
    b.trigger("pointerdown", 0);
    b.trigger("click", 200);
    b.commitAt(220, ["App"]);
    expect(ofType(run(b.events), "interaction-render-latency")).toHaveLength(0);
  });

  it("includes browser input delay via domTimestamp", () => {
    const b = new TraceBuilder();
    b.trigger("click", 100, { domTimestamp: 40 });
    b.commitAt(110, ["App"]);
    const [insight] = ofType(run(b.events), "interaction-render-latency");
    expect(insight!.impact.estimatedDelayMs).toBe(70);
  });

  it("attributes the delay to a request only if it finished before the first render (#6)", () => {
    const blocking = new TraceBuilder();
    blocking.trigger("click", 0);
    blocking.request("/api/items", 5, 120);
    blocking.commitAt(150, ["List"]);
    const [b1] = ofType(run(blocking.events), "interaction-render-latency");
    expect(b1!.metadata?.blockingRequest).toBe("/api/items");
    expect(b1!.cause).toContain("/api/items");

    const notBlocking = new TraceBuilder();
    notBlocking.trigger("click", 0);
    notBlocking.request("/api/items", 5, 900);
    notBlocking.commitAt(150, ["List"]);
    const [b2] = ofType(run(notBlocking.events), "interaction-render-latency");
    expect(b2!.metadata?.blockingRequest).toBeUndefined();
  });

  it("does not report fast interactions", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(30, ["App"]);
    expect(ofType(run(b.events), "interaction-render-latency")).toHaveLength(0);
  });
});

describe("network-blocking-render", () => {
  it("flags a slow request followed by trace renders after responseEnd (audit repro)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    const req = b.request("/api/tasks", 10, 800);
    b.commitAt(830, ["TaskList", "TaskItem", "TaskItem"]);
    const [insight] = ofType(run(b.events), "network-blocking-render");
    expect(insight).toBeDefined();
    expect(insight!.id).toBe(`network-blocking-render|/api/tasks|${req.eventId}`);
    expect(insight!.evidence.some((e) => e.kind === "correlation")).toBe(true);
  });

  it("uses the responseEnd window, not the request start (#4)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.request("/api/tasks", 10, 800);
    b.commitAt(40, ["Spinner", "Button"]); // right after start: not response-driven
    expect(ofType(run(b.events), "network-blocking-render")).toHaveLength(0);
  });

  it("ignores background renders that are not in the request's trace (#5)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.request("/api/tasks", 10, 800);
    b.commitAt(15, ["App"]);
    const background = [render("Clock", 815, { commitId: 1 }), render("Ticker", 815, { commitId: 1 })];
    expect(ofType(run([...b.events, ...background]), "network-blocking-render")).toHaveLength(0);
  });

  it("ignores fast requests", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.request("/api/tasks", 10, 100);
    b.commitAt(115, ["A", "B"]);
    expect(ofType(run(b.events), "network-blocking-render")).toHaveLength(0);
  });
});

describe("state-thrashing", () => {
  it("flags one instance rendering in ≥4 rapid commits", () => {
    const events: TrackedEvent[] = [];
    for (let i = 0; i < 6; i += 1) {
      events.push(render("Counter", 100 + i * 20, { commitId: i + 1, instanceId: "Counter#1", phase: "update", stateChanged: true }));
    }
    const [insight] = ofType(run(events), "state-thrashing");
    expect(insight!.metadata?.renderCount).toBe(6);
    expect(insight!.id).toBe(`state-thrashing|Counter|${events[0]!.eventId}`);
  });

  it("does not flag 4 list-item instances rendering in one commit (audit repro #9)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, ["TaskItem", "TaskItem", "TaskItem", "TaskItem"]);
    const manual = [0, 1, 2, 3].map(() => render("Row", 500)); // manual, no instanceId, same commit
    expect(ofType(run([...b.events, ...manual]), "state-thrashing")).toHaveLength(0);
  });

  it("does not flag renders paced by separate keystrokes", () => {
    const events: TrackedEvent[] = [];
    for (let i = 0; i < 6; i += 1) {
      const b = new TraceBuilder();
      b.trigger("keydown", i * 60);
      b.commitAt(i * 60 + 5, ["Input"], { instanceId: "Input#1" });
      events.push(...b.events);
    }
    expect(ofType(run(events), "state-thrashing")).toHaveLength(0);
  });

  it("splits clusters at gaps and requires the min count in each (#8)", () => {
    const events = [0, 50, 100, 1000, 1050, 1100].map((t, i) =>
      render("Counter", t, { commitId: i + 1, instanceId: "Counter#1", phase: "update" }),
    );
    expect(ofType(run(events), "state-thrashing")).toHaveLength(0);
  });
});

describe("wasted-render", () => {
  it("flags renders marked wasted by instrumentation", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    for (let i = 0; i < 4; i += 1) b.commitAt(10 + i * 30, ["Row"], { wasted: true, durationMs: 2 });
    const [insight] = ofType(run(b.events), "wasted-render");
    expect(insight!.metadata?.renderCount).toBe(4);
    expect(insight!.impact.renderCostMs).toBe(8);
    expect(insight!.metadata?.impactEstimated).toBeUndefined();
  });

  it("flags equal manual hashes against the previous render of the instance (#11)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    for (let i = 0; i < 4; i += 1) b.render("Row", 10 + i * 30, { propsHash: "same", instanceId: "Row#1", phase: "update" });
    const [insight] = ofType(run(b.events), "wasted-render");
    expect(insight!.metadata?.renderCount).toBe(3);
    expect(insight!.metadata?.impactEstimated).toBe(true);
  });

  it("does not treat zero-duration renders as wasted (audit repro #10)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    for (let i = 0; i < 8; i += 1) b.render("Row", 10 + i * 10);
    expect(ofType(run(b.events), "wasted-render")).toHaveLength(0);
  });

  it("does not compare hashes across sibling instances without instanceId", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    for (let i = 0; i < 4; i += 1) b.render("Row", 10 + i * 10, { propsHash: "x", phase: "update" });
    expect(ofType(run(b.events), "wasted-render")).toHaveLength(0);
  });
});

describe("slow-interaction", () => {
  it("flags Event Timing entries over budget with phase breakdown and attribution", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(40, ["Dashboard", "Chart"]);
    b.longTask(5, 250, { scripts: [{ invoker: "BUTTON.onclick", sourceFunctionName: "recalc", duration: 230 }] });
    b.timing(0, 320, { inputDelay: 10, processingMs: 260, presentationDelay: 50, interactionId: 7 });
    const [insight] = ofType(run(b.events), "slow-interaction");
    expect(insight!.severity).toBe("high");
    expect(insight!.metadata?.dominantPhase).toBe("processing");
    expect(insight!.cause).toContain("recalc");
    expect(insight!.evidence.map((e) => e.label)).toEqual(
      expect.arrayContaining(["Input delay", "Processing (event handlers)", "Presentation delay"]),
    );
  });

  it("ignores interactions within budget", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.timing(0, 150);
    expect(ofType(run(b.events), "slow-interaction")).toHaveLength(0);
    expect(ofType(run(b.events, { interactionLatencyMs: 100 }), "slow-interaction")).toHaveLength(1);
  });
});

describe("long-task", () => {
  it("reports long tasks of a trace with script attribution", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.longTask(10, 180, { scripts: [{ invoker: "BUTTON#save.onclick", sourceFunctionName: "save", duration: 150 }] });
    const [insight] = ofType(run(b.events), "long-task");
    expect(insight!.severity).toBe("medium");
    expect(insight!.source).toContain("save");
    expect(insight!.traceId).toBe(b.traceId);
    expect(insight!.evidence.some((e) => e.label.startsWith("Script:"))).toBe(true);
  });

  it("clusters background long tasks and ignores short ones", () => {
    const events = [longTask(100, 120), longTask(300, 90), longTask(500, 60), longTask(5000, 40)];
    const insights = ofType(run(events), "long-task");
    expect(insights).toHaveLength(1);
    expect(insights[0]!.metadata?.longTaskCount).toBe(3);
  });
});

describe("slow-component", () => {
  it("flags components whose renders exceed the budget", () => {
    const events = [10, 40, 45].map((d, i) => render("Chart", 100 + i * 500, { durationMs: d, selfDurationMs: d }));
    const [insight] = ofType(run(events), "slow-component");
    expect(insight!.id).toBe("slow-component|Chart|aggregate");
    expect(insight!.metadata?.maxMs).toBe(45);
  });

  it("uses self time when available and ignores a single mild spike", () => {
    const parent = [render("App", 100, { durationMs: 80, selfDurationMs: 1 }), render("App", 600, { durationMs: 80, selfDurationMs: 1 })];
    const spike = [render("Row", 100, { durationMs: 20 })];
    expect(ofType(run([...parent, ...spike]), "slow-component")).toHaveLength(0);
  });
});

describe("budget-exceeded", () => {
  it("reports failing budgets not covered by a specific insight", () => {
    const insights = run([net("/api/report", 0, 3000)]);
    const budget = ofType(insights, "budget-exceeded");
    expect(budget.map((i) => i.source)).toEqual(["networkRequestMs"]);
    expect(budget[0]!.severity).toBe("high");
  });

  it("stays silent when a specific rule already explains the failure", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.request("/api/tasks", 10, 1500);
    b.commitAt(1520, ["A", "B"]);
    const insights = run(b.events);
    expect(ofType(insights, "network-blocking-render")).toHaveLength(1);
    expect(ofType(insights, "budget-exceeded").map((i) => i.source)).not.toContain("networkRequestMs");
  });
});

describe("trace scoping", () => {
  it("does not attribute background timer renders to an unrelated interaction", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, ["Button"]);
    const timer = names(10, "Widget").map((n, i) => render(n, 50 + i, { commitId: 99 }));
    const insights = run([...b.events, ...timer, ui("focus", 1)]);
    for (const i of insights) {
      if (i.traceId === b.traceId) expect(i.metadata?.affectedComponents ?? []).not.toContain("Widget0");
    }
    expect(ofType(insights, "interaction-induced-render-burst")).toHaveLength(0);
  });
});
