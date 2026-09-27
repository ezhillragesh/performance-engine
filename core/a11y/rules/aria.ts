// ARIA attributes, roles and widgets. Ported from a11yinspect: aria-element-*, checked-element-warning,
// description-element-*, expanded-element-warning, live-region-error, orientation-element-error,
// pressed-element-warning, role-props-element-*, slider-element-warning, tab-element-warning,
// menu-element-*, dialog-element-*.
import {
  ALLOWED_INTERACTIVE_ROLE_ON,
  GLOBAL_ARIA_PROPS,
  INTERACTIVE_ROLES,
  NONINTERACTIVE_ELEMENTS,
  NONINTERACTIVE_ROLES,
  ROLE_REQUIRED_PROPS,
  ROLE_SUPPORTED_PROPS,
  ROLE_TO_SEMANTIC_ELEMENT,
  VALID_ARIA_PROPS,
  VALID_ROLES,
  isValidAriaValue,
} from "../aria-data.js";
import { effectiveTabIndex, explicitRole, findDescendant, hasRoleToken, implicitRole, inputType, isFocusableStructural } from "../dom.js";
import { ariaTrue, hasText, type Rule, type RuleContext } from "../rule.js";

const FOCUS_CANDIDATE_TAGS = new Set(["a", "area", "button", "input", "select", "textarea", "iframe", "summary", "audio", "video"]);

function lower(v: string): string {
  return v.trim().toLowerCase();
}

function isInteractiveElement(el: Element): boolean {
  switch (el.localName) {
    case "a":
      return el.hasAttribute("href");
    case "button":
    case "select":
    case "textarea":
      return true;
    case "input":
      return inputType(el) !== "hidden";
    default:
      return false;
  }
}

export const ariaElementError: Rule = {
  id: "aria-element-error",
  visit(el, a, ctx) {
    for (const name in a) {
      if (name.startsWith("aria-") && !VALID_ARIA_PROPS.has(name)) ctx.report(el, "ariaInvalidProp", { detail: name });
    }
    const label = a["aria-label"];
    if (label !== undefined && !label.trim()) ctx.report(el, "emptyAriaLabelAttribute");
    const role = a["role"];
    if (role !== undefined && role.trim()) {
      // Runtime: role is a fallback list; it is only invalid when no token is a valid role.
      const tokens = lower(role).split(/\s+/);
      if (!tokens.some((t) => VALID_ROLES.has(t))) ctx.report(el, "invalidAriaRole", { detail: `role="${role.trim().slice(0, 40)}"` });
    }
  },
};

function nameForImplicit(el: Element, ctx: RuleContext): () => boolean {
  return () => !!ctx.dom.ariaName(el) || hasText(el.getAttribute("title"));
}

export const ariaElementWarning: Rule = {
  id: "aria-element-warning",
  visit(el, a, ctx) {
    for (const name in a) {
      if (name.startsWith("aria-") && VALID_ARIA_PROPS.has(name) && !isValidAriaValue(name, a[name])) {
        ctx.report(el, "ariaInvalidPropValue", { detail: name });
      }
    }
    if (a["role"] !== undefined) {
      const role = explicitRole(el);
      if (role) {
        const tag = el.localName;
        const implicit = implicitRole(el, nameForImplicit(el, ctx));
        if (implicit === role) ctx.report(el, "ariaRoleRedundant", { detail: `<${tag}> is already role="${role}"` });
        const generic = tag === "div" || tag === "span";
        if (generic && ROLE_TO_SEMANTIC_ELEMENT[role]) ctx.report(el, "preferSemanticElement", { detail: `use ${ROLE_TO_SEMANTIC_ELEMENT[role]}` });
        if (!generic && NONINTERACTIVE_ELEMENTS.has(tag) && INTERACTIVE_ROLES.has(role) && !(ALLOWED_INTERACTIVE_ROLE_ON[tag] || []).includes(role)) {
          ctx.report(el, "noninteractiveElementInteractiveRole");
        }
        if (isInteractiveElement(el) && NONINTERACTIVE_ROLES.has(role) && role !== "presentation" && role !== "none") {
          ctx.report(el, "interactiveElementNoninteractiveRole");
        }
      }
    }
    // Runtime: any keyboard-reachable element inside an aria-hidden subtree (not just the element's own attribute).
    const candidate = a["tabindex"] !== undefined || a["contenteditable"] !== undefined || FOCUS_CANDIDATE_TAGS.has(el.localName);
    if (candidate && ctx.dom.ariaHidden(el) && isFocusableStructural(el) && effectiveTabIndex(el) >= 0 && !ctx.dom.inert(el)) {
      ctx.report(el, "ariaHiddenFocusableElement", { scope: "rendered" });
    }
  },
};

