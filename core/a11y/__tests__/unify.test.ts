// Unified merge of all three engines (real engines in jsdom), standard filtering, coverage views.
import { describe, expect, it } from "vitest";
import { runAxeAudit } from "../axe.js";
import { UNIFIED_RULES } from "../catalog/unified.js";
import { runA11yAudit } from "../engine.js";
import { runIbmAudit } from "../ibm.js";
import type { A11yFinding, A11yReport } from "../types.js";
import { criteriaCoverage, mergeA11yReports, rulesCoverage, shapeFromSnippet } from "../unify.js";
import { installAce, installAxe, makeWindow } from "./engines.js";

const BODY = `<main>
  <h1>Order</h1>
  <img src="a.png">
  <button><svg width="10" height="10"></svg></button>
  <input type="text" id="coupon" value="SECRET">
  <p style="color:#aaa;background:#fff">faint</p>
  <p>To learn more, <a href="/policy">click here</a>.</p>
</main>`;

async function allEngines(body = BODY): Promise<A11yReport[]> {
  const w = makeWindow(body);
  const ace = installAce(w);
  const axe = installAxe(w);
  return [runA11yAudit(w.document), await runAxeAudit(axe, w.document), await runIbmAudit(ace, w.document)];
}

const ruleOf = (r: A11yReport, id: string, sel?: string): A11yFinding | undefined => r.findings.find((f) => f.ruleId === id && (!sel || f.selector === sel));
const engines = (f: A11yFinding | undefined) => [...new Set(f?.sources?.map((s) => s.engine))].sort();

const EMPTY_COUNTS = { errors: 0, warnings: 0, reviews: 0, byImpact: { critical: 0, major: 0, minor: 0, info: 0 }, byWcag: {} };
const BASE = { url: "u", title: "t", timestamp: 1, durationMs: 1, rulesRun: 1, elementsScanned: 1, counts: EMPTY_COUNTS, score: 100, truncated: false, droppedFindings: 0, engineVersion: "1" };

function src(engine: "ibm" | "axe" | "a11yinspect", ruleId: string, check: string, kind: A11yFinding["kind"], impact: A11yFinding["impact"], selector = "#x", snippet = '<a href="/x">'): A11yFinding {
  return { id: `${engine}-${ruleId}`, ruleId, check, kind, impact, severity: "Minor", wcag: "", level: null, message: "", help: "", selector, snippet, engine };
}

function rep(engine: "ibm" | "axe" | "a11yinspect", findings: A11yFinding[], sourceRules: string[]): A11yReport {
  return { ...BASE, engine, findings, sourceRules };
}

