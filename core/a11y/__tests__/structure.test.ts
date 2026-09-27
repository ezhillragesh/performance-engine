import { describe, expect, it } from "vitest";
import { STRUCTURE_RULES } from "../rules/structure.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), STRUCTURE_RULES.map((r) => r.id));

describe("structure: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("headings across the page", () => {
  it("accepts a proper outline, including going back up", () => {
    expect(has(audit("<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3>"), "heading-element-error/headingLevelSkipped")).toBe(false);
  });

  it("skips hidden headings when computing order", () => {
    const f = findingsFor(audit("<h1>A</h1><div hidden><h2>B</h2></div><h3>C</h3>"), "heading-element-error", "headingLevelSkipped");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toBe("h1 → h3");
  });

  it("includes role=heading with aria-level in the order", () => {
    expect(has(audit('<h1>A</h1><div role="heading" aria-level="4">B</div>'), "heading-element-error/headingLevelSkipped")).toBe(true);
  });

  it("counts only visible h1s", () => {
    expect(has(audit('<h1>A</h1><h1 style="display:none">B</h1>'), "heading-element-warning/multipleH1")).toBe(false);
  });

  it("names headings from image alt", () => {
    expect(has(audit('<h1><img src="l.png" alt="Acme"></h1>'), "heading-element-error/headingEmpty")).toBe(false);
  });
});

describe("landmarks", () => {
  it("accepts repeated landmarks with distinct names", () => {
    const r = audit('<nav aria-label="Primary"><a href="/">A</a></nav><nav aria-label="Footer"><a href="/b">B</a></nav>');
    expect(has(r, "landmark-element-warning/landmarkMissingAccessibleName")).toBe(false);
  });

  it("flags repeated landmarks that share a name", () => {
    const f = findingsFor(audit('<nav aria-label="Menu"><a href="/">A</a></nav><nav aria-label="Menu"><a href="/b">B</a></nav>'), "landmark-element-warning", "landmarkMissingAccessibleName");
    expect(f).toHaveLength(2);
    expect(f[0].detail).toMatch(/share the same name/);
  });

  it("does not treat a header inside an article as a banner landmark", () => {
    expect(has(audit('<article><header aria-hidden="true">x</header><p>y</p></article>'), "landmark-element-warning/landmarkAriaHidden")).toBe(false);
  });

  it("finds main via role=main and ignores hidden mains", () => {
    expect(has(audit('<div role="main">x</div>'), "landmark-element-error/pageHaveMainLandmark")).toBe(false);
    expect(has(audit("<main hidden>x</main>"), "landmark-element-error/pageHaveMainLandmark")).toBe(true);
  });
});

describe("lists and definition lists", () => {
  it("keeps role=list when list-style:none removes semantics", () => {
    expect(has(audit('<ul role="list" style="list-style: none"><li>A</li></ul>'), "list-element-warning/listRedundantRoleList")).toBe(false);
  });

  it("accepts dl groups wrapped in div", () => {
    const r = audit("<dl><div><dt>Name</dt><dd>Ada</dd></div><div><dt>Role</dt><dd>Engineer</dd></div></dl>");
    expect(findingsFor(r, "dl-element-error")).toEqual([]);
  });

  it("skips list checks when an explicit role overrides list semantics", () => {
    expect(findingsFor(audit('<ul role="tablist" aria-label="T"></ul>'), "list-element-error")).toEqual([]);
  });
});

describe("misc structure", () => {
  it("accepts machine-readable time text", () => {
    expect(has(audit("<time>2026-09-24</time>"), "time-element-error/timeElementMissingDatetimeAttribute")).toBe(false);
  });

  it("reports duplicate ids with the id and total", () => {
    const f = findingsFor(audit('<p id="a">1</p><p id="a">2</p><p id="a">3</p><p id="b">4</p>'), "duplicate-id-error");
    expect(f).toHaveLength(2);
    expect(f[0].detail).toBe('id="a" (3 elements)');
  });

  it("finds duplicate ids even inside hidden subtrees", () => {
    expect(has(audit('<p id="x">1</p><div hidden><p id="x">2</p></div>'), "duplicate-id-error/duplicateIdAttributeFound")).toBe(true);
  });

  it("accepts a blockquote attributed with <cite>", () => {
    expect(has(audit("<blockquote><p>Q</p><cite>Author</cite></blockquote>"), "blockquote-element-warning/blockquoteHaveCiteAttributeAttribution")).toBe(false);
  });
});
