import { describe, expect, it } from "vitest";
import { runA11yAudit } from "../engine.js";
import { DOCUMENT_RULES, isValidLang } from "../rules/document.js";
import { MEDIA_RULES } from "../rules/media.js";
import { TABLE_RULES } from "../rules/tables.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules, load } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), [...TABLE_RULES, ...MEDIA_RULES, ...DOCUMENT_RULES].map((r) => r.id));

describe("tables/media/document: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("tables", () => {
  it("accepts a well-formed data table", () => {
    const r = audit('<table><caption>Q3 sales</caption><thead><tr><th scope="col">Region</th><th scope="col">Total</th></tr></thead><tbody><tr><th scope="row">EU</th><td>4</td></tr></tbody></table>');
    expect(findingsFor(r, "table-element-error")).toEqual([]);
    expect(findingsFor(r, "scope-element-error")).toEqual([]);
  });

  it("holds layout tables only to the presentation warning", () => {
    const r = audit('<table role="presentation"><tr><th>x</th><td>y</td></tr></table>');
    expect(findingsFor(r, "table-element-error")).toEqual([]);
    expect(findingsFor(r, "scope-element-error")).toEqual([]);
    expect(has(r, "table-element-warning/tableRolePresentation")).toBe(true);
  });

  it("does not let a nested table's headers satisfy the outer table", () => {
    const r = audit('<table aria-label="Outer"><caption>O</caption><tr><td><table><caption>I</caption><tr><th scope="col">H</th></tr></table></td></tr></table>');
    expect(findingsFor(r, "table-element-error", "tableMissingTh")).toHaveLength(1);
  });

  it("accepts ARIA header roles as headers", () => {
    const r = audit('<table><caption>C</caption><tr><td role="columnheader">H</td></tr><tr><td>1</td></tr></table>');
    expect(has(r, "table-element-error/tableMissingHeaders")).toBe(false);
    expect(has(r, "table-element-error/tableMissingTh")).toBe(true);
  });
});

describe("media and frames", () => {
  it("accepts video with captions and descriptions", () => {
    const r = audit('<video src="v.mp4" controls><track kind="captions" src="c.vtt" srclang="en"><track kind="descriptions" src="d.vtt" srclang="en"></video>');
    expect(findingsFor(r, "media-element-error")).toEqual([]);
    expect(findingsFor(r, "media-element-warning")).toEqual([]);
  });

  it("treats a muted looping background video as decorative", () => {
    const r = audit('<video src="bg.mp4" autoplay muted loop playsinline></video>');
    expect(findingsFor(r, "media-element-error")).toEqual([]);
    expect(has(r, "media-element-warning/mediaElementAutoplay")).toBe(false);
  });

  it("accepts audio with a nearby transcript", () => {
    expect(has(audit('<div><audio src="a.mp3" controls></audio><a href="/t">Read the transcript</a></div>'), "media-element-error/audioElementMissingTranscript")).toBe(false);
  });

  it("names iframes via title or aria-label", () => {
    const r = audit('<iframe src="about:blank" title="Map"></iframe><iframe src="about:blank" aria-label="Video"></iframe>');
    expect(findingsFor(r, "iframe-element-error")).toEqual([]);
  });
});

describe("document", () => {
  it.each(["en", "en-US", "pt-BR", "zh-Hant-TW", "sr-Latn"])("accepts lang=%s", (l) => expect(isValidLang(l)).toBe(true));
  it.each(["english", "en_US", "e", "123"])("rejects lang=%s", (l) => expect(isValidLang(l)).toBe(false));

  it("parses meta refresh delay", () => {
    const r = audit({ body: "<p>x</p>", head: '<title>T</title><meta http-equiv="refresh" content="0; url=/next">' });
    expect(has(r, "meta-element-warning/metaRefreshDetected")).toBe(true);
    expect(has(r, "meta-element-warning/metaRefreshTimeout")).toBe(false);
  });

  it("ignores SVG <title> when looking for the page title", () => {
    const r = audit({ body: "<svg><title>Icon</title></svg>", head: "" });
    expect(has(r, "title-element-error/pageMissingTitleElement")).toBe(true);
  });

  it("runs page-level checks only when auditing the whole document", () => {
    load({ body: '<section id="s"><h2>x</h2></section>', head: "", lang: null });
    const r = runA11yAudit(document.getElementById("s"));
    for (const id of ["lang-element-error", "title-element-error", "landmark-element-error", "skip-link-warning"]) {
      expect(findingsFor(r, id)).toEqual([]);
    }
  });
});
