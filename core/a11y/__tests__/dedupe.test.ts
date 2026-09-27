// One finding per element + problem: node-identity merge (the same element in three selector
// formats), canonical selectors / positions, catalog-equivalence collapse (the concrete duplicate
// pairs found on real pages), the parent/child policy, stable ordering and count consistency.
import { describe, expect, it } from "vitest";
import { mapAxeResults } from "../axe.js";
import { mapIbmReport } from "../ibm.js";
import { runA11yAudit } from "../engine.js";
import { DomCache } from "../dom.js";
import { computeScore, countFindings } from "../score.js";
import { canonicalXPath, comparePositions, elementPosition, elementForNodeKey, namePreview, nodeKey, positionContains, resolveXPath } from "../sourceUtil.js";
import type { A11yEngineId, A11yFinding, A11yReport } from "../types.js";
import { criteriaCoverage, mergeA11yReports, rulesCoverage } from "../unify.js";
import { UNIFIED_RULES } from "../catalog/unified.js";
import { makeWindow } from "./engines.js";

const EMPTY_COUNTS = { errors: 0, warnings: 0, reviews: 0, byImpact: { critical: 0, major: 0, minor: 0, info: 0 }, byWcag: {} };
const BASE = { url: "u", title: "t", durationMs: 1, rulesRun: 1, elementsScanned: 1, counts: EMPTY_COUNTS, score: 100, truncated: false, droppedFindings: 0, engineVersion: "1" };

type Src = Partial<A11yFinding> & { ruleId: string; selector: string };

/** Engine-level source finding (what the adapters emit), with node key and position. */
function src(engine: A11yEngineId, s: Src): A11yFinding {
  return { id: `${engine}-${s.ruleId}-${s.selector}`, check: "", kind: "error", impact: "major", severity: "Major", wcag: "", level: null, message: "", help: "", snippet: "", engine, ...s };
}

function rep(engine: A11yEngineId, findings: A11yFinding[], timestamp = 1): A11yReport {
  return { ...BASE, timestamp, engine, findings, sourceRules: [...new Set(findings.map((f) => f.ruleId))] };
}

const sourcesOf = (f: A11yFinding | undefined) => (f?.sources ?? []).map((s) => `${s.engine}:${s.rule}`).sort();

describe("canonical selectors and positions", () => {
  it("canonicalXPath round-trips through shadow roots and frames; elementPosition orders and nests", () => {
    const w = makeWindow(`<main><p>a</p><div id="host"></div><iframe></iframe><p>b</p></main>`);
    const doc = w.document;
    const host = doc.getElementById("host")!;
    host.attachShadow({ mode: "open" }).innerHTML = `<span></span><button><svg></svg></button>`;
    const frameDoc = (doc.querySelector("iframe") as HTMLIFrameElement).contentDocument!;
    frameDoc.body.innerHTML = `<img src="f.png">`;
    const btn = host.shadowRoot!.querySelector("button")!;
    const svg = btn.querySelector("svg")!;
    const fimg = frameDoc.querySelector("img")!;
    for (const el of [btn, svg, fimg, doc.querySelector("p")!]) expect(resolveXPath(doc, canonicalXPath(el))).toBe(el);
    expect(canonicalXPath(btn)).toBe("/html[1]/body[1]/main[1]/div[1]/#document-fragment[1]/button[1]");
    expect(canonicalXPath(fimg)).toBe("/html[1]/body[1]/main[1]/iframe[1]/html[1]/body[1]/img[1]");
    const [p1, p2] = [...doc.querySelectorAll("p")];
    const pos = (el: Element) => elementPosition(el);
    const order = [p2, fimg, svg, p1, btn, host].sort((a, b) => comparePositions(pos(a), pos(b)));
    expect(order).toEqual([p1, host, btn, svg, fimg, p2]); // shadow content right after its host, frame content after the frame
    expect(positionContains(pos(btn), pos(svg))).toBe(true);
    expect(positionContains(pos(host), pos(svg))).toBe(true); // composed tree
    expect(positionContains(pos(svg), pos(btn))).toBe(false);
    expect(positionContains(pos(doc.querySelector("iframe")!), pos(fimg))).toBe(true);
  });

  it("nodeKey is one identity per element, resolvable while connected", () => {
    const w = makeWindow(`<img src="a.png"><img src="b.png">`);
    const [a, b] = [...w.document.querySelectorAll("img")];
    expect(nodeKey(a)).toBe(nodeKey(a));
    expect(nodeKey(a)).not.toBe(nodeKey(b));
    expect(elementForNodeKey(nodeKey(b))).toBe(b);
    b.remove();
    expect(elementForNodeKey(nodeKey(b))).toBeNull();
  });

  it("namePreview tells rows apart without reading form data", () => {
    const w = makeWindow(`<a href="/x">  Read the   returns policy </a><input value="secret"><textarea>typed</textarea>
      <div id="c"><label>Code <input value="s3cret"></label></div><button aria-label="Search orders"><svg></svg></button><img alt="Logo">
      <p contenteditable="true">draft</p><span>${"long ".repeat(30)}</span><div id="t"><a>v</a><a>t</a>Title<style>.x{}</style></div>`);
    const d = w.document;
    const dom = new DomCache(d);
    const q = (s: string) => d.querySelector(s)!;
    expect(namePreview(q("a"), dom)).toBe("Read the returns policy");
    expect(namePreview(q("button"), dom)).toBe("Search orders");
    expect(namePreview(q("img"), dom)).toBe("Logo");
    for (const s of ["input", "textarea", "#c", "label", "p", "body", "html"]) expect(namePreview(q(s), dom)).toBe("");
    expect(namePreview(q("span"), dom).length).toBeLessThanOrEqual(60);
    expect(namePreview(q("#t"), dom)).toBe("v t Title"); // adjacent inline text is not glued together; no CSS text
  });
});

