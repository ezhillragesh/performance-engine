import { describe, expect, it } from "vitest";
import { FORM_RULES, isValidAutocomplete } from "../rules/forms.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, findingsFor, has, idsForRules } from "./helpers.js";

const ids = idsForRules(Object.keys(TRIGGERS), FORM_RULES.map((r) => r.id));

describe("forms: positives", () => {
  for (const id of ids) it(`reports ${id}`, () => expect(has(audit(TRIGGERS[id]), id)).toBe(true));
});

describe("labels (computed accessible name)", () => {
  it.each([
    ["label[for]", '<label for="n">Name</label><input id="n" name="n" type="text">'],
    ["wrapping label", '<label>Name <input name="n" type="text"></label>'],
    ["aria-labelledby", '<span id="l">Name</span><input aria-labelledby="l" name="n" type="text">'],
    ["aria-label", '<input aria-label="Name" name="n" type="text">'],
    ["title", '<input title="Name" name="n" type="text">'],
  ])("accepts %s", (_n, html) => {
    const r = audit(html);
    expect(has(r, "input-element-error/inputMissingAssociatedLabel")).toBe(false);
  });

  it("never treats placeholder as a label", () => {
    const r = audit('<input type="text" name="q" placeholder="Search">');
    expect(has(r, "input-element-error/inputMissingAssociatedLabel")).toBe(true);
    expect(has(r, "input-element-warning/inputPlaceholderLabelSubstitute")).toBe(true);
  });

  it("does not warn about placeholder when a label exists", () => {
    expect(has(audit('<label>Search <input type="text" name="q" placeholder="e.g. shoes"></label>'), "input-element-warning/inputPlaceholderLabelSubstitute")).toBe(false);
  });

  it("flags label[for] pointing at a missing id", () => {
    const f = findingsFor(audit('<label for="ghost">Name</label>'), "label-element-error", "labelMissingAttribute");
    expect(f).toHaveLength(1);
    expect(f[0].detail).toMatch(/for=/);
  });

  it("labels selects and textareas", () => {
    const r = audit('<label>Size <select name="s"><option value="m">M</option></select></label><label>Note <textarea name="t"></textarea></label>');
    expect(findingsFor(r, "select-element-error")).toEqual([]);
    expect(findingsFor(r, "textarea-element-error")).toEqual([]);
  });
});

describe("form structure", () => {
  it("finds submit buttons associated from outside the form", () => {
    const r = audit('<form id="f" aria-label="Search"><label>Q <input name="q" type="text"></label></form><button form="f" type="submit">Go</button>');
    expect(has(r, "form-element-warning/formHaveSubmitButton")).toBe(false);
  });

  it("accepts a fieldset with a legend", () => {
    expect(has(audit('<fieldset><legend>Size</legend><label><input type="radio" name="s"> M</label></fieldset>'), "form-element-error/fieldsetMissingLegend")).toBe(false);
  });

  it("accepts a visible required indicator in the label", () => {
    expect(has(audit('<label>Email * <input type="email" name="email" autocomplete="email" required></label>'), "required-element-warning/requiredFieldHaveVisualIndicator")).toBe(false);
    expect(has(audit('<label>Email (required) <input type="email" name="email" autocomplete="email" aria-required="true"></label>'), "required-element-warning/requiredFieldHaveVisualIndicator")).toBe(false);
  });
});

describe("autocomplete grammar", () => {
  it.each(["email", "shipping street-address", "section-a billing postal-code", "work tel", "one-time-code", "username webauthn", "off", "on"])("accepts %s", (v) => {
    expect(isValidAutocomplete(v)).toBe(true);
  });
  it.each(["mail", "email foo", "billing", "home name name"])("rejects %s", (v) => {
    expect(isValidAutocomplete(v)).toBe(false);
  });
});
