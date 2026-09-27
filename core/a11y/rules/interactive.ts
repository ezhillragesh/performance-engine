// Links, buttons, keyboard & focus. Ported from a11yinspect: a-element-*, skip-link-warning,
// button-element-*, click-handler-warning, accesskey-element-error, autofocus-element-warning,
// focus-element-*, disabled-element-warning.
import { INTERACTIVE_ROLES } from "../aria-data.js";
import { closestTag, closestWithAttr, descendantsByTag, explicitRole, implicitRole, isFocusableStructural, isNativelyFocusable, normalizeSpace, rawRole, tabindexAttr } from "../dom.js";
import { ariaTrue, type Rule, type RuleContext } from "../rule.js";

const GENERIC_LINK_TEXT = /^(click here|here|link|read more|more|continue|next|previous|back|download)$/i;
const GENERIC_BUTTON_TEXT = /^(click|submit|ok|yes|no)$/i;
const GENERIC_GRAPHIC_LABELS = new Set(["image", "graphic", "picture", "photo", "icon", "img", "svg", "button", "click", "submit", "spacer"]);

/**
 * Props React attached to a DOM node (`__reactProps$*`, React 17+; `__reactEventHandlers$*`, React 16).
 * Lets the runtime port see JSX handlers such as onClick / autoFocus exactly like the static rules do.
 */
export function frameworkProps(el: Element): Record<string, unknown> | null {
  const keys = Object.keys(el);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.startsWith("__reactProps$") || k.startsWith("__reactEventHandlers$")) {
      const v = (el as unknown as Record<string, unknown>)[k];
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    }
  }
  return null;
}

function isOuterSvg(el: Element): boolean {
  const p = el.parentElement;
  return !p || closestTag(p, "svg") === null;
}

function svgHasOwnName(el: Element, ctx: RuleContext): boolean {
  if (ctx.dom.ariaName(el)) return true;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === "title" && normalizeSpace(c.textContent || "")) return true;
  return false;
}

function decorativeRole(el: Element): boolean {
  const r = rawRole(el);
  return r === "presentation" || r === "none";
}

// ── a-element-error ──

export const aElementError: Rule = {
  id: "a-element-error",
  visit(el, a, ctx) {
    if (el.localName !== "a") {
      if (a["role"] !== undefined && rawRole(el) === "link" && !isFocusableStructural(el)) ctx.report(el, "roleLinkMissingTabindex");
      return;
    }
    if (a["href"] === undefined) {
      // Runtime refinement: an empty named anchor (<a id="x"></a> / <a name="x">) is a fragment target, not a link.
      if ((a["name"] !== undefined || a["id"] !== undefined) && !normalizeSpace(el.textContent || "") && !el.firstElementChild) return;
      ctx.report(el, "linkMissingHrefAttribute");
      return;
    }
    const href = a["href"].trim();
    if (href === "" || href === "#") ctx.report(el, "linkHrefEmpty");
    if (ctx.dom.ariaName(el)) return;
    const name = ctx.dom.accessibleName(el);
    if (!name) ctx.report(el, "linkAccessibleName");
    else if (/^https?:\/\//i.test(ctx.dom.textFromContent(el))) ctx.report(el, "linkTextOnlyUrl");
    for (const c of descendantsByTag(el, "img", "svg")) {
      if (decorativeRole(c) || ctx.excluded(c)) continue;
      if (c.localName === "img") {
        if (!c.hasAttribute("alt")) ctx.report(c, "linkImgMissingAlt");
      } else if (isOuterSvg(c) && !svgHasOwnName(c, ctx)) ctx.report(c, "linkSvgMissingAccessibleName");
    }
  },
};

// ── a-element-warning ──

export const aElementWarning: Rule = {
  id: "a-element-warning",
  tags: ["a"],
  visit(el, a, ctx) {
    if (a["href"] === undefined) return;
    if (tabindexAttr(el) === -1) ctx.report(el, "linkTabindexNegative");
    const name = ctx.dom.accessibleName(el);
    if (!name || /^https?:\/\//i.test(name)) {
      if (name.length > 150) ctx.report(el, "linkTextTooLong");
      return;
    }
    if (GENERIC_LINK_TEXT.test(name)) ctx.report(el, "linkTextGenericClickHere");
    if (name.length > 150) ctx.report(el, "linkTextTooLong");
  },
};

// ── skip-link-warning ──

export const skipLinkWarning: Rule = {
  id: "skip-link-warning",
  tags: ["a"],
  scope: "all",
  visit(el, a, ctx) {
    if (ctx.state.found) return;
    const href = a["href"];
    if (!href || !href.startsWith("#") || href.length < 2) return;
    const text = (ctx.dom.textFromContent(el) + " " + (a["aria-label"] || "")).toLowerCase();
    if (!text.includes("skip") && !text.includes("main")) return;
    // Runtime refinement: the target must exist, otherwise the skip link does nothing.
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep raw */
    }
    if (ctx.doc.getElementById(id) || ctx.doc.getElementsByName(id).length > 0) ctx.state.found = true;
  },
  finish(ctx) {
    if (!ctx.isDocument || ctx.state.found) return;
    const target = ctx.doc.body ?? ctx.doc.documentElement;
    if (target) ctx.report(target, "pageHaveSkipLink");
  },
};

