// axe-core adapter, against the REAL axe-core axe.min.js in jsdom. color-contrast needs real
// layout (it is "incomplete" -> review in jsdom); the Chrome E2E checks real contrast failures.
import { describe, expect, it } from "vitest";
import { axeTagsFor, mapAxeResults, runAxeAudit, wcagFromAxeTag } from "../axe.js";
import { AXE_CORE_VERSION, wrapAxeSource } from "../loaders.js";
import { resolveXPath } from "../sourceUtil.js";
import { axeSource, installAxe, makeWindow, packageVersion } from "./engines.js";

const BODY = `<main>
  <h1>Checkout</h1>
  <img src="/logo.png?session=abc">
  <input type="text" value="secret-value">
  <button></button>
  <p style="color:#aaa;background:#fff">faint private text</p>
  <div role="banner"><div role="banner">nested</div></div>
</main>`;

describe("axe tags", () => {
  it("parses criterion tags", () => {
    expect(wcagFromAxeTag("wcag143")).toBe("1.4.3");
    expect(wcagFromAxeTag("wcag1412")).toBe("1.4.12");
    expect(wcagFromAxeTag("wcag2aa")).toBeNull();
    expect(wcagFromAxeTag("wcag21a")).toBeNull();
  });
  it("builds cumulative runOnly tags per standard", () => {
    expect(axeTagsFor({ version: "2.2", level: "AA", bestPractices: false })).toEqual(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]);
    expect(axeTagsFor({ version: "2.0", level: "A", bestPractices: true })).toEqual(["wcag2a", "best-practice"]);
    expect(axeTagsFor({ version: "2.1", level: "AAA", bestPractices: false })).toContain("wcag2aaa");
    expect(axeTagsFor({ profile: "section508", bestPractices: false })).toEqual(["wcag2a", "wcag2aa", "section508"]);
    expect(axeTagsFor({ profile: "en301549", bestPractices: false })).toContain("EN-301-549");
  });
});

describe("runAxeAudit (real axe-core)", () => {
  it("pins the vendored version to the devDependency", () => {
    expect(packageVersion("axe-core")).toBe(AXE_CORE_VERSION);
  });

  it("maps violations to errors and incomplete to review, with WCAG, impact, selectors, redaction", async () => {
    const w = makeWindow(BODY);
    const axe = installAxe(w);
    const r = await runAxeAudit(axe, w.document);
    expect(r.error).toBeUndefined();
    expect(r.engine).toBe("axe");
    expect(r.engineVersion).toBe(AXE_CORE_VERSION);
    const img = r.findings.find((f) => f.ruleId === "image-alt")!;
    expect(img).toMatchObject({ kind: "error", impact: "critical", wcag: "1.1.1", level: "A", selector: "body > main > img", engine: "axe" });
    const label = r.findings.find((f) => f.ruleId === "label")!;
    expect(label).toMatchObject({ kind: "error", wcag: "4.1.2", selector: "body > main > input", snippet: '<input type="text" value="[redacted]">' });
    const contrast = r.findings.find((f) => f.ruleId === "color-contrast")!;
    expect(contrast).toMatchObject({ kind: "review", impact: "major", wcag: "1.4.3", level: "AA" });
    const bp = r.findings.find((f) => f.ruleId === "landmark-banner-is-top-level" || f.ruleId === "landmark-no-duplicate-banner")!;
    expect(bp).toMatchObject({ bestPractice: true, wcag: "", level: null });
    const all = JSON.stringify(r);
    expect(all).not.toContain("secret-value");
    expect(all).not.toContain("faint private text");
    expect(all).not.toContain("session=abc");
  });

  it("restricts rules by standard (runOnly tags)", async () => {
    const w = makeWindow(BODY);
    const axe = installAxe(w);
    const r = await runAxeAudit(axe, w.document, { standard: { version: "2.0", level: "A", bestPractices: false } });
    expect(r.sourceRules).toContain("image-alt");
    expect(r.sourceRules).not.toContain("color-contrast"); // AA
    expect(r.sourceRules).not.toContain("target-size"); // 2.2
    expect(r.sourceRules).not.toContain("region"); // best practice
    expect(r.findings.some((f) => f.ruleId === "color-contrast")).toBe(false);
  });

  it("maps shadow-DOM targets and markup without a live element", () => {
    const w = makeWindow(`<div id="host"></div>`);
    const host = w.document.getElementById("host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `<img src="x.png">`;
    const { findings } = mapAxeResults(
      { violations: [{ id: "image-alt", impact: "critical", tags: ["wcag2a", "wcag111"], nodes: [
        { target: [["#host", "img"]], html: '<img src="x.png">' },
        { target: ["#gone"], html: '<img value="v" src="y.png?token=1">hello text' },
      ] }] },
      { doc: w.document },
    );
    // live shadow element: our own XPath (the form the page-side find() resolves), plus its node key
    const shadowPath = "/html[1]/body[1]/div[1]/#document-fragment[1]/img[1]";
    expect(findings[0]).toMatchObject({ selector: shadowPath, xpath: shadowPath, snippet: '<img src="x.png">', wcag: "1.1.1" });
    expect(findings[0].node).toMatch(/^n\w+:\w+$/);
    expect(resolveXPath(w.document, shadowPath)).toBe(host.shadowRoot!.querySelector("img"));
    expect(findings[1]).toMatchObject({ selector: "#gone", snippet: '<img value="[redacted]" src="y.png?…">' }); // markup only
  });

  it("does not clobber a page's own window.axe (and is idempotent)", () => {
    const w = makeWindow("");
    w.eval("window.axe = { mine: true };");
    installAxe(w);
    expect((w.axe as { mine?: boolean }).mine).toBe(true);
    const first = w.__PERF_INTEL_AXE__;
    expect(w.eval(wrapAxeSource(axeSource()))).toBe(AXE_CORE_VERSION);
    expect(w.__PERF_INTEL_AXE__).toBe(first);
    const w2 = makeWindow("");
    installAxe(w2);
    expect("axe" in w2).toBe(false); // no global left behind when the page had none
  });
});
