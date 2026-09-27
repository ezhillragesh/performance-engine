// Forms. Ported from a11yinspect: input-element-*, label-element-*, select-element-error,
// selected-element-warning, textarea-element-*, form-element-*, autocomplete-element-*,
// checked-element-error, required-element-warning, optgroup-element-error, output-element-error,
// meter-element-error, progress-element-error.
//
// Runtime accuracy: "has a label" is the computed accessible name (label[for], wrapping label,
// aria-labelledby, aria-label, title) — placeholder never counts. Field values are never read.
import { childByTag, closestTag, inputType, normalizeSpace } from "../dom.js";
import { ariaTrue, hasText, type Rule, type RuleContext } from "../rule.js";

const BUTTON_TYPES = new Set(["submit", "button", "reset"]);
const NO_AUTOCOMPLETE_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "image", "file", "range", "color"]);
const PERSONAL_NAME_TOKENS = ["email", "tel", "url", "password", "name", "street-address", "postal-code", "cc-number", "cc-exp", "cc-csc"];
/** Runtime addition: these input types always collect personal data. */
const PERSONAL_TYPES = new Set(["email", "tel", "password"]);

const AUTOCOMPLETE_FIELDS = new Set([
  "name", "honorific-prefix", "given-name", "additional-name", "family-name",
  "honorific-suffix", "nickname", "email", "username", "new-password",
  "current-password", "organization-title", "organization", "street-address",
  "address-line1", "address-line2", "address-line3", "address-level4",
  "address-level3", "address-level2", "address-level1", "country", "country-name",
  "postal-code", "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name",
  "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type",
  "transaction-currency", "transaction-amount", "language", "bday", "bday-day",
  "bday-month", "bday-year", "sex", "tel", "tel-country-code", "tel-national",
  "tel-area-code", "tel-local", "tel-extension", "url", "photo",
  // Runtime addition (HTML spec tokens missing from the source list):
  "one-time-code", "impp", "tel-local-prefix", "tel-local-suffix",
]);

/** Validates a full autocomplete detail-token list per the HTML spec grammar. */
export function isValidAutocomplete(value: string): boolean {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1 && (tokens[0] === "on" || tokens[0] === "off")) return true;
  let i = 0;
  if (tokens[i]?.startsWith("section-")) i++;
  if (tokens[i] === "shipping" || tokens[i] === "billing") i++;
  if (tokens[i] === "home" || tokens[i] === "work" || tokens[i] === "mobile" || tokens[i] === "fax" || tokens[i] === "pager") i++;
  if (!AUTOCOMPLETE_FIELDS.has(tokens[i] ?? "")) return false;
  i++;
  if (tokens[i] === "webauthn") i++;
  return i === tokens.length;
}

function labelled(el: Element, ctx: RuleContext): boolean {
  return ctx.dom.accessibleName(el) !== "";
}

export const inputElementError: Rule = {
  id: "input-element-error",
  tags: ["input"],
  visit(el, a, ctx) {
    const t = inputType(el);
    if (t === "hidden") return;
    if (a["type"] === undefined) ctx.report(el, "inputMissingTypeAttribute");
    if (t === "image" && !hasText(a["alt"])) ctx.report(el, "inputTypeImageMissingAlt");
    if (a["name"] === undefined && !BUTTON_TYPES.has(t)) ctx.report(el, "inputMissingNameAttribute");
    if (!BUTTON_TYPES.has(t) && t !== "image" && !labelled(el, ctx)) ctx.report(el, "inputMissingAssociatedLabel");
  },
};

export const inputElementWarning: Rule = {
  id: "input-element-warning",
  tags: ["input"],
  visit(el, a, ctx) {
    const t = inputType(el);
    if (t === "hidden" || BUTTON_TYPES.has(t) || t === "image") return;
    if (a["placeholder"] !== undefined && !labelled(el, ctx)) ctx.report(el, "inputPlaceholderLabelSubstitute");
  },
};

const LABELABLE = "input:not([type=hidden]), select, textarea, button, meter, output, progress";