function tokenCheck(ruleId: string, attr: string, check: string, allowed: readonly string[]): Rule {
  return {
    id: ruleId,
    visit(el, a, ctx) {
      const v = a[attr];
      if (v !== undefined && !allowed.includes(lower(v))) ctx.report(el, check, { detail: attr });
    },
  };
}

export const checkedElementWarning = tokenCheck("checked-element-warning", "aria-checked", "ariaCheckedTrueFalseMixed", ["true", "false", "mixed"]);
export const pressedElementWarning = tokenCheck("pressed-element-warning", "aria-pressed", "ariaPressedTrueFalseMixed", ["true", "false", "mixed"]);

export const descriptionElementError: Rule = {
  id: "description-element-error",
  visit(el, a, ctx) {
    const d = a["aria-description"];
    if (d !== undefined && !d.trim()) ctx.report(el, "ariaDescriptionEmpty");
  },
};

function missingIds(ctx: RuleContext, value: string): string[] {
  const out: string[] = [];
  for (const id of value.trim().split(/\s+/)) if (id && !ctx.doc.getElementById(id)) out.push(id);
  return out;
}

function idDetail(ids: string[]): string {
  return `missing id${ids.length > 1 ? "s" : ""}: ${ids.slice(0, 3).map((i) => `"${i.slice(0, 40)}"`).join(", ")}`;
}

export const descriptionElementWarning: Rule = {
  id: "description-element-warning",
  visit(el, a, ctx) {
    const ref = a["aria-describedby"];
    if (ref === undefined) return;
    if (!ref.trim()) return ctx.report(el, "elementAriaDescribedbyReferencesNon", { detail: "empty aria-describedby" });
    // Runtime: resolve every referenced id against the live document.
    const missing = missingIds(ctx, ref);
    if (missing.length) ctx.report(el, "elementAriaDescribedbyReferencesNon", { detail: idDetail(missing) });
  },
};

export const expandedElementWarning: Rule = {
  id: "expanded-element-warning",
  visit(el, a, ctx) {
    const ex = a["aria-expanded"];
    if (ex !== undefined) {
      const v = lower(ex);
      if (v !== "true" && v !== "false") ctx.report(el, "ariaExpandedTrueFalse");
    }
    const ctl = a["aria-controls"];
    if (ctl === undefined) return;
    if (!ctl.trim()) return ctx.report(el, "ariaControlsReferencesNonExistent", { detail: "empty aria-controls" });
    // Runtime refinement: collapsed disclosure triggers often point at popups that are only rendered when open.
    if (ex !== undefined && lower(ex) === "false") return;
    const missing = missingIds(ctx, ctl);
    if (missing.length) ctx.report(el, "ariaControlsReferencesNonExistent", { detail: idDetail(missing) });
  },
};

export const liveRegionError: Rule = {
  id: "live-region-error",
  visit(el, a, ctx) {
    const live = a["aria-live"];
    if (live === undefined) return;
    const v = lower(live);
    if (!v) return;
    if (v !== "off" && v !== "polite" && v !== "assertive") ctx.report(el, "invalidAriaLiveValue");
    if (v !== "off" && a["aria-atomic"] === undefined) ctx.report(el, "ariaLiveRegionMissingAria");
  },
};

