import { describe, expect, it } from "vitest";
import { IMAGE_RULES } from "../rules/images.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), IMAGE_RULES.map((r) => r.id));

describe("images: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("images: negatives and runtime refinements", () => {
  it('treats alt="" as a valid decorative image', () => {
    const r = audit('<img src="a.png" alt="">');
    expect(findingsFor(r, "img-element-error")).toEqual([]);
  });

  it('reports alt="" when the image is the only content of a link', () => {
    const r = audit('<a href="/"><img src="logo.png" alt=""></a>');
    expect(has(r, "img-element-error/imgEmptyAlt")).toBe(true);
    expect(has(r, "a-element-error/linkAccessibleName")).toBe(true);
  });

  it("does not treat italic text as an icon", () => {
    const r = audit("<p><i>emphasis</i></p>");
    expect(has(r, "img-element-warning/iconMissingRoleImg")).toBe(false);
  });

  it("skips aria-hidden icons and SVGs", () => {
    const r = audit('<i class="icon" aria-hidden="true"></i><svg aria-hidden="true" width="4" height="4"></svg>');
    expect(findingsFor(r, "img-element-warning")).toEqual([]);
    expect(findingsFor(r, "svg-element-warning")).toEqual([]);
    expect(findingsFor(r, "svg-element-error")).toEqual([]);
  });

  it("accepts an SVG named by <title> or aria-labelledby", () => {
    const r = audit('<svg role="img"><title>Company logo</title></svg><span id="l">Chart</span><svg role="img" aria-labelledby="l"></svg>');
    expect(has(r, "svg-element-error/svgMissingName")).toBe(false);
    expect(has(r, "svg-element-warning/svgRoleImgNoDescription")).toBe(false);
  });

  it('does not require a name on role="none" SVGs', () => {
    expect(has(audit('<svg role="none"></svg>'), "svg-element-error/svgMissingName")).toBe(false);
  });

  it("does not flag an SVG inside a named button as nameless", () => {
    expect(has(audit('<button>Save <svg role="img"></svg></button>'), "svg-element-error/svgMissingName")).toBe(false);
  });

  it("accepts canvas fallback content", () => {
    expect(has(audit("<canvas>Bar chart: sales rose 20%</canvas>"), "canvas-element-error/canvasMissingRoleImg")).toBe(false);
  });

  it("accepts figure with figcaption or aria-label", () => {
    const r = audit('<figure><img src="a.png" alt="A"><figcaption>Fig 1</figcaption></figure><figure aria-label="Fig 2"><img src="b.png" alt="B"></figure>');
    expect(findingsFor(r, "figure-element-error")).toEqual([]);
  });

  it("accepts a labelled embed/object", () => {
    const r = audit('<embed src="a.swf" type="application/x-shockwave-flash" title="Game"><object data="x.pdf" type="application/pdf">Report</object>');
    expect(findingsFor(r, "embed-element-error")).toEqual([]);
    expect(findingsFor(r, "object-element-error")).toEqual([]);
  });

  it("accepts a complete image map", () => {
    const r = audit('<img src="m.png" alt="Map" usemap="#m"><map name="m"><area href="/a" alt="North" shape="rect" coords="0,0,5,5"></map>');
    expect(findingsFor(r, "area-element-error")).toEqual([]);
    expect(findingsFor(r, "map-element-error")).toEqual([]);
  });
});
