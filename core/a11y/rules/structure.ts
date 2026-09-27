// Document structure. Ported from a11yinspect: heading-element-*, list-element-*, dl-element-error,
// landmark-element-*, section-element-warning, details-element-*, blockquote-element-warning,
// hr-element-warning, abbr-element-error, time-element-error, ruby-element-*, duplicate-id-error.
//
// Runtime accuracy: heading order is evaluated across the whole rendered page (hidden headings are
// skipped), landmarks use computed implicit roles and accessible names, ids are checked document-wide.
import { LANDMARK_ROLES } from "../aria-data.js";
import { childByTag, closestTag, explicitRole, findDescendant, hasRoleToken, implicitRole, normalizeSpace, rawRole } from "../dom.js";
import { ariaTrue, hasText, type Rule, type RuleContext } from "../rule.js";

const isHeadingEl = (e: Element): boolean => /^h[1-6]$/.test(e.localName) || hasRoleToken(e, "heading");

function headingLevel(el: Element, a: Readonly<Record<string, string>>): number | null {
  const m = /^h([1-6])$/.exec(el.localName);
  if (m) return Number(m[1]);
  if (a["role"] !== undefined && explicitRole(el) === "heading") {
    const l = parseInt(a["aria-level"] || "", 10);
    return l >= 1 ? Math.min(l, 9) : 2;
  }
  return null;
}

/** Source helper: the heading's only content is a single <img> without (or with empty) alt. */
function onlyImageWithoutAlt(el: Element): boolean {
  let img: Element | null = null;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) {
      if ((n as Text).data.trim()) return false;
    } else if (n.nodeType === 1) {
      if (img) return false;
      img = n as Element;
    }
  }
  if (!img || img.localName !== "img") return false;
  const alt = img.getAttribute("alt");
  return alt === null || !alt.trim();
}

function presentational(el: Element): boolean {
  const r = rawRole(el);
  return r === "presentation" || r === "none";
}

export const headingElementError: Rule = {
  id: "heading-element-error",
  visit(el, a, ctx) {
    const level = headingLevel(el, a);
    if (level === null) return;
    if (/^h[1-6]$/.test(el.localName) && presentational(el)) return;
    if (ctx.excluded(el)) return;
    if (!ctx.dom.accessibleName(el)) {
      if (!onlyImageWithoutAlt(el)) ctx.report(el, "headingEmpty");
      return;
    }
    const last = ctx.state.last as number | undefined;
    if (last !== undefined && level > last + 1) ctx.report(el, "headingLevelSkipped", { detail: `h${last} → h${level}` });
    ctx.state.last = level;
    if (findDescendant(el, isHeadingEl)) ctx.report(el, "headingNested");
  },
};

export const headingElementWarning: Rule = {
  id: "heading-element-warning",
  scope: "rendered",
  visit(el, a, ctx) {
    const m = /^h([1-6])$/.exec(el.localName);
    if (!m) {
      if (a["role"] !== undefined && explicitRole(el) === "heading" && a["aria-level"] === undefined) ctx.report(el, "headingRoleMissingAriaLevel", { scope: "visible" });
      return;
    }
    const hidden = presentational(el) || ariaTrue(a["aria-hidden"]);
    if (hidden) ctx.report(el, "headingHiddenOrPresentation");
    if (ctx.excluded(el, "visible")) return;
    if (m[1] === "1" && !hidden) {
      const n = ((ctx.state.h1 as number | undefined) ?? 0) + 1;
      ctx.state.h1 = n;
      if (n > 1) ctx.report(el, "multipleH1", { detail: `h1 #${n}` });
    }
    if (!ctx.dom.accessibleName(el) && onlyImageWithoutAlt(el)) ctx.report(el, "headingOnlyImageNoAlt");
  },
};

function isEmptyElement(el: Element): boolean {
  return el.firstElementChild === null && !normalizeSpace(el.textContent || "");
}

/** ul/ol whose list semantics are overridden by an explicit non-list role. */
function listOverridden(el: Element): boolean {
  const r = rawRole(el);
  return r !== null && r !== "list";
}

function isListItem(el: Element): boolean {
  return el.localName === "li" || explicitRole(el) === "listitem";
}

