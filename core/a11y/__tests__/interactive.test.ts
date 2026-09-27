import { describe, expect, it } from "vitest";
import { INTERACTIVE_RULES } from "../rules/interactive.js";
import { runA11yAudit } from "../engine.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules, load } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), INTERACTIVE_RULES.map((r) => r.id));

describe("interactive: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("links", () => {
  it("accepts descriptive links", () => {
    const r = audit('<a href="/about">About us</a>');
    expect(findingsFor(r, "a-element-error")).toEqual([]);
    expect(findingsFor(r, "a-element-warning")).toEqual([]);
  });

  it("uses the computed accessible name (aria-label wins over generic text)", () => {
    expect(has(audit('<a href="/p" aria-label="Read more about pricing">Read more</a>'), "a-element-warning/linkTextGenericClickHere")).toBe(false);
    expect(has(audit('<span id="t">Pricing details</span><a href="/p" aria-labelledby="t"></a>'), "a-element-error/linkAccessibleName")).toBe(false);
  });

  it("names a link from an image alt", () => {
    expect(has(audit('<a href="/"><img src="l.png" alt="Home"></a>'), "a-element-error/linkAccessibleName")).toBe(false);
  });

  it("ignores empty fragment targets", () => {
    expect(has(audit('<a id="top"></a>'), "a-element-error/linkMissingHrefAttribute")).toBe(false);
  });

  it("requires the skip link target to exist", () => {
    const ok = audit('<a href="#main">Skip to main content</a><main id="main">x</main>');
    expect(has(ok, "skip-link-warning/pageHaveSkipLink")).toBe(false);
    const broken = audit('<a href="#nowhere">Skip to main content</a><main>x</main>');
    expect(has(broken, "skip-link-warning/pageHaveSkipLink")).toBe(true);
  });
});

describe("buttons", () => {
  it("accepts a text button with a decorative hidden icon", () => {
    const r = audit('<button type="button"><svg aria-hidden="true" width="8" height="8"></svg> Save</button>');
    expect(findingsFor(r, "button-element-error")).toEqual([]);
  });

  it("skips content checks when aria-label names the button", () => {
    const r = audit('<button aria-label="Close"><svg width="8" height="8"></svg></button>');
    expect(findingsFor(r, "button-element-error")).toEqual([]);
  });

  it("checks role=button custom buttons too", () => {
    expect(has(audit('<div role="button" tabindex="0"></div>'), "button-element-error/buttonAccessibleName")).toBe(true);
  });

  it("names input buttons from value", () => {
    expect(has(audit('<input type="submit" value="Send">'), "button-element-error/buttonAccessibleName")).toBe(false);
  });
});

describe("click handlers", () => {
  it("accepts click + key handlers", () => {
    expect(has(audit('<div role="button" tabindex="0" onclick="void 0" onkeydown="void 0">Go</div>'), "click-handler-warning/onclickWithoutOnkeydownOnkeyup")).toBe(false);
  });

  it("sees React props attached to DOM nodes", () => {
    load("<div id=r>Row</div><div id=k>Key</div>");
    const noop = () => undefined;
    (document.getElementById("r") as unknown as Record<string, unknown>)["__reactProps$x1"] = { onClick: noop };
    (document.getElementById("k") as unknown as Record<string, unknown>)["__reactProps$x1"] = { onClick: noop, onKeyDown: noop };
    const r = runA11yAudit(document);
    const hits = findingsFor(r, "click-handler-warning", "onclickWithoutOnkeydownOnkeyup").map((f) => f.selector);
    expect(hits).toEqual(["#r"]);
  });

  it("sees addEventListener handlers via the optional listeners lookup", () => {
    load("<span id=s>Tap</span>");
    const r = runA11yAudit(document, { listeners: (el) => (el.id === "s" ? { click: [{}] } : {}) });
    expect(has(r, "click-handler-warning/onclickWithoutOnkeydownOnkeyup")).toBe(true);
  });

  it("pairs mouseover with focus", () => {
    expect(has(audit('<div onmouseover="void 0" onfocus="void 0">x</div>'), "click-handler-warning/mouseEventWithoutKeyboardEquivalent")).toBe(false);
  });
});

describe("focus", () => {
  it("keeps tabindex=0 on a link without href (it is needed)", () => {
    expect(has(audit('<a tabindex="0">x</a>'), "focus-element-error/unnecessaryTabindex")).toBe(false);
  });

  it("counts implicit roles as roles", () => {
    expect(has(audit('<main tabindex="-1">content</main>'), "focus-element-warning/elementTabindexButRole")).toBe(false);
  });

  it("allows non-focusable options managed by aria-activedescendant", () => {
    const r = audit('<div role="listbox" tabindex="0" aria-label="L" aria-activedescendant="o1"><div role="option" id="o1" aria-selected="true">A</div></div>');
    expect(has(r, "focus-element-warning/interactiveRoleNotFocusable")).toBe(false);
    expect(has(r, "focus-element-error/activedescendantNotFocusable")).toBe(false);
  });

  it("does not require focus on aria-disabled widgets", () => {
    expect(has(audit('<div role="button" aria-disabled="true">Go</div>'), "focus-element-warning/interactiveRoleNotFocusable")).toBe(false);
  });

  it("detects duplicate accesskeys case-insensitively, ignoring hidden ones", () => {
    expect(findingsFor(audit(TRIGGERS["accesskey-element-error/duplicateAccesskey"]), "accesskey-element-error")).toHaveLength(2);
    expect(findingsFor(audit('<button accesskey="s">A</button><div hidden><button accesskey="s">B</button></div>'), "accesskey-element-error")).toEqual([]);
  });

  it("sees React autoFocus", () => {
    load('<label>Q <input id=q name=q type=text></label>');
    (document.getElementById("q") as unknown as Record<string, unknown>)["__reactProps$z"] = { autoFocus: true };
    expect(has(runA11yAudit(document), "autofocus-element-warning/noAutofocus")).toBe(true);
  });
});