describe("node-identity merge", () => {
  it("merges one element given in three selector formats into one finding with our selector", () => {
    const w = makeWindow(`<main><h1>Shop</h1><img id="logo-x" class="c" src="a.png"></main>`);
    const doc = w.document;
    const inspect = runA11yAudit(doc); // A11yInspect port: our CSS path
    const ibm = mapIbmReport({ results: [{ ruleId: "img_alt_valid", reasonId: "fail_no_alt", value: ["VIOLATION", "FAIL"], path: { dom: "/html[1]/body[1]/main[1]/img[1]" } }] }, { doc });
    const axe = mapAxeResults({ violations: [{ id: "image-alt", impact: "critical", tags: ["wcag2a", "wcag111"], nodes: [{ target: ["main > img.c"], html: "<img>" }] }] }, { doc });
    const img = doc.querySelector("img")!;
    const k = nodeKey(img);
    expect(inspect.findings.find((f) => f.ruleId === "img-element-error")?.node).toBe(k);
    expect(ibm.findings[0].node).toBe(k);
    expect(axe.findings[0].node).toBe(k);
    const m = mergeA11yReports([inspect, { ...rep("axe", axe.findings), sourceRules: ["image-alt"] }, { ...rep("ibm", ibm.findings), sourceRules: ["img_alt_valid"] }]);
    const alt = m.findings.filter((f) => f.ruleId === "image-alt");
    expect(alt).toHaveLength(1);
    expect(alt[0].selector).toBe("#logo-x");
    expect(sourcesOf(alt[0])).toEqual(["a11yinspect:img-element-error", "axe:image-alt", "ibm:img_alt_valid"]);
  });

  it("merges a shadow-DOM element reported as axe 'host >>> inner' and IBM XPath; the page can find it", () => {
    const w = makeWindow(`<div id="host"></div>`);
    const doc = w.document;
    doc.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = `<button></button>`;
    const btn = doc.getElementById("host")!.shadowRoot!.querySelector("button")!;
    const axe = mapAxeResults({ violations: [{ id: "button-name", impact: "critical", tags: ["wcag2a", "wcag412"], nodes: [{ target: [["#host", "button"]], html: "<button>" }] }] }, { doc });
    // Same element, two formats: axe a [host, inner] target, IBM an XPath (without a live node).
    const ibm = mapIbmReport({ results: [{ ruleId: "input_label_exists", reasonId: "Fail_1", value: ["VIOLATION", "FAIL"], path: { dom: "/html[1]/body[1]/div[1]/#document-fragment[1]/button[1]" } }] }, { doc });
    const m = mergeA11yReports([rep("axe", axe.findings), rep("ibm", ibm.findings)]);
    expect(m.findings).toHaveLength(1);
    const f = m.findings[0];
    expect(f).toMatchObject({ ruleId: "button-name", selector: "/html[1]/body[1]/div[1]/#document-fragment[1]/button[1]", node: nodeKey(btn) });
    expect(sourcesOf(f)).toEqual(["axe:button-name", "ibm:input_label_exists"]);
    expect(resolveXPath(doc, f.selector)).toBe(btn);
  });

  it("keys by node, not selector: an element whose selector changed between runs is one finding (newest selector)", () => {
    const a = src("a11yinspect", { ruleId: "img-element-error", check: "imgMissingAlt", selector: "body > img", node: "nX:1", pos: "1.2.1", snippet: "<img>" });
    const b = src("axe", { ruleId: "image-alt", selector: "body > img:nth-of-type(2)", node: "nX:1", pos: "1.2.2", snippet: "<img>" });
    const m = mergeA11yReports([rep("a11yinspect", [a], 1), rep("axe", [b], 2)]);
    expect(m.findings).toHaveLength(1);
    expect(m.findings[0].selector).toBe("body > img:nth-of-type(2)");
  });

  it("an element replaced in place (same selector, new node key in a newer run) is not listed twice", () => {
    const old = src("axe", { ruleId: "image-alt", selector: "body > img", node: "nX:1", pos: "1.2.1", snippet: "<img>" });
    const fresh = src("a11yinspect", { ruleId: "img-element-error", check: "imgMissingAlt", selector: "body > img", node: "nX:9", pos: "1.2.1", snippet: "<img>" });
    const m = mergeA11yReports([rep("a11yinspect", [fresh], 5), rep("axe", [old], 1)]);
    expect(m.findings).toHaveLength(1);
    expect(m.findings[0].node).toBe("nX:9");
  });

  it("two different elements with the same rule stay two findings", () => {
    const a = src("axe", { ruleId: "image-alt", selector: "body > img:nth-of-type(1)", node: "nX:1", pos: "1.2.1", snippet: "<img>" });
    const b = src("axe", { ruleId: "image-alt", selector: "body > img:nth-of-type(2)", node: "nX:2", pos: "1.2.2", snippet: "<img>" });
    expect(mergeA11yReports([rep("axe", [a, b])]).findings).toHaveLength(2);
  });
});