export const listElementError: Rule = {
  id: "list-element-error",
  visit(el, a, ctx) {
    const tag = el.localName;
    if (tag === "ul" || tag === "ol") {
      if (listOverridden(el)) return;
      let hasItems = false;
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
        if (isListItem(c)) hasItems = true;
        if (c.localName === "li" && isEmptyElement(c)) ctx.report(c, "listEmptyItem");
      }
      if (!hasItems) ctx.report(el, "listNoItems");
      return;
    }
    if (tag === "li") {
      const p = el.parentElement;
      let listAncestor: Element | null = p;
      while (listAncestor && !["ul", "ol", "menu"].includes(listAncestor.localName) && !hasRoleToken(listAncestor, "list")) listAncestor = listAncestor.parentElement;
      if (!listAncestor) ctx.report(el, "liOrphan");
      if (p && p.localName === "li") ctx.report(el, "liNestedInLi");
      return;
    }
    if (a["role"] !== undefined && explicitRole(el) === "list") {
      let hasItems = false;
      for (let c = el.firstElementChild; c && !hasItems; c = c.nextElementSibling) hasItems = isListItem(c);
      if (!hasItems) ctx.report(el, "listNoItems");
    }
  },
};

function listStyleNone(el: Element, ctx: RuleContext): boolean {
  const w = ctx.dom.win;
  if (!w) return false;
  try {
    const cs = w.getComputedStyle(el);
    return cs.listStyleType === "none" || /(^|\s)none(\s|$)/.test(cs.listStyle || "");
  } catch {
    return false;
  }
}

export const listElementWarning: Rule = {
  id: "list-element-warning",
  tags: ["ul", "ol", "li"],
  scope: "rendered",
  visit(el, a, ctx) {
    const tag = el.localName;
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "listAriaHidden");
    if (tag === "li" || ctx.excluded(el, "visible")) return;
    const r = rawRole(el);
    if (r === "list") {
      // Runtime refinement: role="list" is a deliberate fix when list-style:none strips list semantics (WebKit).
      if (!listStyleNone(el, ctx)) ctx.report(el, "listRedundantRoleList", { scope: "visible" });
    } else if (r !== null) return;
    let invalid = false;
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if ((n as Text).data.trim()) invalid = true;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      const ct = c.localName;
      if (ct === "li") {
        if (rawRole(c) === "listitem") ctx.report(c, "listitemRedundantRole", { scope: "visible" });
        continue;
      }
      if (ct === "script" || ct === "template") continue;
      invalid = true;
      if (normalizeSpace(c.textContent || "")) ctx.report(c, "listInvalidElement", { scope: "visible" });
    }
    if (invalid) ctx.report(el, "listInvalidChildren", { scope: "visible" });
  },
};

export const dlElementError: Rule = {
  id: "dl-element-error",
  tags: ["dl", "dt", "dd"],
  visit(el, _a, ctx) {
    const tag = el.localName;
    if (tag === "dt" || tag === "dd") {
      const p = el.parentElement;
      if (!closestTag(p, "dl")) ctx.report(el, "dtDdInsideDl");
      return;
    }
    let invalid = false;
    const terms: Element[] = [];
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if ((n as Text).data.trim()) invalid = true;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const c = n as Element;
      const ct = c.localName;
      if (ct === "dt" || ct === "dd") terms.push(c);
      else if (ct === "div") {
        for (let g = c.firstElementChild; g; g = g.nextElementSibling) if (g.localName === "dt" || g.localName === "dd") terms.push(g);
      } else if (ct !== "script" && ct !== "template") invalid = true;
    }
    if (invalid) ctx.report(el, "dlContainsInvalidChildren");
    let first = el.firstElementChild;
    while (first && (first.localName === "script" || first.localName === "template")) first = first.nextElementSibling;
    if (first && first.localName === "div") first = first.firstElementChild; // runtime: <div> groups are valid wrappers
    if (first && first.localName !== "dt") ctx.report(el, "dtNotFirstChildOfDl");
    const hasDt = terms.some((t) => t.localName === "dt");
    const hasDd = terms.some((t) => t.localName === "dd");
    if (hasDt && !hasDd) ctx.report(el, "dlMissingDdElement");
    for (const t of terms) if (isEmptyElement(t)) ctx.report(t, "dlEmptyTerm");
  },
};

