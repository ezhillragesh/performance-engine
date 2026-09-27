import { bench, describe } from "vitest";
import { analyzeEvents } from "../analyzer/engine.js";
import { buildAnalysisContext } from "../analyzer/context.js";
import { analyzeContext } from "../analyzer/engine.js";
import { computeSummary } from "../analyzer/summary.js";
import { buildTraceSummaries } from "../analyzer/traces.js";
import { collectCommitRenders, FiberTag, type FiberLike } from "../react/instrumentReact.js";
import { pushEvent, resetStore } from "../logger/store.js";
import { render, syntheticEvents } from "../tests/fixtures.js";

const e2k = syntheticEvents(2_000);
const e10k = syntheticEvents(10_000);
const e50k = syntheticEvents(50_000);

describe("analyzeEvents", () => {
  bench("2k events", () => {
    analyzeEvents(e2k);
  });
  bench("10k events", () => {
    analyzeEvents(e10k);
  });
  bench("50k events", () => {
    analyzeEvents(e50k);
  }, { iterations: 5 });
});

describe("pipeline stages (10k events)", () => {
  const ctx = buildAnalysisContext(e10k);
  const insights = analyzeContext(ctx);
  bench("buildAnalysisContext", () => {
    buildAnalysisContext(e10k);
  });
  bench("computeSummary", () => {
    computeSummary(ctx, insights);
  });
  bench("buildTraceSummaries", () => {
    buildTraceSummaries(ctx, insights);
  });
});

function Comp(): null {
  return null;
}

/** Mounted tree of ~`count` fibers: composite -> host -> composite ... with fan-out 10. */
function buildTree(count: number): { current: FiberLike } {
  const root: FiberLike = { tag: FiberTag.HostRoot, child: null, sibling: null, alternate: null };
  let created = 1;
  const queue: FiberLike[] = [root];
  while (queue.length > 0 && created < count) {
    const parent = queue.shift()!;
    let prev: FiberLike | null = null;
    for (let i = 0; i < 10 && created < count; i += 1) {
      const composite = i % 2 === 0;
      const f: FiberLike = {
        tag: composite ? FiberTag.FunctionComponent : FiberTag.HostComponent,
        type: composite ? Comp : "div",
        elementType: composite ? Comp : "div",
        memoizedProps: { i },
        flags: 1,
        actualDuration: 0.1,
        child: null,
        sibling: null,
        return: parent,
        alternate: null,
      };
      if (prev) prev.sibling = f;
      else parent.child = f;
      prev = f;
      created += 1;
      queue.push(f);
    }
  }
  return { current: root };
}

describe("instrumentReact", () => {
  const tree = buildTree(5_000);
  bench("commit walk, 5k-fiber mount", () => {
    collectCommitRenders(tree);
  });
});

describe("store", () => {
  const batch = Array.from({ length: 10_000 }, (_, i) => render("C", i));
  bench("pushEvent × 10k (bounded at 2k)", () => {
    resetStore();
    for (const e of batch) pushEvent(e);
  });
});