// ── button-element-error ──

function isButtonLike(el: Element, a: Readonly<Record<string, string>>): boolean {
  if (el.localName === "button") return true;
  // Runtime addition: role="button" custom buttons need a name just as much.
  return a["role"] !== undefined && el.localName !== "input" && rawRole(el) === "button";
}

export const buttonElementError: Rule = {
  id: "button-element-error",
  visit(el, a, ctx) {
    if (!isButtonLike(el, a)) return;
    if (!ctx.dom.accessibleName(el)) {
      ctx.report(el, "buttonAccessibleName");
      return;
    }
    // Source semantics: descendant checks only when the name comes from the content.
    if (ctx.dom.ariaName(el)) return;
    for (const c of descendantsByTag(el, "svg", "img", "i")) {
      const tag = c.localName;
      if (tag === "svg" && !isOuterSvg(c)) continue;
      if (ctx.excluded(c, "rendered")) continue;
      const hiddenFromAT = decorativeRole(c) || ctx.dom.ariaHidden(c);
      const label = c.getAttribute("aria-label");
      if (label !== null && GENERIC_GRAPHIC_LABELS.has(label.trim().toLowerCase())) ctx.report(c, "buttonImgSvgIconGenericLabel");
      if (tag === "svg") {
        // Runtime refinement: hiding an unlabelled decorative SVG next to button text is correct;
        // only a *labelled* SVG that is hidden loses content.
        if (hiddenFromAT) {
          if (svgHasOwnName(c, ctx)) ctx.report(c, "buttonSvgHiddenFromAT", { scope: "rendered" });
        } else if (rawRole(c) !== "img") ctx.report(c, "buttonSvgMissingRoleImg");
        else if (!svgHasOwnName(c, ctx)) ctx.report(c, "buttonSvgMissingLabel");
      } else if (tag === "img") {
        if (hiddenFromAT) continue;
        const alt = c.getAttribute("alt");
        if (alt === null) ctx.report(c, "buttonImgMissingAlt");
        else if (alt !== "" && alt.trim() === "") ctx.report(c, "buttonImgEmptyAlt");
      } else {
        if (normalizeSpace(c.textContent || "")) continue; // <i> with text is italics, not an icon
        if (hiddenFromAT) {
          if (ctx.dom.ariaName(c)) ctx.report(c, "buttonIconHiddenFromAT", { scope: "rendered" });
        } else if (rawRole(c) !== "img") ctx.report(c, "buttonIconMissingRole");
        else if (!ctx.dom.ariaName(c)) ctx.report(c, "buttonIconMissingLabel");
      }
    }
  },
};

// ── button-element-warning ──

export const buttonElementWarning: Rule = {
  id: "button-element-warning",
  visit(el, a, ctx) {
    if (!isButtonLike(el, a)) return;
    const name = ctx.dom.accessibleName(el);
    if (name && GENERIC_BUTTON_TEXT.test(name)) ctx.report(el, "buttonTextGeneric");
  },
};

// ── click-handler-warning ──

const CLICK_TAGS = ["div", "span", "p", "section", "article", "main", "aside"];

export const clickHandlerWarning: Rule = {
  id: "click-handler-warning",
  tags: CLICK_TAGS,
  visit(el, a, ctx) {
    const props = frameworkProps(el);
    let listeners: Record<string, unknown[] | undefined> | null = null;
    if (ctx.listeners) {
      try {
        listeners = ctx.listeners(el) || null;
      } catch {
        listeners = null;
      }
    }
    const node = el as unknown as Record<string, unknown>;
    const has = (attr: string, prop: string, events: readonly string[]): boolean => {
      if (a[attr] !== undefined) return true;
      // Imperative el.onclick = fn (other handler properties are rare; skip their getters).
      if (attr === "onclick" && typeof node[attr] === "function") return true;
      if (props && typeof props[prop] === "function") return true;
      if (listeners) for (const e of events) if ((listeners[e]?.length ?? 0) > 0) return true;
      return false;
    };
    // Triggers first; keyboard counterparts are only looked up when a trigger exists.
    if (has("onclick", "onClick", ["click"]) && !has("onkeydown", "onKeyDown", ["keydown"]) && !has("onkeyup", "onKeyUp", ["keyup"]) && !has("onkeypress", "onKeyPress", ["keypress"])) {
      ctx.report(el, "onclickWithoutOnkeydownOnkeyup");
    }
    const over = has("onmouseover", "onMouseOver", ["mouseover"]) || has("onmouseenter", "onMouseEnter", ["mouseenter"]);
    if (over && !has("onfocus", "onFocus", ["focus", "focusin"])) return ctx.report(el, "mouseEventWithoutKeyboardEquivalent");
    const out = has("onmouseout", "onMouseOut", ["mouseout"]) || has("onmouseleave", "onMouseLeave", ["mouseleave"]);
    if (out && !has("onblur", "onBlur", ["blur", "focusout"])) ctx.report(el, "mouseEventWithoutKeyboardEquivalent");
  },
};

