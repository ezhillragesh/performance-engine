// IBM Equal Access adapter, against the REAL accessibility-checker-engine ace.js in jsdom.
// (~0.3 s per scan in jsdom: getComputedStyle is slow there; contrast needs real layout -> Chrome E2E.)
import { describe, expect, it } from "vitest";
import { classifyIbmValue, ibmRulesetFor, mapIbmReport, runIbmAudit, type IbmReportLike } from "../ibm.js";
import { IBM_ACE_VERSION, wrapAceSource } from "../loaders.js";
import { resolveXPath } from "../sourceUtil.js";
import { aceSource, installAce, makeWindow, packageVersion } from "./engines.js";

const BODY = `<main>
  <h1>Checkout</h1>
  <img src="/logo.png?session=abc">
  <label for="email">Email</label><input id="email" type="email" autocomplete="nonsense" value="me@example.com">
  <input type="text" value="secret-value">
  <div contenteditable="true">typed private text</div>
  <nav role="navigation"><a href="/home">Home</a></nav>
</main>`;

async function scan(body = BODY, opts = {}) {
  const w = makeWindow(body);
  const ace = installAce(w);
  const report = await runIbmAudit(ace, w.document, opts);
  return { w, ace, report };
}

describe("IBM value -> kind / impact", () => {
  it.each([
    [["VIOLATION", "FAIL"], 1, { kind: "error", impact: "critical" }],
    [["VIOLATION", "FAIL"], 3, { kind: "error", impact: "major" }],
    [["VIOLATION", "POTENTIAL"], 1, { kind: "review", impact: "major" }],
    [["VIOLATION", "POTENTIAL"], 2, { kind: "review", impact: "minor" }],
    [["RECOMMENDATION", "FAIL"], 3, { kind: "warning", impact: "minor" }],
    [["RECOMMENDATION", "POTENTIAL"], 3, { kind: "warning", impact: "info" }],
    [["INFORMATION", "FAIL"], 4, { kind: "warning", impact: "info" }],
    [["VIOLATION", "PASS"], 1, null],
    [["VIOLATION", "MANUAL"], 1, null],
  ])("%j (toolkit level %i)", (value, tk, expected) => {
    expect(classifyIbmValue(value, tk)).toEqual(expected);
  });
  it("maps MANUAL to review only when asked", () => {
    expect(classifyIbmValue(["VIOLATION", "MANUAL"], 1, true)).toEqual({ kind: "review", impact: "info" });
  });
});