export const labelElementError: Rule = {
  id: "label-element-error",
  tags: ["label"],
  visit(el, a, ctx) {
    let control: Element | null | undefined;
    try {
      control = (el as HTMLLabelElement).control;
    } catch {
      control = undefined;
    }
    if (control === undefined) {
      const f = a["for"];
      control = f !== undefined ? ctx.doc.getElementById(f) : el.querySelector(LABELABLE);
    }
    // Runtime: also catches for="..." pointing at an id that does not exist.
    if (!control) ctx.report(el, "labelMissingAttribute", a["for"] !== undefined ? { detail: "for= does not match a labelable element" } : undefined);
    if (!ctx.dom.textFromContent(el)) ctx.report(el, "labelTextContent");
  },
};

/** label-element-warning.js defines no checks; registered so rule ids stay 1:1 with the source. */
export const labelElementWarning: Rule = {
  id: "label-element-warning",
  tags: ["label"],
};

export const selectElementError: Rule = {
  id: "select-element-error",
  tags: ["select"],
  visit(el, a, ctx) {
    if (!labelled(el, ctx)) ctx.report(el, "selectMissingAssociatedLabel");
    if (a["name"] === undefined) ctx.report(el, "selectMissingNameAttribute");
    if (el.getElementsByTagName("option").length === 0) ctx.report(el, "selectOptions");
  },
};

export const selectedElementWarning: Rule = {
  id: "selected-element-warning",
  visit(el, a, ctx) {
    if (el.localName === "option" && a["value"] === undefined) {
      const host = closestTag(el, "select");
      // Options have no box of their own; use the <select>'s visibility (datalist options: always).
      ctx.report(el, "optionElementHaveValueAttribute", host ? { visibilityOf: host } : { scope: "all" });
    }
    const sel = a["aria-selected"];
    if (sel !== undefined) {
      const v = sel.trim().toLowerCase();
      if (v !== "true" && v !== "false") ctx.report(el, "ariaSelectedTrueFalse");
    }
  },
};

export const textareaElementError: Rule = {
  id: "textarea-element-error",
  tags: ["textarea"],
  visit(el, a, ctx) {
    if (!labelled(el, ctx)) ctx.report(el, "textareaMissingAssociatedLabel");
    if (a["name"] === undefined) ctx.report(el, "textareaMissingNameAttribute");
  },
};

export const textareaElementWarning: Rule = {
  id: "textarea-element-warning",
  tags: ["textarea"],
  visit(el, a, ctx) {
    if (a["placeholder"] !== undefined && !labelled(el, ctx)) ctx.report(el, "textareaPlaceholderLabelSubstitute");
  },
};

export const formElementError: Rule = {
  id: "form-element-error",
  tags: ["form", "fieldset"],
  visit(el, a, ctx) {
    if (el.localName === "form") {
      if (!ctx.dom.ariaName(el) && !hasText(a["title"]) && a["name"] === undefined) ctx.report(el, "formMissingAccessibleName");
      return;
    }
    if (!childByTag(el, "legend") && !ctx.dom.ariaName(el)) ctx.report(el, "fieldsetMissingLegend");
  },
};

function formHasSubmit(form: Element): boolean {
  const els = (form as HTMLFormElement).elements;
  if (els && typeof els.length === "number") {
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const tag = e.localName;
      const type = tag === "button" ? (e.getAttribute("type") || "submit").trim().toLowerCase() : inputType(e);
      if ((tag === "button" && type === "submit") || (tag === "input" && (type === "submit" || type === "image"))) return true;
    }
    return false;
  }
  return !!form.querySelector("button:not([type]), button[type=submit], input[type=submit], input[type=image]");
}

export const formElementWarning: Rule = {
  id: "form-element-warning",
  tags: ["form"],
  visit(el, _a, ctx) {
    // Runtime: form.elements also sees buttons associated from outside via form="id".
    if (!formHasSubmit(el)) ctx.report(el, "formHaveSubmitButton");
  },
};