function landmarkRole(el: Element, a: Readonly<Record<string, string>>, ctx: RuleContext): { role: string; explicit: boolean } | null {
  if (a["role"] !== undefined) {
    const r = explicitRole(el);
    if (r && LANDMARK_ROLES.has(r)) return { role: r, explicit: true };
    if (r) return null;
  }
  const tag = el.localName;
  if (tag !== "header" && tag !== "footer" && tag !== "main" && tag !== "nav" && tag !== "aside" && tag !== "section" && tag !== "form" && tag !== "search") return null;
  const r = implicitRole(el, () => !!ctx.dom.ariaName(el) || hasText(a["title"]));
  return r && LANDMARK_ROLES.has(r) ? { role: r, explicit: false } : null;
}

export const landmarkElementError: Rule = {
  id: "landmark-element-error",
  visit(el, a, ctx) {
    if (ctx.state.found) return;
    const isMain = el.localName === "main" || (a["role"] !== undefined && explicitRole(el) === "main");
    if (isMain && !ctx.excluded(el)) ctx.state.found = true;
  },
  finish(ctx) {
    if (!ctx.isDocument || ctx.state.found) return;
    const target = ctx.doc.body ?? ctx.doc.documentElement;
    if (target) ctx.report(target, "pageHaveMainLandmark", { scope: "all" });
  },
};

const MULTI_NAMED_ROLES = new Set(["navigation", "complementary", "region", "banner", "contentinfo", "search", "form"]);

export const landmarkElementWarning: Rule = {
  id: "landmark-element-warning",
  visit(el, a, ctx) {
    const lm = landmarkRole(el, a, ctx);
    if (!lm) return;
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "landmarkAriaHidden", { scope: "rendered" });
    if (ctx.excluded(el)) return;
    if (lm.role === "main") {
      const n = ((ctx.state.main as number | undefined) ?? 0) + 1;
      ctx.state.main = n;
      if (n > 1) ctx.report(el, "multipleMainLandmarksFound");
    }
    const reported = (ctx.state.reported ??= new Set<Element>()) as Set<Element>;
    if (lm.explicit && lm.role === "region" && !ctx.dom.ariaName(el)) {
      ctx.report(el, "landmarkMissingAccessibleName", { detail: 'role="region" needs a name' });
      reported.add(el);
    }
    if (MULTI_NAMED_ROLES.has(lm.role)) {
      const by = (ctx.state.byRole ??= new Map<string, Element[]>()) as Map<string, Element[]>;
      const list = by.get(lm.role);
      if (list) list.push(el);
      else by.set(lm.role, [el]);
    }
  },
  finish(ctx) {
    // Runtime: landmark uniqueness — repeated landmarks of one type must each carry a distinct name.
    const by = ctx.state.byRole as Map<string, Element[]> | undefined;
    const reported = (ctx.state.reported as Set<Element> | undefined) ?? new Set<Element>();
    if (!by) return;
    for (const [role, els] of by) {
      if (els.length < 2) continue;
      const names = new Map<string, number>();
      for (const el of els) {
        const n = ctx.dom.accessibleName(el).toLowerCase();
        if (n) names.set(n, (names.get(n) || 0) + 1);
      }
      for (const el of els) {
        if (reported.has(el)) continue;
        const n = ctx.dom.accessibleName(el).toLowerCase();
        if (!n) ctx.report(el, "landmarkMissingAccessibleName", { detail: `${els.length} ${role} landmarks`, scope: "all" });
        else if ((names.get(n) || 0) > 1) ctx.report(el, "landmarkMissingAccessibleName", { detail: `${role} landmarks share the same name`, scope: "all" });
      }
    }
  },
};

export const sectionElementWarning: Rule = {
  id: "section-element-warning",
  tags: ["section"],
  visit(el, _a, ctx) {
    if (!ctx.dom.ariaName(el)) ctx.report(el, "sectionHaveAccessibleName");
    if (!findDescendant(el, isHeadingEl)) ctx.report(el, "sectionHaveHeading");
  },
};