describe("runIbmAudit (real ace.js)", () => {
  it("pins the vendored version to the devDependency", () => {
    expect(packageVersion("accessibility-checker-engine")).toBe(IBM_ACE_VERSION);
  });

  it("chooses the ruleset from the standard", () => {
    expect(ibmRulesetFor({ version: "2.1", level: "AA", bestPractices: false })).toBe("WCAG_2_1");
    expect(ibmRulesetFor({ version: "2.0", bestPractices: false })).toBe("WCAG_2_0");
    expect(ibmRulesetFor({ version: "2.2", bestPractices: false })).toBe("WCAG_2_2");
    expect(ibmRulesetFor({ bestPractices: true })).toBe("IBM_Accessibility");
    expect(ibmRulesetFor({ profile: "section508", bestPractices: false })).toBe("IBM_Accessibility");
  });

  it("maps every kind, WCAG criterion and selector; never leaks values or text", async () => {
    const { w, report } = await scan();
    expect(report.error).toBeUndefined();
    expect(report.engine).toBe("ibm");
    expect(report.rulesRun).toBe(report.sourceRules!.length);
    expect(report.rulesRun).toBeGreaterThan(150); // IBM_Accessibility ruleset
    const img = report.findings.find((f) => f.ruleId === "img_alt_valid")!;
    expect(img).toMatchObject({ kind: "error", impact: "critical", wcag: "1.1.1", level: "A", selector: "body > main > img", engine: "ibm" });
    expect(img.snippet).toBe('<img src="/logo.png?…">');
    expect(w.document.querySelector(img.selector)).toBe(w.document.querySelector("img"));
    const ac = report.findings.find((f) => f.ruleId === "input_autocomplete_valid")!;
    expect(ac).toMatchObject({ kind: "error", wcag: "1.3.5", level: "AA", selector: "#email" });
    expect(report.findings.some((f) => f.kind === "review")).toBe(true); // e.g. element_tabbable_visible
    const red = report.findings.find((f) => f.ruleId === "aria_role_redundant")!;
    expect(red).toMatchObject({ kind: "warning", selector: "body > main > nav" });
    const all = JSON.stringify(report);
    expect(all).not.toContain("secret-value");
    expect(all).not.toContain("me@example.com");
    expect(all).not.toContain("typed private text");
    expect(all).not.toContain("session=abc");
    expect(JSON.parse(all)).toEqual(report);
  });

  it("uses the WCAG ruleset when best practices are off", async () => {
    const { report } = await scan(BODY, { standard: { version: "2.0", bestPractices: false } });
    expect(report.findings.some((f) => f.ruleId === "aria_role_redundant")).toBe(false); // IBM-only (ARIA) rule
    expect(report.findings.some((f) => f.ruleId === "img_alt_valid")).toBe(true);
  });

  it("resolves XPaths when results carry no live node (JSON clone) and falls back to the XPath", async () => {
    const w = makeWindow(BODY);
    const ace = installAce(w);
    const raw = (await new ace.Checker().check(w.document, ["IBM_Accessibility"])) as IbmReportLike;
    const cloned = JSON.parse(JSON.stringify({ results: raw.results.map((r) => ({ ...r, node: undefined })) })) as IbmReportLike;
    const { findings } = mapIbmReport(cloned, { doc: w.document });
    expect(findings.find((f) => f.ruleId === "img_alt_valid")?.selector).toBe("body > main > img");
    const orphan = mapIbmReport({ results: [{ ruleId: "img_alt_valid", reasonId: "fail_no_alt", value: ["VIOLATION", "FAIL"], path: { dom: "/html[1]/body[1]/div[9]" }, snippet: '<img value="x" src="a.png?t=1">' }] }, { doc: w.document });
    expect(orphan.findings[0]).toMatchObject({ selector: "/html[1]/body[1]/div[9]", xpath: "/html[1]/body[1]/div[9]", snippet: '<img value="[redacted]" src="a.png?…">' });
    expect(resolveXPath(w.document, "/html[2]/body[1]/main[1]/img[1]")).toBe(w.document.querySelector("img")); // doctype-counted root
    const frame = w.document.createElement("iframe");
    w.document.body.appendChild(frame);
    frame.contentDocument!.body.innerHTML = "<p>in frame</p>";
    expect(resolveXPath(w.document, "/html[1]/body[1]/iframe[1]/html[1]")).toBe(frame.contentDocument!.documentElement); // IBM frame paths
    expect(resolveXPath(w.document, "/html[1]/body[1]/iframe[1]/html[1]/body[1]/p[1]")?.textContent).toBe("in frame");
    expect(resolveXPath(w.document, "/html[1]/body[1]/iframe[1]/#document[1]/html[1]/body[1]/p[1]")?.textContent).toBe("in frame");
  });

  it("audits a subtree", async () => {
    const w = makeWindow(`<main><section id="card"><img src="a.png"></section><img src="b.png"></main>`);
    const ace = installAce(w);
    const report = await runIbmAudit(ace, w.document.getElementById("card"));
    const imgs = report.findings.filter((f) => f.ruleId === "img_alt_valid").map((f) => f.selector);
    expect(imgs).toEqual(["#card > img"]);
  });

  it("does not clobber a page's own `ace` global", () => {
    const w = makeWindow("");
    w.eval("var ace = { mine: true };");
    installAce(w);
    expect((w.ace as { mine?: boolean }).mine).toBe(true);
    expect(typeof (w.__PERF_INTEL_ACE__ as { ace: { Checker: unknown } }).ace.Checker).toBe("function");
    // Re-installing the same version is a no-op returning the version.
    const first = w.__PERF_INTEL_ACE__;
    expect(w.eval(wrapAceSource(aceSource()))).toBe(IBM_ACE_VERSION);
    expect(w.__PERF_INTEL_ACE__).toBe(first);
  });

  it("never rejects without an engine", async () => {
    const r = await runIbmAudit(null as never, makeWindow("").document);
    expect(r.error).toMatch(/not loaded/);
    expect(r.findings).toEqual([]);
  });
});