describe("mergeA11yReports", () => {
  it("dedupes the same element + unified rule across all three engines", async () => {
    const m = mergeA11yReports(await allEngines());
    const img = ruleOf(m, "image-alt")!;
    expect(engines(img)).toEqual(["a11yinspect", "axe", "ibm"]);
    expect(img).toMatchObject({ kind: "error", impact: "critical", wcag: "1.1.1", level: "A", selector: "body > main > img", message: "Images must have a text alternative", criteria: ["1.1.1"] });
    expect(m.findings.filter((f) => f.selector === "body > main > img" && f.ruleId === "image-alt")).toHaveLength(1);
    // IBM reports an unnamed button under its generic "form control label" check: refined to button-name.
    expect(engines(ruleOf(m, "button-name"))).toEqual(["a11yinspect", "axe", "ibm"]);
    expect(ruleOf(m, "label", "body > main > button")).toBeUndefined();
    expect(new Set(m.findings.map((f) => f.id)).size).toBe(m.findings.length);
    for (const f of m.findings) expect(f.message).toBe(UNIFIED_RULES.find((r) => r.id === f.ruleId)!.title);
    expect(JSON.stringify(m)).not.toContain("SECRET");
  });

  it("finds issues the A11yInspect port alone cannot (e.g. contrast)", async () => {
    const [inspect, ...others] = await allEngines();
    const alone = mergeA11yReports([inspect]);
    const all = mergeA11yReports([inspect, ...others]);
    expect(ruleOf(alone, "color-contrast")).toBeUndefined();
    expect(ruleOf(all, "color-contrast", "body > main > p:nth-of-type(1)")?.kind).toBe("review"); // jsdom has no layout -> review
    expect(all.findings.length).toBeGreaterThan(alone.findings.length);
    expect(all.rulesChecked!.length).toBeGreaterThan(alone.rulesChecked!.length);
  });

  it("keeps the most severe kind and impact, recomputes counts and score", () => {
    const r1 = rep("ibm", [src("ibm", "a_text_purpose", "fail_acc_name", "review", "minor")], ["a_text_purpose"]);
    const r2 = rep("axe", [src("axe", "link-name", "", "warning", "major")], ["link-name"]);
    const r3 = rep("a11yinspect", [src("a11yinspect", "a-element-error", "linkAccessibleName", "error", "critical")], ["a-element-error"]);
    const m = mergeA11yReports([r1, r2, r3]);
    expect(m.findings).toHaveLength(1);
    expect(m.findings[0]).toMatchObject({ ruleId: "link-name", kind: "error", impact: "critical", severity: "Critical" });
    expect(m.findings[0].sources).toHaveLength(3);
    expect(m.counts).toMatchObject({ errors: 1, warnings: 0, reviews: 0 });
    expect(m.score).toBeLessThan(100);
    const reviewOnly = mergeA11yReports([r1]);
    expect(reviewOnly.findings[0].kind).toBe("review");
    expect(reviewOnly.counts.reviews).toBe(1);
    expect(reviewOnly.score).toBeGreaterThan(m.score); // a possible issue weighs less than an error
    expect(m.engines!.map((e) => e.engine)).toEqual(["ibm", "axe", "a11yinspect"]);
    expect(m.rulesChecked).toContain("link-name");
    // kind order error > review > warning
    const rw = mergeA11yReports([r1, r2]);
    expect(rw.findings[0].kind).toBe("review");
  });

  it("filters by WCAG level, best practices and needs-review; re-filtering a unified report is equivalent", async () => {
    const reports = await allEngines();
    const full = mergeA11yReports(reports);
    const levelA = mergeA11yReports(reports, { standard: { level: "A" } });
    const noBp = mergeA11yReports(reports, { standard: { bestPractices: false } });
    const noReview = mergeA11yReports(reports, { standard: { includeReview: false } });
    expect(ruleOf(full, "color-contrast")).toBeDefined();
    expect(ruleOf(levelA, "color-contrast")).toBeUndefined(); // 1.4.3 is AA
    expect(ruleOf(levelA, "image-alt")).toBeDefined();
    expect(full.findings.some((f) => f.bestPractice)).toBe(true);
    expect(noBp.findings.some((f) => f.bestPractice)).toBe(false);
    expect(noReview.findings.some((f) => f.kind === "review")).toBe(false);
    expect(noReview.counts.reviews).toBe(0);
    expect(levelA.standard).toMatchObject({ version: "2.2", level: "A" });
    const refiltered = mergeA11yReports([JSON.parse(JSON.stringify(full)) as A11yReport], { standard: { level: "A" } });
    expect(refiltered.findings.map((f) => f.id).sort()).toEqual(levelA.findings.map((f) => f.id).sort());
    expect(refiltered.rulesChecked).toEqual(levelA.rulesChecked);
  });

  it("excludes criteria newer than the chosen version and treats 4.1.1 as obsolete in 2.2", () => {
    const target = rep("axe", [src("axe", "target-size", "", "error", "major")], ["target-size"]); // 2.5.8, WCAG 2.2
    expect(mergeA11yReports([target], { standard: { version: "2.2" } }).findings).toHaveLength(1);
    expect(mergeA11yReports([target], { standard: { version: "2.1" } }).findings).toHaveLength(0);
    const dup = rep("a11yinspect", [src("a11yinspect", "duplicate-id-error", "duplicateIdAttributeFound", "error", "minor")], ["duplicate-id-error"]); // 4.1.1
    expect(mergeA11yReports([dup], { standard: { version: "2.1", bestPractices: false } }).findings).toHaveLength(1);
    expect(mergeA11yReports([dup], { standard: { version: "2.2", bestPractices: false } }).findings).toHaveLength(0);
    expect(mergeA11yReports([dup], { standard: { version: "2.2", bestPractices: true } }).findings).toHaveLength(1);
  });

  it("keeps unmapped source rules under a fallback rule", () => {
    const f = { ...src("axe", "brand-new-rule", "", "error", "minor", "#n", "<p>"), wcag: "1.1.1", level: "A" as const };
    expect(mergeA11yReports([rep("axe", [f], [])]).findings[0]).toMatchObject({ ruleId: "other", wcag: "1.1.1" });
  });

  it("reports what could not be checked as info", () => {
    const m = mergeA11yReports([rep("axe", [src("axe", "frame-tested", "", "review", "critical", "body > iframe", "<iframe>")], ["frame-tested"])]);
    expect(m.findings[0]).toMatchObject({ ruleId: "frame-unchecked", kind: "review", impact: "info" });
  });

  it("parses element shapes from snippets", () => {
    expect(shapeFromSnippet('<input type="submit" value="[redacted]">')).toEqual({ tag: "input", role: "", type: "submit", href: false });
    expect(shapeFromSnippet('<div role="button slider">')).toMatchObject({ tag: "div", role: "button" });
  });
});

describe("coverage views", () => {
  it("reports every criterion of the standard with an automated status", async () => {
    const m = mergeA11yReports(await allEngines());
    const cov = criteriaCoverage(m);
    expect(cov).toHaveLength(55); // WCAG 2.2 A + AA
    const by = Object.fromEntries(cov.map((c) => [c.num, c]));
    expect(by["1.1.1"].status).toBe("failing");
    expect(by["1.4.3"].status).toBe("review");
    expect(by["2.4.2"].status).toBe("passed"); // the page has a title and it was checked
    expect(by["3.3.8"].status).toBe("untested"); // no automated check exists
    expect(criteriaCoverage(m, { version: "2.0", level: "A" })).toHaveLength(25);
    expect(criteriaCoverage(m, { version: "2.2", level: "AAA" })).toHaveLength(86);
  });

  it("reports every rule of the standard as failing / review / passed / unchecked", async () => {
    const m = mergeA11yReports(await allEngines());
    const rules = rulesCoverage(m);
    const by = Object.fromEntries(rules.map((r) => [r.rule.id, r]));
    expect(by["image-alt"]).toMatchObject({ status: "failing", findings: 1 });
    expect(by["document-title"].status).toBe("passed");
    expect(rulesCoverage(null).every((r) => r.status === "unchecked")).toBe(true);
  });
});