export const detailsElementError: Rule = {
  id: "details-element-error",
  tags: ["details", "summary"],
  visit(el, _a, ctx) {
    if (el.localName === "details") {
      if (!childByTag(el, "summary")) ctx.report(el, "detailsElementMissingSummaryChild");
      return;
    }
    const p = el.parentElement;
    if (!p || p.localName !== "details") ctx.report(el, "summaryElementInsideDetails");
  },
};

export const detailsElementWarning: Rule = {
  id: "details-element-warning",
  tags: ["details"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "detailsAriaHidden");
  },
};

export const blockquoteElementWarning: Rule = {
  id: "blockquote-element-warning",
  tags: ["blockquote"],
  visit(el, a, ctx) {
    if (a["cite"] !== undefined) return;
    // Runtime: a visible <cite> or an enclosing <figure> with <figcaption> also attributes the quote.
    if (el.getElementsByTagName("cite").length > 0) return;
    const fig = el.parentElement;
    if (fig && fig.localName === "figure" && childByTag(fig, "figcaption")) return;
    ctx.report(el, "blockquoteHaveCiteAttributeAttribution");
  },
};

export const hrElementWarning: Rule = {
  id: "hr-element-warning",
  tags: ["hr"],
  visit(el, a, ctx) {
    if (a["role"] === undefined || !a["role"].trim()) return;
    const r = rawRole(el);
    if (r !== "separator" && r !== "presentation" && r !== "none") ctx.report(el, "hrHaveRoleSeparatorPresentation");
  },
};

export const abbrElementError: Rule = {
  id: "abbr-element-error",
  tags: ["abbr"],
  visit(el, a, ctx) {
    if (!hasText(a["title"])) ctx.report(el, "abbrElementMissingTitleAttribute");
  },
};

const MACHINE_DATE = /^(\d{4}(-\d{2}(-\d{2})?)?|\d{4}-W\d{2}|\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?|P(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?)$/;

export const timeElementError: Rule = {
  id: "time-element-error",
  tags: ["time"],
  visit(el, a, ctx) {
    if (hasText(a["datetime"])) return;
    // Runtime refinement: text content that is itself a valid machine-readable date needs no datetime.
    if (MACHINE_DATE.test(normalizeSpace(el.textContent || ""))) return;
    ctx.report(el, "timeElementMissingDatetimeAttribute");
  },
};

export const rubyElementError: Rule = {
  id: "ruby-element-error",
  tags: ["ruby"],
  visit(el, _a, ctx) {
    if (el.getElementsByTagName("rt").length === 0) ctx.report(el, "rubyMissingRtElement");
  },
};

export const rubyElementWarning: Rule = {
  id: "ruby-element-warning",
  tags: ["ruby"],
  visit(el, _a, ctx) {
    if (el.getElementsByTagName("rp").length === 0) ctx.report(el, "rubyHaveRpFallback");
  },
};

export const duplicateIdError: Rule = {
  id: "duplicate-id-error",
  scope: "all",
  visit(el, a, ctx) {
    const id = a["id"];
    if (id === undefined || !id.trim()) return;
    const seen = (ctx.state.seen ??= new Map<string, number>()) as Map<string, number>;
    const n = (seen.get(id) || 0) + 1;
    seen.set(id, n);
    if (n > 1) ((ctx.state.dups ??= []) as Array<[Element, string]>).push([el, id]);
  },
  finish(ctx) {
    const dups = ctx.state.dups as Array<[Element, string]> | undefined;
    const seen = ctx.state.seen as Map<string, number> | undefined;
    if (!dups || !seen) return;
    for (const [el, id] of dups) ctx.report(el, "duplicateIdAttributeFound", { detail: `id="${id.slice(0, 60)}" (${seen.get(id)} elements)` });
  },
};

export const STRUCTURE_RULES: readonly Rule[] = [
  headingElementError, headingElementWarning, listElementError, listElementWarning, dlElementError,
  landmarkElementError, landmarkElementWarning, sectionElementWarning, detailsElementError, detailsElementWarning,
  blockquoteElementWarning, hrElementWarning, abbrElementError, timeElementError, rubyElementError,
  rubyElementWarning, duplicateIdError,
];