export const orientationElementError: Rule = {
  id: "orientation-element-error",
  visit(el, a, ctx) {
    const o = a["aria-orientation"];
    if (o === undefined) return;
    const v = lower(o);
    if (v && v !== "horizontal" && v !== "vertical") ctx.report(el, "invalidAriaOrientationValue");
  },
};

/** Native elements that already expose the state a role would otherwise require. */
function nativelyProvides(el: Element, role: string): boolean {
  const tag = el.localName;
  if (tag === "input") {
    const t = inputType(el);
    if ((role === "checkbox" || role === "radio" || role === "switch") && (t === "checkbox" || t === "radio")) return true;
    if ((role === "slider" && t === "range") || (role === "spinbutton" && t === "number")) return true;
  }
  if (role === "heading" && /^h[1-6]$/.test(tag)) return true;
  if (role === "meter" && tag === "meter") return true;
  if (role === "option" && tag === "option") return true;
  if (role === "combobox" && tag === "select") return true;
  return false;
}

export const rolePropsElementError: Rule = {
  id: "role-props-element-error",
  visit(el, a, ctx) {
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    if (!role) return;
    const req = ROLE_REQUIRED_PROPS[role];
    if (!req || req.length === 0 || nativelyProvides(el, role)) return;
    const missing = req.filter((p) => a[p] === undefined);
    if (missing.length) ctx.report(el, "roleMissingRequiredProp", { detail: `role="${role}" needs ${missing.join(", ")}` });
  },
};

const SUPPORTED_SETS = new Map<string, ReadonlySet<string>>();
for (const role of Object.keys(ROLE_SUPPORTED_PROPS)) SUPPORTED_SETS.set(role, new Set([...ROLE_SUPPORTED_PROPS[role], ...GLOBAL_ARIA_PROPS]));

export const rolePropsElementWarning: Rule = {
  id: "role-props-element-warning",
  visit(el, a, ctx) {
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    const supported = role ? SUPPORTED_SETS.get(role) : undefined;
    if (!supported) return;
    for (const name in a) {
      if (name.startsWith("aria-") && !supported.has(name)) ctx.report(el, "roleUnsupportedProp", { detail: `${name} on role="${role}"` });
    }
  },
};

const RANGE_ROLES = new Set(["slider", "scrollbar", "spinbutton", "progressbar"]);

export const sliderElementWarning: Rule = {
  id: "slider-element-warning",
  visit(el, a, ctx) {
    const tag = el.localName;
    const isRange = tag === "input" && inputType(el) === "range";
    if (isRange) {
      if (!hasText(a["min"])) ctx.report(el, "rangeMissingMin");
      if (!hasText(a["max"])) ctx.report(el, "rangeMissingMax");
    }
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    if (!role || !RANGE_ROLES.has(role)) return;
    if (role === "progressbar" && tag === "progress") return;
    if (role === "slider") {
      const al = a["aria-label"];
      if (al !== undefined && !al.trim()) ctx.report(el, "sliderEmptyAriaLabel");
      else ctx.report(el, ctx.dom.accessibleName(el) ? "sliderHasName" : "sliderMissingName");
      if (!isRange && !(isFocusableStructural(el) && effectiveTabIndex(el) >= 0)) ctx.report(el, "sliderMissingTabindex");
    }
    // Runtime refinement: native range/number inputs expose min/max themselves.
    if (tag === "input" && (inputType(el) === "range" || inputType(el) === "number")) return;
    for (const which of ["min", "max"] as const) {
      const v = a[`aria-value${which}`];
      const suffix = which === "min" ? "Valuemin" : "Valuemax";
      if (v === undefined) ctx.report(el, `${role}Missing${suffix}`);
      else if (!v.trim()) ctx.report(el, `${role}Empty${suffix}`);
    }
  },
};