describe("catalog-equivalence collapse (pairs found on real pages)", () => {
  const at = { node: "nQ:1", pos: "1.2.3" };

  it("Wikipedia: aria-required-children + list on a native <ul> -> one list finding", () => {
    const ul = { ...at, selector: "#toc-sublist", snippet: '<ul id="toc-sublist" class="vector-toc-list">' };
    const m = mergeA11yReports([
      rep("ibm", [src("ibm", { ruleId: "aria_child_valid", check: "Fail_no_child", ...ul })]),
      rep("a11yinspect", [src("a11yinspect", { ruleId: "list-element-error", check: "listNoItems", ...ul })]),
    ]);
    expect(m.findings.map((f) => f.ruleId)).toEqual(["list"]);
    expect(sourcesOf(m.findings[0])).toEqual(["a11yinspect:list-element-error", "ibm:aria_child_valid"]);
    // An ARIA role still needs its own children rule.
    const menu = mergeA11yReports([rep("ibm", [src("ibm", { ruleId: "aria_child_valid", ...at, selector: "#m", snippet: '<div role="menu">' })])]);
    expect(menu.findings[0].ruleId).toBe("aria-required-children");
  });

  it("fixture + Wikipedia: link-href (scripted link emulation) + keyboard-access on a <div onclick> -> one keyboard-access", () => {
    const div = { ...at, selector: "body > form > div", snippet: '<div class="fake-btn" onclick="void 0">' };
    const m = mergeA11yReports([
      rep("a11yinspect", [src("a11yinspect", { ruleId: "click-handler-warning", check: "onclickWithoutOnkeydownOnkeyup", kind: "warning", ...div })]),
      rep("ibm", [src("ibm", { ruleId: "script_onclick_avoid", check: "Potential_1", kind: "warning", impact: "info", ...div })]),
    ]);
    expect(m.findings.map((f) => f.ruleId)).toEqual(["keyboard-access"]);
    // On a real link it is still a link problem.
    const a = mergeA11yReports([rep("ibm", [src("ibm", { ruleId: "script_onclick_avoid", ...at, selector: "a", snippet: '<a href="#">' })])]);
    expect(a.findings[0].ruleId).toBe("link-href");
  });

  it("fixture: axe aria-valid-attr-value (id reference not found) + IBM aria_id_unique -> one aria-valid-reference", () => {
    const div = { ...at, selector: "body > div:nth-of-type(2)", snippet: '<div role="buton" aria-labelledby="missing-id">' };
    const m = mergeA11yReports([
      rep("axe", [src("axe", { ruleId: "aria-valid-attr-value", check: "aria-valid-attr-value:noId", kind: "review", ...div })]),
      rep("ibm", [src("ibm", { ruleId: "aria_id_unique", check: "Fail_1", ...div })]),
    ]);
    expect(m.findings.map((f) => f.ruleId)).toEqual(["aria-valid-reference"]);
    expect(m.findings[0].kind).toBe("error");
    const other = mergeA11yReports([rep("axe", [src("axe", { ruleId: "aria-valid-attr-value", check: "aria-valid-attr-value", ...div })])]);
    expect(other.findings[0].ruleId).toBe("aria-valid-attr-value"); // a wrong token value stays a value problem
  });

  it("demo + fixture: label + label-visible on a placeholder-only input -> one label finding", () => {
    const input = { ...at, selector: "body > main > section > input", snippet: '<input type="text" name="coupon" placeholder="[redacted]">' };
    const m = mergeA11yReports([
      rep("a11yinspect", [
        src("a11yinspect", { ruleId: "input-element-error", check: "inputMissingAssociatedLabel", ...input }),
        src("a11yinspect", { ruleId: "input-element-warning", check: "inputPlaceholderLabelSubstitute", kind: "warning", ...input }),
      ]),
      rep("ibm", [src("ibm", { ruleId: "input_label_visible", check: "potential_placeholder_only", kind: "review", ...input })]),
    ]);
    expect(m.findings.map((f) => f.ruleId)).toEqual(["label"]);
    expect(m.findings[0].sources).toHaveLength(3);
    // label-visible alone (a field that has a label, but only a hidden one) still shows.
    const alone = mergeA11yReports([rep("ibm", [src("ibm", { ruleId: "input_label_visible", check: "potential_no_label", kind: "review", ...input })])]);
    expect(alone.findings[0].ruleId).toBe("label-visible");
  });

  it("page-level rules anchored on <html> by one engine and <body> by another -> one finding on <html>; a frame's document stays separate", () => {
    const html = { node: "nQ:h", pos: "1", selector: "html", snippet: '<html lang="en">' };
    const body = { node: "nQ:b", pos: "1.2", selector: "body", snippet: "<body>" };
    const frameHtml = { node: "nQ:f", pos: "1.2.4.1", selector: "/html[1]/body[1]/iframe[1]/html[1]", xpath: "/html[1]/body[1]/iframe[1]/html[1]", snippet: "<html>" };
    const m = mergeA11yReports([
      rep("axe", [src("axe", { ruleId: "landmark-one-main", ...html })]),
      rep("a11yinspect", [src("a11yinspect", { ruleId: "landmark-element-error", check: "pageHaveMainLandmark", ...body }), src("a11yinspect", { ruleId: "skip-link-warning", check: "pageHaveSkipLink", kind: "warning", ...body })]),
      rep("ibm", [src("ibm", { ruleId: "html_skipnav_exists", check: "Potential_1", kind: "review", ...html }), src("ibm", { ruleId: "html_skipnav_exists", check: "Potential_1", kind: "review", ...frameHtml })]),
    ]);
    const main = m.findings.filter((f) => f.ruleId === "landmark-one-main");
    expect(main).toHaveLength(1);
    expect(main[0]).toMatchObject({ selector: "html", snippet: '<html lang="en">' });
    const bypass = m.findings.filter((f) => f.ruleId === "bypass");
    expect(bypass.map((f) => f.selector).sort()).toEqual(["/html[1]/body[1]/iframe[1]/html[1]", "html"]);
    expect(sourcesOf(bypass.find((f) => f.selector === "html"))).toEqual(["a11yinspect:skip-link-warning", "ibm:html_skipnav_exists"]);
  });
});