export const autocompleteElementError: Rule = {
  id: "autocomplete-element-error",
  tags: ["input", "select", "textarea"],
  visit(el, a, ctx) {
    const ac = a["autocomplete"];
    if (ac === undefined) return;
    if (el.localName === "input" && NO_AUTOCOMPLETE_TYPES.has(inputType(el))) return;
    if (!isValidAutocomplete(ac)) ctx.report(el, "invalidAutocompleteValue", { detail: `autocomplete="${ac.trim().slice(0, 40)}"` });
  },
};

export const autocompleteElementWarning: Rule = {
  id: "autocomplete-element-warning",
  tags: ["input"],
  visit(el, a, ctx) {
    const t = inputType(el);
    if (NO_AUTOCOMPLETE_TYPES.has(t) || a["autocomplete"] !== undefined) return;
    const name = (a["name"] || "").toLowerCase();
    const personal = (name && PERSONAL_NAME_TOKENS.some((p) => name.includes(p))) || PERSONAL_TYPES.has(t);
    if (personal) ctx.report(el, "inputHaveAutocompleteAttribute");
  },
};

export const checkedElementError: Rule = {
  id: "checked-element-error",
  tags: ["input"],
  visit(el, a, ctx) {
    const t = (a["type"] || "").trim().toLowerCase();
    if ((t === "checkbox" || t === "radio") && a["name"] === undefined) ctx.report(el, "checkboxRadioMissingNameAttribute");
  },
};

function visibleLabelText(el: Element, ctx: RuleContext): string {
  const parts: string[] = [];
  for (const l of ctx.dom.labelsOf(el)) parts.push(ctx.dom.textFromContent(l));
  const ref = el.getAttribute("aria-labelledby");
  if (ref) parts.push(ctx.dom.labelledByText(ref));
  return normalizeSpace(parts.join(" "));
}

export const requiredElementWarning: Rule = {
  id: "required-element-warning",
  tags: ["input", "select", "textarea"],
  visit(el, a, ctx) {
    if (el.localName === "input" && inputType(el) === "hidden") return;
    if (a["required"] === undefined && !ariaTrue(a["aria-required"])) return;
    // Runtime refinement: a visible "*" / "required" in the field's visible label is the indicator.
    if (/\*|\brequired\b|\bmandatory\b/i.test(visibleLabelText(el, ctx))) return;
    ctx.report(el, "requiredFieldHaveVisualIndicator");
  },
};

export const optgroupElementError: Rule = {
  id: "optgroup-element-error",
  tags: ["optgroup"],
  visit(el, a, ctx) {
    const host = closestTag(el, "select");
    const opts = host ? { visibilityOf: host } : { scope: "all" as const };
    const label = a["label"];
    if (label === undefined) ctx.report(el, "optgroupMissingLabelAttribute", opts);
    else if (!label.trim()) ctx.report(el, "optgroupEmptyLabel", opts);
  },
};

export const outputElementError: Rule = {
  id: "output-element-error",
  tags: ["output"],
  visit(el, a, ctx) {
    if (!labelled(el, ctx) && a["name"] === undefined) ctx.report(el, "outputMissingAccessibleName");
  },
};

export const meterElementError: Rule = {
  id: "meter-element-error",
  tags: ["meter"],
  visit(el, a, ctx) {
    if (!labelled(el, ctx) && !normalizeSpace(el.textContent || "")) ctx.report(el, "meterMissingAccessibleName");
    if (a["min"] === undefined || a["max"] === undefined) ctx.report(el, "meterMissingMinMaxAttributes");
  },
};

export const progressElementError: Rule = {
  id: "progress-element-error",
  tags: ["progress"],
  visit(el, a, ctx) {
    if (!labelled(el, ctx)) ctx.report(el, "progressMissingAccessibleName");
    const max = a["max"];
    if (max === undefined) ctx.report(el, "progressMissingMax");
    else if (!max.trim()) ctx.report(el, "progressEmptyMax");
  },
};

export const FORM_RULES: readonly Rule[] = [
  inputElementError, inputElementWarning, labelElementError, labelElementWarning, selectElementError,
  selectedElementWarning, textareaElementError, textareaElementWarning, formElementError, formElementWarning,
  autocompleteElementError, autocompleteElementWarning, checkedElementError, requiredElementWarning,
  optgroupElementError, outputElementError, meterElementError, progressElementError,
];