export const tabElementWarning: Rule = {
  id: "tab-element-warning",
  visit(el, a, ctx) {
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    if (role === "tab") {
      if (!hasText(a["aria-controls"])) ctx.report(el, "tabMissingAriaControls");
    } else if (role === "tabpanel") {
      if (!ctx.dom.ariaName(el)) ctx.report(el, "tabpanelMissingAccessibleName");
    } else if (role === "tablist") {
      if (!ctx.dom.ariaName(el)) ctx.report(el, "tablistMissingAccessibleName");
    }
  },
};

export const menuElementError: Rule = {
  id: "menu-element-error",
  visit(el, a, ctx) {
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    if (role === "menubar") {
      if (!ctx.dom.ariaName(el)) ctx.report(el, "menubarMissingAccessibleName");
    } else if (role === "menuitemradio") {
      // Runtime: menu items take their name from content too, not only aria-label.
      if (!ctx.dom.accessibleName(el)) ctx.report(el, "menuItemRadioMissingAccessibleName");
      if (a["aria-checked"] === undefined) ctx.report(el, "menuItemRadioMissingAriaChecked");
    } else if (role === "menuitemcheckbox") {
      if (!ctx.dom.accessibleName(el)) ctx.report(el, "menuItemCheckboxMissingAccessibleName");
      if (a["aria-checked"] === undefined) ctx.report(el, "menuItemCheckboxMissingAriaChecked");
    }
  },
};

export const menuElementWarning: Rule = {
  id: "menu-element-warning",
  visit(el, a, ctx) {
    // Runtime refinement: only role="menu". The HTML <menu> element is a plain list (implicit role "list").
    if (a["role"] === undefined || explicitRole(el) !== "menu") return;
    if (!ctx.dom.ariaName(el)) ctx.report(el, "menuMissingAccessibleName");
    const isItem = (e: Element) => hasRoleToken(e, "menuitem") || hasRoleToken(e, "menuitemcheckbox") || hasRoleToken(e, "menuitemradio");
    if (!findDescendant(el, isItem)) ctx.report(el, "menuContainMenuitemElements");
  },
};

function isDialog(el: Element, a: Readonly<Record<string, string>>): boolean {
  if (el.localName === "dialog") return true;
  if (a["role"] === undefined) return false;
  const r = explicitRole(el);
  return r === "dialog" || r === "alertdialog";
}

export const dialogElementError: Rule = {
  id: "dialog-element-error",
  visit(el, a, ctx) {
    if (!isDialog(el, a)) return;
    if (!ctx.dom.ariaName(el) && !hasText(a["title"])) ctx.report(el, "dialogMissingAccessibleName");
  },
};

function isNativeModal(el: Element): boolean {
  try {
    return el.localName === "dialog" && el.matches(":modal");
  } catch {
    return false;
  }
}

export const dialogElementWarning: Rule = {
  id: "dialog-element-warning",
  scope: "rendered",
  visit(el, a, ctx) {
    if (!isDialog(el, a)) return;
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "dialogAriaHidden");
    const r = a["role"] !== undefined ? explicitRole(el) : null;
    if ((r === "dialog" || r === "alertdialog") && ariaTrue(a["aria-modal"]) && !isNativeModal(el)) {
      if (ctx.excluded(el, "visible")) return;
      // Runtime: an open modal must hold focus. Report when focus is currently outside it.
      const active = ctx.doc.activeElement;
      if (!active || !el.contains(active)) ctx.report(el, "modalDialogTrapFocus", { detail: "focus is outside the open modal" });
    }
  },
};

export const ARIA_RULES: readonly Rule[] = [
  ariaElementError, ariaElementWarning, checkedElementWarning, descriptionElementError, descriptionElementWarning,
  expandedElementWarning, liveRegionError, orientationElementError, pressedElementWarning, rolePropsElementError,
  rolePropsElementWarning, sliderElementWarning, tabElementWarning, menuElementError, menuElementWarning,
  dialogElementError, dialogElementWarning,
];
