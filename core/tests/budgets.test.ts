import { describe, expect, it } from "vitest";
import { budgetStatus, DEFAULT_BUDGETS, evaluateBudgets, resolveBudgets } from "../analyzer/budgets.js";
import { buildAnalysisContext } from "../analyzer/context.js";
import { computeScore, computeSummary, gradeForScore, topComponents } from "../analyzer/summary.js";
import { analyzeEvents } from "../analyzer/engine.js";
import { percentile } from "../analyzer/stats.js";
import type { BudgetResult } from "../types/insights.js";
import { interaction, longTask, net, render, TraceBuilder } from "./fixtures.js";

function budget(events: Parameters<typeof buildAnalysisContext>[0], key: BudgetResult["key"], budgets = DEFAULT_BUDGETS): BudgetResult {
  return evaluateBudgets(buildAnalysisContext(events), budgets).find((b) => b.key === key)!;
}

describe("budgets", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      interactionLatencyMs: 200,
      longTaskMs: 50,
      componentRenderMs: 16,
      rendersPerInteraction: 25,
      networkRequestMs: 1000,
      wastedRenderPct: 30,
    });
  });

  it("status: pass / warn (≥80%) / fail / no-data", () => {
    expect(budgetStatus(null, 100)).toBe("no-data");
    expect(budgetStatus(50, 100)).toBe("pass");
    expect(budgetStatus(80, 100)).toBe("warn");
    expect(budgetStatus(100, 100)).toBe("warn");
    expect(budgetStatus(101, 100)).toBe("fail");
  });

  it("uses p75 for interaction latency", () => {
    const durations = [50, 60, 70, 80, 90, 180, 300, 400];
    const events = durations.map((d, i) => interaction(i * 1000, d, { interactionId: i + 1 }));
    const result = budget(events, "interactionLatencyMs");
    expect(result.actual).toBe(percentile(durations, 75));
    expect(result.actual).toBe(180);
    expect(result.status).toBe("warn");
    expect(result.samples).toBe(8);
    expect(result.violations).toBe(2);
  });

  it("groups Event Timing entries of one interaction", () => {
    const events = [interaction(0, 300, { interactionId: 1, name: "pointerdown" }), interaction(1, 320, { interactionId: 1, name: "click" })];
    const result = budget(events, "interactionLatencyMs");
    expect(result.samples).toBe(1);
    expect(result.actual).toBe(320);
    expect(result.status).toBe("fail");
  });

  it("reports no-data without samples", () => {
    for (const r of evaluateBudgets(buildAnalysisContext([]))) expect(r.status).toBe("no-data");
  });

  it("evaluates long tasks, requests, renders per interaction and wasted %", () => {
    expect(budget([longTask(0, 45, { api: "longtask" })], "longTaskMs").status).toBe("warn");
    expect(budget([net("/a", 0, 1200)], "networkRequestMs").status).toBe("fail");
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, Array.from({ length: 30 }, (_, i) => `C${i}`));
    expect(budget(b.events, "rendersPerInteraction")).toMatchObject({ actual: 30, status: "fail" });
    const renders = Array.from({ length: 20 }, (_, i) => render("Row", i * 100, { instanceId: "Row#1", phase: "update", wasted: i < 10 }));
    expect(budget(renders, "wastedRenderPct")).toMatchObject({ actual: 50, status: "fail" });
    // Too few updates to express a share (e.g. right after clear()).
    const few = [0, 1, 2].map((i) => render("Row", i * 100, { instanceId: "Row#1", phase: "update", wasted: i < 1 }));
    expect(budget(few, "wastedRenderPct")).toMatchObject({ actual: null, status: "no-data" });
  });

  it("merges partial budgets and ignores invalid values", () => {
    expect(resolveBudgets({ longTaskMs: 100, networkRequestMs: -1 })).toMatchObject({ longTaskMs: 100, networkRequestMs: 1000 });
  });
});

describe("summary", () => {
  it("score starts at 100 and subtracts budget failures and insight severities", () => {
    expect(computeScore([], [])).toBe(100);
    const fail = { status: "fail" } as BudgetResult;
    const warn = { status: "warn" } as BudgetResult;
    expect(computeScore([fail, warn], [])).toBe(84);
    const many = Array.from({ length: 20 }, () => ({ severity: "critical" }) as never);
    expect(computeScore([], many)).toBe(50); // insight penalty is capped
    expect(computeScore(Array(6).fill(fail), many)).toBe(0);
  });

  it("grades with 90 / 50 boundaries", () => {
    expect(gradeForScore(90)).toBe("good");
    expect(gradeForScore(89)).toBe("needs-improvement");
    expect(gradeForScore(50)).toBe("needs-improvement");
    expect(gradeForScore(49)).toBe("poor");
  });

  it("computes aggregate stats and top components by total time", () => {
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(10, ["Fast", "Slow"], { durationMs: 1 });
    b.commitAt(40, ["Slow"], { durationMs: 30 });
    b.request("/api/a", 5, 100, { status: 500 });
    b.longTask(1, 120);
    b.timing(0, 240, { interactionId: 1 });
    const insights = analyzeEvents(b.events);
    const summary = computeSummary(b.events, insights);
    expect(summary).toMatchObject({
      interactions: 1,
      renders: 3,
      requests: 1,
      failedRequests: 1,
      longTasks: 1,
      totalBlockingMs: 70,
      interactionP75Ms: 240,
      interactionMaxMs: 240,
    });
    expect(summary.topComponents[0]).toMatchObject({ name: "Slow", renders: 2, totalMs: 31, maxMs: 30 });
    expect(summary.topRequests[0]).toMatchObject({ url: "/api/a", count: 1, errors: 1 });
    expect(summary.insightCounts.high + summary.insightCounts.medium + summary.insightCounts.low + summary.insightCounts.critical).toBe(insights.length);
    expect(summary.score).toBeLessThan(100);
  });

  it("limits top components to 10", () => {
    const events = Array.from({ length: 15 }, (_, i) => render(`C${i}`, i, { durationMs: i }));
    const top = topComponents(buildAnalysisContext(events));
    expect(top).toHaveLength(10);
    expect(top[0]!.name).toBe("C14");
  });
});
