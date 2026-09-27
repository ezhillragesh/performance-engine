import { describe, expect, it } from "vitest";
import { analyzeEvents } from "../analyzer/engine.js";
import {
  confidenceFromEvidence,
  scaledWeight,
  severityFromLatency,
  severityFromRatio,
} from "../analyzer/rules/shared.js";
import { explainInsight } from "../analyzer/explain.js";
import type { TrackedEvent } from "../types/events.js";
import { render, syntheticEvents, TraceBuilder } from "./fixtures.js";

describe("insight ids", () => {
  it("stay stable while a trace window grows (#16)", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(20, Array.from({ length: 8 }, (_, i) => `C${i}`));
    const before = analyzeEvents(b.events).find((i) => i.issueType === "interaction-induced-render-burst")!;
    b.commitAt(200, ["Late"]);
    b.request("/api/x", 210, 50);
    const after = analyzeEvents(b.events).find((i) => i.issueType === "interaction-induced-render-burst")!;
    expect(after.metadata!.timeWindowEnd).toBeGreaterThan(before.metadata!.timeWindowEnd as number);
    expect(after.id).toBe(before.id);
  });

  it("stay stable while a thrash cluster grows", () => {
    const events: TrackedEvent[] = [];
    const add = (i: number): void => {
      events.push(render("Counter", i * 20, { commitId: i + 1, instanceId: "Counter#1", phase: "update" }));
    };
    for (let i = 0; i < 4; i += 1) add(i);
    const first = analyzeEvents(events).find((i) => i.issueType === "state-thrashing")!;
    for (let i = 4; i < 10; i += 1) add(i);
    const second = analyzeEvents(events).find((i) => i.issueType === "state-thrashing")!;
    expect(second.id).toBe(first.id);
    expect(second.metadata!.renderCount).toBe(10);
  });

  it("are unique within a result", () => {
    const insights = analyzeEvents(syntheticEvents(3000));
    expect(new Set(insights.map((i) => i.id)).size).toBe(insights.length);
  });
});

describe("evidence and confidence", () => {
  it("confidence = 1 − Π(1 − w), capped at 0.98", () => {
    expect(confidenceFromEvidence([])).toBe(0);
    expect(confidenceFromEvidence([{ kind: "measurement", label: "a", value: 1, weight: 0.5 }])).toBe(0.5);
    expect(
      confidenceFromEvidence([
        { kind: "measurement", label: "a", value: 1, weight: 0.5 },
        { kind: "correlation", label: "b", value: 1, weight: 0.5 },
      ]),
    ).toBe(0.75);
    expect(confidenceFromEvidence([{ kind: "measurement", label: "a", value: 1, weight: 1 }])).toBe(0.98);
  });

  it("scales weight with magnitude", () => {
    expect(scaledWeight(6, 6, 0.3, 0.6, 4)).toBe(0.3);
    expect(scaledWeight(24, 6, 0.3, 0.6, 4)).toBe(0.6);
    expect(scaledWeight(15, 6, 0.3, 0.6, 4)).toBe(0.45);
  });

  it("every default insight carries evidence with measured values and derived confidence", () => {
    const insights = analyzeEvents(syntheticEvents(3000));
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.evidence.length).toBeGreaterThan(0);
      for (const e of insight.evidence) {
        expect(e.weight).toBeGreaterThanOrEqual(0);
        expect(e.weight).toBeLessThanOrEqual(1);
      }
      expect(insight.confidence).toBe(confidenceFromEvidence(insight.evidence));
      expect(insight.category).toBeDefined();
      expect(explainInsight(insight)).toContain("Evidence:");
    }
  });

  it("causal traces yield higher confidence than time-window fallback", () => {
    const causal = new TraceBuilder();
    causal.trigger("click", 0);
    causal.commitAt(250, ["App"]);
    const legacy = causal.events.map((e) => ({ ...e, traceId: undefined, commitId: undefined }));
    const c = analyzeEvents(causal.events).find((i) => i.issueType === "interaction-render-latency")!;
    const l = analyzeEvents(legacy as TrackedEvent[]).find((i) => i.issueType === "interaction-render-latency")!;
    expect(c.confidence).toBeGreaterThan(l.confidence);
  });
});

describe("severity bands (#14)", () => {
  it("uses INP-style latency thresholds", () => {
    expect(severityFromLatency(99)).toBe("low");
    expect(severityFromLatency(100)).toBe("medium");
    expect(severityFromLatency(199)).toBe("medium");
    expect(severityFromLatency(200)).toBe("high");
    expect(severityFromLatency(500)).toBe("critical");
  });

  it("scales counts relative to their threshold", () => {
    expect(severityFromRatio(3, 4)).toBe("low");
    expect(severityFromRatio(4, 4)).toBe("medium");
    expect(severityFromRatio(8, 4)).toBe("high");
    expect(severityFromRatio(16, 4)).toBe("critical");
  });

  it("derives rule severity from the measured latency", () => {
    const severities = [150, 300, 700].map((delay) => {
      const b = new TraceBuilder();
      b.trigger("click", 0);
      b.commitAt(delay, ["App"]);
      return analyzeEvents(b.events).find((i) => i.issueType === "interaction-render-latency")!.severity;
    });
    expect(severities).toEqual(["medium", "high", "critical"]);
  });
});
