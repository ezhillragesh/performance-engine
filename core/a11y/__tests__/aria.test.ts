import { describe, expect, it } from "vitest";
import { isValidAriaValue } from "../aria-data.js";
import { runA11yAudit } from "../engine.js";
import { ARIA_RULES } from "../rules/aria.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules, load } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), ARIA_RULES.map((r) => r.id));

describe("aria: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("aria: runtime accuracy", () => {
  it("accepts role fallback lists and ARIA 1.2 roles", () => {
    const r = audit('<div role="switch checkbox" aria-checked="false" tabindex="0">Wi-Fi</div><div role="table" aria-label="T"><div role="row"><div role="cell">1</div></div></div>');
    expect(has(r, "aria-element-error/invalidAriaRole")).toBe(false);
  });

  it("aggregates several invalid aria-* attributes on one element", () => {
    const f = findingsFor(audit('<div aria-foo="1" aria-bar="2">x</div>'), "aria-element-error", "ariaInvalidProp");
    expect(f).toHaveLength(1);
    expect(f[0].count).toBe(2);
    expect(f[0].detail).toContain("aria-foo");
  });

  it("validates aria-relevant token lists", () => {
    expect(isValidAriaValue("aria-relevant", "additions text")).toBe(true);
    expect(isValidAriaValue("aria-relevant", "removals additions")).toBe(true);
    expect(isValidAriaValue("aria-relevant", "everything")).toBe(false);
  });

  it("allows composite-widget roles on list items", () => {
    const r = audit('<ul role="tablist" aria-label="T"><li role="tab" tabindex="0" aria-selected="true" aria-controls="p">A</li></ul><div id="p" role="tabpanel" aria-label="A">x</div>');
    expect(has(r, "aria-element-warning/noninteractiveElementInteractiveRole")).toBe(false);
  });

  it("uses native state before requiring ARIA props", () => {
    expect(has(audit('<label><input type="checkbox" role="switch" name="w"> Wi-Fi</label>'), "role-props-element-error/roleMissingRequiredProp")).toBe(false);
  });

  it("treats aria-current as a global property", () => {
    expect(has(audit('<a href="/" role="link" aria-current="page">Home</a>'), "role-props-element-warning/roleUnsupportedProp")).toBe(false);
  });

  it("resolves aria-describedby against the live document", () => {
    expect(has(audit('<p id="hint">Hint</p><button aria-describedby="hint">Go</button>'), "description-element-warning/elementAriaDescribedbyReferencesNon")).toBe(false);
  });

  it("allows collapsed triggers to reference not-yet-rendered popups", () => {
    expect(has(audit('<button aria-expanded="false" aria-controls="menu-1">Menu</button>'), "expanded-element-warning/ariaControlsReferencesNonExistent")).toBe(false);
  });

  it("reports focusable descendants of aria-hidden, but not inert ones", () => {
    const r = audit('<div aria-hidden="true"><a href="/x">x</a></div><div aria-hidden="true" inert><button>y</button></div>');
    expect(findingsFor(r, "aria-element-warning", "ariaHiddenFocusableElement").map((f) => f.snippet)).toEqual(['<a href="/x">']);
  });

  it("does not flag an aria-hidden element that is out of the tab order", () => {
    expect(has(audit('<div aria-hidden="true"><button tabindex="-1">x</button></div>'), "aria-element-warning/ariaHiddenFocusableElement")).toBe(false);
  });

  it("treats <menu> as a list, not an ARIA menu", () => {
    const r = audit("<menu><li>Copy</li><li>Paste</li></menu>");
    expect(findingsFor(r, "menu-element-warning")).toEqual([]);
  });

  it("does not report modal focus when focus is inside the dialog", () => {
    load('<div role="dialog" aria-modal="true" aria-label="Settings"><button id="close">Close</button></div>');
    (document.getElementById("close") as HTMLButtonElement).focus();
    expect(has(runA11yAudit(document), "dialog-element-warning/modalDialogTrapFocus")).toBe(false);
  });

  it("names menu items from content", () => {
    expect(has(audit('<div role="menu" aria-label="Fmt"><div role="menuitemcheckbox" aria-checked="true" tabindex="-1">Bold</div></div>'), "menu-element-error/menuItemCheckboxMissingAccessibleName")).toBe(false);
  });

  it("does not require aria-valuemin/max on native range inputs with role=slider", () => {
    const r = audit('<label>Vol <input type="range" role="slider" name="v" min="0" max="10"></label>');
    expect(has(r, "slider-element-warning/sliderMissingValuemin")).toBe(false);
    expect(has(r, "slider-element-warning/sliderMissingTabindex")).toBe(false);
  });
});
