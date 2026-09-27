import { describe, expect, it } from "vitest";
import { computeScore, runA11yAudit, A11Y_IGNORE_ATTR } from "../engine.js";
import { audit, findingsFor, has, load } from "./helpers.js";

const CLEAN_PAGE = `
  <a href="#main">Skip to main content</a>
  <header><nav aria-label="Primary"><ul><li><a href="/">Home</a></li><li><a href="/about">About us</a></li></ul></nav></header>
  <main id="main">
    <h1>Bicycle shop</h1>
    <p>We sell bikes. <abbr title="Do it yourself">DIY</abbr> repair classes on <time datetime="2026-10-01">1 October</time>.</p>
    <img src="bike.png" alt="A red touring bicycle">
    <h2>Contact</h2>
    <form aria-label="Contact">
      <label for="n">Name</label><input id="n" name="name" type="text" autocomplete="name">
      <label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email">
      <button type="submit">Send message</button>
    </form>
    <h2>Prices</h2>
    <table><caption>Rental prices</caption><tr><th scope="col">Bike</th><th scope="col">Per day</th></tr><tr><td>City</td><td>10</td></tr></table>
  </main>
  <footer><p>Acme bikes</p></footer>`;

describe("engine", () => {
  it("reports zero findings on a well-formed page", () => {
    const r = audit(CLEAN_PAGE);
    expect(r.findings.map((f) => `${f.ruleId}/${f.check} ${f.selector}`)).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.rulesRun).toBe(89);
    expect(r.elementsScanned).toBeGreaterThan(30);
  });

  it("builds a complete JSON-safe report", () => {
    const r = audit('<img src="a.png"><button></button><a href="/">click here</a>');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const f = findingsFor(r, "img-element-error", "imgMissingAltNoAria")[0];
    expect(f).toMatchObject({ kind: "error", impact: "critical", severity: "Critical", wcag: "1.1.1", level: "A", selector: "body > img" });
    expect(f.message).toBe("[Critical] img missing alt attribute and has no aria-label or aria-labelledby (1.1.1 A)");
    expect(f.snippet).toBe('<img src="a.png">');
    expect(f.id).toMatch(/^a11y-[0-9a-z]+$/);
    expect(r.counts.errors + r.counts.warnings).toBe(r.findings.length);
    expect(Object.values(r.counts.byImpact).reduce((a, b) => a + b, 0)).toBe(r.findings.length);
    expect(r.counts.byWcag["1.1.1"]).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    expect(r.title).toBe("Fixture");
  });

  it("orders findings by impact, errors first", () => {
    const r = audit('<section><p>x</p></section><img src="a.png"><div role="heading">t</div>');
    const rank = { critical: 0, major: 1, minor: 2, info: 3 };
    const ranks = r.findings.map((f) => rank[f.impact]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("filters by rule ids and by errors-only", () => {
    load('<img src="a.png"><i class="icon"></i><a href="/">click here</a>');
    const only = runA11yAudit(document, { rules: ["img-element-warning"] });
    expect(only.rulesRun).toBe(1);
    expect(new Set(only.findings.map((f) => f.ruleId))).toEqual(new Set(["img-element-warning"]));
    const errs = runA11yAudit(document, { include: "errors" });
    expect(errs.findings.every((f) => f.kind === "error")).toBe(true);
    expect(errs.findings.length).toBeGreaterThan(0);
  });

  it("caps findings with maxFindings", () => {
    load("<img src=a.png>".repeat(50));
    const r = runA11yAudit(document, { maxFindings: 10 });
    expect(r.findings).toHaveLength(10);
    expect(r.truncated).toBe(true);
    expect(r.droppedFindings).toBeGreaterThan(0);
  });

  it("stops the walk at the time budget", () => {
    load("<div><span>x</span></div>".repeat(3000));
    const r = runA11yAudit(document, { timeBudgetMs: 1 });
    expect(r.truncated).toBe(true);
    expect(r.elementsScanned).toBeLessThan(6000);
  });

  it("isolates a throwing rule and keeps auditing", () => {
    load('<a id="boom" href="/x">x</a><img src="a.png">');
    const boom = document.getElementById("boom")!;
    Object.defineProperty(boom, "querySelectorAll", { value: () => { throw new Error("boom"); } });
    const r = runA11yAudit(document);
    expect(r.error).toBeUndefined();
    expect(has(r, "img-element-error/imgMissingAltNoAria")).toBe(true);
  });

  it("never throws on bad input", () => {
    expect(runA11yAudit(null).error).toBeUndefined();
    const weird = runA11yAudit({} as unknown as Document);
    expect(typeof weird.error).toBe("string");
    expect(weird.findings).toEqual([]);
  });

  it("ignores the highlight overlay", () => {
    load(`<div ${A11Y_IGNORE_ATTR}><img src="a.png"></div>`);
    expect(findingsFor(runA11yAudit(document), "img-element-error")).toEqual([]);
  });

  it("scores sub-linearly in instance count", () => {
    load("<img src=a.png>");
    const one = runA11yAudit(document).findings;
    load("<img src=a.png>".repeat(20));
    const many = runA11yAudit(document).findings;
    expect(computeScore(many)).toBeLessThan(computeScore(one));
    expect(computeScore(many)).toBeGreaterThan(computeScore(one) - 30);
    expect(computeScore([])).toBe(100);
  });
});
