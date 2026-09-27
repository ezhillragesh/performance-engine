import { describe, expect, it } from "vitest";
import { analyzeEvents } from "../analyzer/engine.js";
import { syntheticEvents } from "./fixtures.js";

/** Regression guard: generous limit so CI noise does not flake, but O(n²) regressions fail. */
const LIMIT_MS = 50;

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("analysis performance budget", () => {
  it(`analyzeEvents(2000 events) median < ${LIMIT_MS}ms`, () => {
    const events = syntheticEvents(2000);
    analyzeEvents(events); // warm-up (JIT)
    const runs: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      analyzeEvents(events);
      runs.push(performance.now() - start);
    }
    expect(median(runs)).toBeLessThan(LIMIT_MS);
  });

  it("scales near-linearly (20k vs 2k events)", () => {
    const small = syntheticEvents(2000);
    const large = syntheticEvents(20000);
    analyzeEvents(small);
    analyzeEvents(large);
    const t0 = performance.now();
    analyzeEvents(small);
    const t1 = performance.now();
    analyzeEvents(large);
    const t2 = performance.now();
    // 10× the events should cost well under 40× the time for an O(n log n) pipeline.
    expect(t2 - t1).toBeLessThan(Math.max(40 * (t1 - t0), 400));
  });
});
