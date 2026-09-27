import { describe, expect, it, vi } from "vitest";
import { analyzeEvents, mergeOverlappingInsights } from "../analyzer/engine.js";
import { defaultRules } from "../analyzer/rules/index.js";
import type { AnalysisRule } from "../analyzer/rules/shared.js";
import type { Insight } from "../types/insights.js";
import { TraceBuilder } from "./fixtures.js";

function insight(id: string, start: number | undefined, end: number | undefined, extra: Partial<Insight> = {}): Insight {
  return {
    id,
    issueType: "state-thrashing",
    category: "rendering",
    severity: "medium",
    source: "Counter",
    message: id,
    cause: "",
    possibleFix: "",
    confidence: 0.5,
    impact: { estimatedDelayMs: 0 },
    evidence: [],
    metadata: start === undefined ? {} : { timeWindowStart: start, timeWindowEnd: end },
    ...extra,
  };
}

const staticRule = (name: string, insights: Insight[]): AnalysisRule => ({ name, run: () => insights });

describe("engine", () => {
  it("dedupes by id keeping the stronger insight", () => {
    const out = analyzeEvents([], {
      rules: [staticRule("a", [insight("x", 0, 1), insight("x", 0, 1, { severity: "high" })])],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.severity).toBe("high");
  });

  it("merges overlapping windows by interval union, independent of order (#13, #17)", () => {
    const a = insight("a", 0, 100);
    const b = insight("b", 150, 300, { severity: "high" });
    const c = insight("c", 90, 160);
    const d = insight("d", 1000, 1100);
    const forward = mergeOverlappingInsights([a, b, c, d]);
    const backward = mergeOverlappingInsights([d, c, b, a]);
    for (const result of [forward, backward]) {
      expect(result).toHaveLength(2);
      const merged = result.find((i) => i.id === "a")!;
      expect(merged.severity).toBe("high"); // strongest content
      expect(merged.metadata).toMatchObject({ timeWindowStart: 0, timeWindowEnd: 300, mergedCount: 3 });
      expect(result.some((i) => i.id === "d")).toBe(true);
    }
  });

  it("does not merge insights without a window", () => {
    const out = mergeOverlappingInsights([insight("a", undefined, undefined), insight("b", undefined, undefined)]);
    expect(out).toHaveLength(2);
  });

  it("isolates a throwing custom rule (#19)", () => {
    const onRuleError = vi.fn();
    const b = new TraceBuilder();
    b.trigger("click", 0);
    b.commitAt(300, ["App"]);
    const boom: AnalysisRule = {
      name: "boom",
      run() {
        throw new Error("rule failed");
      },
    };
    const out = analyzeEvents(b.events, { rules: [boom, ...defaultRules], onRuleError });
    expect(onRuleError).toHaveBeenCalledTimes(1);
    expect(out.some((i) => i.issueType === "interaction-render-latency")).toBe(true);
  });

  it("normalises custom insights missing optional fields", () => {
    const partial = { ...insight("", 0, 1), evidence: undefined, confidence: 5 } as unknown as Insight;
    const [out] = analyzeEvents([], { rules: [staticRule("p", [partial])] });
    expect(out!.id).not.toBe("");
    expect(out!.evidence).toEqual([]);
    expect(out!.confidence).toBeLessThanOrEqual(0.98);
  });

  it("passes budgets and prior insights to rules", () => {
    const seen: unknown[] = [];
    const spy: AnalysisRule = {
      name: "spy",
      run(_ctx, options) {
        seen.push(options.budgets.longTaskMs, options.priorInsights.length);
        return [];
      },
    };
    analyzeEvents([], { rules: [staticRule("a", [insight("a", 0, 1)]), spy], budgets: { longTaskMs: 70 } });
    expect(seen).toEqual([70, 1]);
  });

  it("sorts by severity then confidence", () => {
    const out = analyzeEvents([], {
      rules: [
        staticRule("a", [
          insight("low", undefined, undefined, { severity: "low" }),
          insight("crit", undefined, undefined, { severity: "critical" }),
          insight("med", undefined, undefined, { severity: "medium", confidence: 0.9 }),
          insight("med2", undefined, undefined, { severity: "medium", confidence: 0.1 }),
        ]),
      ],
    });
    expect(out.map((i) => i.id)).toEqual(["crit", "med", "med2", "low"]);
  });
});
