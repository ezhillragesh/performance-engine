import { describe, expect, it } from "vitest";
import { runA11yAudit } from "../engine.js";
import { load } from "./helpers.js";

function buildDocument(targetElements: number): string {
  const card = (i: number) => `
    <article class="card">
      <h3>Item ${i}</h3>
      <a href="/item/${i}"><img src="/img/${i}.png"${i % 7 === 0 ? "" : ` alt="Item ${i}"`}></a>
      <p>Some <strong>text</strong> for item ${i} with a <a href="/more/${i}">${i % 11 === 0 ? "click here" : "details link"}</a>.</p>
      <ul><li>Feature A</li><li>Feature B</li></ul>
      <button type="button"${i % 13 === 0 ? "" : ' aria-label="Add to cart"'}><svg width="8" height="8" aria-hidden="true"><path d="M0 0h8v8H0z"></path></svg></button>
      <label>Qty <input type="number" name="q${i}" min="1" max="9"></label>
      <div role="button" tabindex="0" onclick="void 0">More</div>
    </article>`;
  const per = 15; // elements per card (approx)
  const parts = ['<a href="#main">Skip to main content</a><header><nav aria-label="Main"><ul><li><a href="/">Home</a></li></ul></nav></header><main id="main"><h1>Catalog</h1><section aria-labelledby="h2"><h2 id="h2">Products</h2>'];
  for (let i = 0; i < Math.ceil(targetElements / per); i++) parts.push(card(i));
  parts.push('</section><table><caption>Sizes</caption><tr><th scope="col">S</th><th scope="col">M</th></tr><tr><td>1</td><td>2</td></tr></table></main><footer><p>Footer</p></footer>');
  return parts.join("");
}

// Budgets (jsdom, median of 3 runs after a warm-up):
// - absolute: a 5k-element realistic document audits in < ABS_LIMIT_MS. Locally the median is
//   ~250 ms; the limit leaves headroom for loaded machines while still catching large regressions.
// - relative: 5x the elements must cost < 12x the time (linear is ~5x, quadratic ~25x), which
//   catches O(n^2) regressions independently of machine speed. Uses the fastest of 5 runs per
//   size: the minimum is the least noise-sensitive estimate when the machine is busy.
const ABS_LIMIT_MS = 600;
const MAX_SCALING = 12;

function timedRuns(opts: { timeBudgetMs: number }, runs = 3): { median: number; min: number; times: number[]; last: ReturnType<typeof runA11yAudit> } {
  runA11yAudit(document, opts); // warm-up (JIT, caches)
  const times: number[] = [];
  let last = runA11yAudit(document, opts);
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    last = runA11yAudit(document, opts);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return { median: times[Math.floor(times.length / 2)]!, min: times[0]!, times, last };
}

describe("performance", () => {
  it(`audits a 5k-element document in < ${ABS_LIMIT_MS} ms`, () => {
    load(buildDocument(5000));
    const total = document.getElementsByTagName("*").length;
    expect(total).toBeGreaterThanOrEqual(5000);
    const { median, times, last } = timedRuns({ timeBudgetMs: 60_000 });
    console.log(`a11y perf: ${total} elements, ${last.findings.length} findings, median ${median.toFixed(1)} ms (runs ${times.map((t) => t.toFixed(0)).join("/")})`);
    expect(last.truncated).toBe(false);
    expect(last.elementsScanned).toBe(total);
    expect(last.findings.length).toBeGreaterThan(100);
    expect(median).toBeLessThan(ABS_LIMIT_MS);
  });

  it(`scales linearly: 5x the elements costs < ${MAX_SCALING}x the time`, () => {
    load(buildDocument(1000));
    const small = timedRuns({ timeBudgetMs: 60_000 }, 5);
    load(buildDocument(5000));
    const large = timedRuns({ timeBudgetMs: 60_000 }, 5);
    expect(large.last.elementsScanned).toBeGreaterThanOrEqual(4.5 * small.last.elementsScanned);
    const ratio = large.min / Math.max(small.min, 1);
    console.log(`a11y scaling: ${small.last.elementsScanned} -> ${large.last.elementsScanned} elements, ${small.min.toFixed(1)} -> ${large.min.toFixed(1)} ms (x${ratio.toFixed(1)})`);
    // Floor: when the small run is only a few ms, timer noise dominates the ratio.
    expect(large.min).toBeLessThan(Math.max(MAX_SCALING * small.min, 150));
  });
});