describe("parent/child policy", () => {
  const f = (engine: A11yEngineId, ruleId: string, pos: string, snippet: string, extra: Partial<A11yFinding> = {}) =>
    src(engine, { ruleId, pos, node: `nP:${pos}`, selector: `sel-${pos}`, snippet, ...extra });

  it("region: the uncovered container is the finding, not each of its children (example.com, fixture, MDN)", () => {
    const m = mergeA11yReports([
      rep("axe", [f("axe", "region", "1.2.1", "<div>", { impact: "minor" })]),
      rep("ibm", [f("ibm", "aria_content_in_landmark", "1.2.1.1", "<h1>"), f("ibm", "aria_content_in_landmark", "1.2.1.2.1", '<a href="/x">'), f("ibm", "aria_content_in_landmark", "1.2.2", "<p>")]),
    ]);
    const region = m.findings.filter((x) => x.ruleId === "region");
    expect(region.map((x) => x.pos)).toEqual(["1.2.1", "1.2.2"]); // the sibling outside the div stays
    expect(region.find((x) => x.pos === "1.2.1")).toMatchObject({ impact: "major" }); // most severe of the folded
  });

  it("aria-hidden-focus: the aria-hidden container, not each focusable inside (fixture)", () => {
    const m = mergeA11yReports([
      rep("axe", [f("axe", "aria-hidden-focus", "1.2.5", '<div aria-hidden="true">')]),
      rep("a11yinspect", [f("a11yinspect", "aria-element-warning", "1.2.5.1", '<a href="/hidden">', { check: "ariaHiddenFocusableElement", kind: "warning" })]),
      rep("ibm", [f("ibm", "aria_hidden_nontabbable", "1.2.5.1", '<a href="/hidden">')]),
    ]);
    expect(m.findings.map((x) => [x.ruleId, x.pos])).toEqual([["aria-hidden-focus", "1.2.5"]]);
    expect(m.findings[0].sources).toHaveLength(3);
  });

  it("button-name / link-name: the interactive element, not its decorative child; an icon inside an unnamed control folds into it", () => {
    const m = mergeA11yReports([
      rep("axe", [f("axe", "button-name", "1.2.3", '<button type="button">')]),
      rep("a11yinspect", [f("a11yinspect", "button-element-error", "1.2.3.1", "<svg>", { check: "buttonAccessibleName" }), f("a11yinspect", "svg-element-warning", "1.2.3.1", "<svg>", { check: "svgMissingRole", kind: "warning", impact: "info" })]),
      rep("ibm", [f("ibm", "svg_graphics_labelled", "1.2.3.1", "<svg>"), f("ibm", "svg_graphics_labelled", "1.2.9.1", "<svg>")]),
    ]);
    // 1.2.3 is the unnamed button: its svg's name / role findings are the same missing name.
    expect(m.findings.map((x) => [x.ruleId, x.pos]).sort()).toEqual([["button-name", "1.2.3"], ["svg-img-alt", "1.2.9.1"]]);
    expect(sourcesOf(m.findings.find((x) => x.ruleId === "button-name"))).toEqual(["a11yinspect:button-element-error", "a11yinspect:svg-element-warning", "axe:button-name", "ibm:svg_graphics_labelled"]);
  });

  it("image-alt: the <img>, not the link reported around it; nested text with its own contrast stays separate", () => {
    const m = mergeA11yReports([
      rep("a11yinspect", [f("a11yinspect", "a-element-error", "1.2.4", '<a href="/b">', { check: "linkImgMissingAlt" })]),
      rep("axe", [f("axe", "image-alt", "1.2.4.1", '<img src="b.png">'), f("axe", "color-contrast", "1.2.7", "<h3>"), f("axe", "color-contrast", "1.2.7.1", "<span>")]),
    ]);
    expect(m.findings.filter((x) => x.ruleId === "image-alt").map((x) => x.pos)).toEqual(["1.2.4.1"]);
    expect(m.findings.filter((x) => x.ruleId === "color-contrast")).toHaveLength(2);
  });
});

