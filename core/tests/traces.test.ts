import { describe, expect, it } from "vitest";
import { buildAnalysisContext } from "../analyzer/context.js";
import { analyzeContext } from "../analyzer/engine.js";
import { buildTraceSummaries } from "../analyzer/traces.js";
import { TraceBuilder } from "./fixtures.js";

describe("trace summaries", () => {
  it("builds a causal span tree", () => {
    const b = new TraceBuilder("trace-1");
    b.trigger("click", 100, { label: "Load" });
    const early = b.commitAt(110, ["Spinner"], { durationMs: 2 });
    const task = b.longTask(101, 80);
    const req = b.request("/api/items", 105, 600);
    const late = b.commitAt(710, ["List", "Row"], { durationMs: 5 });
    b.timing(100, 900, { interactionId: 3 });

    const ctx = buildAnalysisContext(b.events);
    const insights = analyzeContext(ctx);
    const [summary] = buildTraceSummaries(ctx, insights);
    expect(summary).toBeDefined();
    const spans = summary!.spans;
    const byEvent = (id: string) => spans.find((s) => s.eventId === id)!;
    const root = spans[0]!;

    expect(root.kind).toBe("interaction");
    expect(root.end).toBeGreaterThanOrEqual(100 + 900); // extends to event-timing duration
    expect(byEvent(task.eventId).parentId).toBe(root.id);
    expect(byEvent(req.eventId).parentId).toBe(root.id);

    const earlyCommit = spans.find((s) => s.id === byEvent(early[0]!.eventId).parentId)!;
    const lateCommit = spans.find((s) => s.id === byEvent(late[0]!.eventId).parentId)!;
    expect(earlyCommit.kind).toBe("commit");
    expect(earlyCommit.parentId).toBe(root.id); // before the response
    expect(lateCommit.parentId).toBe(byEvent(req.eventId).id); // caused by the response
    expect(byEvent(late[1]!.eventId).parentId).toBe(lateCommit.id);

    expect(summary).toMatchObject({
      traceId: "trace-1",
      trigger: { eventType: "click", label: "Load" },
      renderCount: 3,
      networkCount: 1,
      longTaskMs: 80,
      latencyMs: 900,
    });
    expect(summary!.components).toEqual(["Spinner", "List", "Row"]);
    expect(summary!.insightIds.length).toBeGreaterThan(0);
    for (const id of summary!.insightIds) expect(insights.some((i) => i.id === id)).toBe(true);
  });
});