// ── accesskey-element-error ──

export const accesskeyElementError: Rule = {
  id: "accesskey-element-error",
  visit(el, a, ctx) {
    const k = a["accesskey"];
    if (k === undefined || !k.trim() || ctx.excluded(el)) return;
    const map = (ctx.state.keys ??= new Map<string, Element[]>()) as Map<string, Element[]>;
    const key = k.trim().toLowerCase();
    const list = map.get(key);
    if (list) list.push(el);
    else map.set(key, [el]);
  },
  finish(ctx) {
    const map = ctx.state.keys as Map<string, Element[]> | undefined;
    if (!map) return;
    for (const [key, els] of map) if (els.length > 1) for (const el of els) ctx.report(el, "duplicateAccesskey", { detail: `accesskey "${key.slice(0, 8)}" used ${els.length}x`, scope: "all" });
  },
};

// ── autofocus-element-warning ──

export const autofocusElementWarning: Rule = {
  id: "autofocus-element-warning",
  visit(el, a, ctx) {
    if (a["autofocus"] !== undefined) return ctx.report(el, "noAutofocus");
    // React renders autoFocus as a focus() call, not an attribute; read it from the React props.
    const tag = el.localName;
    if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || a["tabindex"] !== undefined) {
      const props = frameworkProps(el);
      if (props && props.autoFocus === true) ctx.report(el, "noAutofocus", { detail: "React autoFocus" });
    }
  },
};

// ── focus-element-error ──

const NATIVE_FOCUS_TAGS = new Set(["a", "button", "input", "select", "textarea"]);

export const focusElementError: Rule = {
  id: "focus-element-error",
  visit(el, a, ctx) {
    if (a["aria-activedescendant"] !== undefined && !isFocusableStructural(el)) ctx.report(el, "activedescendantNotFocusable");
    if (a["tabindex"] !== undefined && NATIVE_FOCUS_TAGS.has(el.localName) && isNativelyFocusable(el) && tabindexAttr(el) === 0) {
      ctx.report(el, "unnecessaryTabindex");
    }
  },
};

// ── focus-element-warning ──

const COMPOSITE_CHILD_ROLES = new Set(["option", "gridcell", "treeitem", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "row", "radio"]);

export const focusElementWarning: Rule = {
  id: "focus-element-warning",
  visit(el, a, ctx) {
    if (a["tabindex"] !== undefined) {
      const t = tabindexAttr(el);
      if (t !== null && t > 0) ctx.report(el, "positiveTabindexValueFound");
      if ((t === 0 || t === -1) && !isNativelyFocusable(el) && !explicitRole(el) && !implicitRole(el)) {
        ctx.report(el, "elementTabindexButRole");
      }
    }
    if (a["role"] === undefined) return;
    const role = explicitRole(el);
    if (!role || !INTERACTIVE_ROLES.has(role) || isFocusableStructural(el)) return;
    if (ariaTrue(a["aria-disabled"])) return;
    // Runtime refinement: items of a composite widget that manages focus with aria-activedescendant.
    if (COMPOSITE_CHILD_ROLES.has(role) && closestWithAttr(el.parentElement, "aria-activedescendant")) return;
    ctx.report(el, "interactiveRoleNotFocusable");
  },
};

// ── disabled-element-warning ──

export const disabledElementWarning: Rule = {
  id: "disabled-element-warning",
  visit(el, a, ctx) {
    if (a["disabled"] !== undefined && a["tabindex"] !== undefined) {
      const t = tabindexAttr(el);
      if (t !== null && t >= 0) ctx.report(el, "disabledElementTabOrder");
    }
    const ad = a["aria-disabled"];
    if (ad !== undefined) {
      const v = ad.trim().toLowerCase();
      if (v !== "true" && v !== "false") ctx.report(el, "ariaDisabledTrueFalse");
    }
  },
};

export const INTERACTIVE_RULES: readonly Rule[] = [
  aElementError, aElementWarning, skipLinkWarning, buttonElementError, buttonElementWarning,
  clickHandlerWarning, accesskeyElementError, autofocusElementWarning, focusElementError,
  focusElementWarning, disabledElementWarning,
];