describe("order, idempotency and count consistency", () => {
  function sample(): A11yReport[] {
    const g = (engine: A11yEngineId, ruleId: string, pos: string, kind: A11yFinding["kind"], impact: A11yFinding["impact"], snippet = "<p>") =>
      src(engine, { ruleId, pos, node: `nC:${pos}`, selector: `s${pos}`, kind, impact, snippet });
    return [
      rep("axe", [g("axe", "region", "1.2.9", "error", "minor", "<div>"), g("axe", "image-alt", "1.2.5", "error", "critical", "<img>"), g("axe", "color-contrast", "1.2.3", "review", "major"), g("axe", "color-contrast", "1.2.1", "error", "major"), g("axe", "label", "1.2.2", "error", "critical", '<input type="text">')]),
      rep("ibm", [g("ibm", "img_alt_valid", "1.2.5", "error", "critical", "<img>"), g("ibm", "img_alt_valid", "1.2.4", "error", "critical", "<img>"), g("ibm", "text_contrast_sufficient", "1.2.3", "error", "major"), g("ibm", "input_label_visible", "1.2.2", "review", "major", '<input type="text">')]),
    ];
  }

  it("orders by impact, kind, rule, then document order", () => {
    const m = mergeA11yReports(sample());
    const order = new Map(UNIFIED_RULES.map((r, i) => [r.id, i]));
    for (let i = 1; i < m.findings.length; i++) {
      const [a, b] = [m.findings[i - 1], m.findings[i]];
      const key = (x: A11yFinding) => [["critical", "major", "minor", "info"].indexOf(x.impact), ["error", "review", "warning"].indexOf(x.kind), order.get(x.ruleId) ?? 999];
      const [ka, kb] = [key(a), key(b)];
      const cmp = ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || comparePositions(a.pos, b.pos);
      expect(cmp).toBeLessThan(0);
    }
    expect(m.findings.filter((f) => f.ruleId === "image-alt").map((f) => f.pos)).toEqual(["1.2.4", "1.2.5"]);
    // Engine order does not change the result.
    const rev = mergeA11yReports([...sample()].reverse());
    expect(rev.findings.map((f) => f.id)).toEqual(m.findings.map((f) => f.id));
    expect(rev.score).toBe(m.score);
  });

  it("counts, score, rule and criterion coverage all derive from the same deduped list", () => {
    const m = mergeA11yReports(sample());
    const n = m.findings.length;
    expect(new Set(m.findings.map((f) => f.id)).size).toBe(n);
    expect(new Set(m.findings.map((f) => `${f.ruleId}|${f.node}`)).size).toBe(n);
    expect(m.counts).toEqual(countFindings(m.findings));
    expect(m.counts.errors + m.counts.reviews + m.counts.warnings).toBe(n);
    expect(Object.values(m.counts.byImpact).reduce((s, x) => s + x, 0)).toBe(n);
    expect(m.score).toBe(computeScore(m.findings));
    const perRule = new Map<string, number>();
    for (const f of m.findings) perRule.set(f.ruleId, (perRule.get(f.ruleId) ?? 0) + 1);
    for (const r of rulesCoverage(m)) expect(r.findings).toBe(perRule.get(r.rule.id) ?? 0);
    for (const c of criteriaCoverage(m)) expect(c.errors + c.reviews).toBe(m.findings.filter((f) => (f.criteria ?? []).includes(c.num)).length);
    // The score counts a unified rule once, whichever source's check came first.
    const oneRule = mergeA11yReports([sample()[1], sample()[0]]);
    expect(oneRule.score).toBe(m.score);
  });

  it("re-merging a unified report (re-filtering, imports) is idempotent, folded sources included", () => {
    const m = mergeA11yReports(sample());
    const again = mergeA11yReports([JSON.parse(JSON.stringify(m)) as A11yReport]);
    expect(again.findings.map((f) => [f.id, f.ruleId, f.kind, f.impact, f.selector])).toEqual(m.findings.map((f) => [f.id, f.ruleId, f.kind, f.impact, f.selector]));
    expect(again.counts).toEqual(m.counts);
  });
});
