// Images & embedded graphics: img, i (icons), area/map, svg, canvas, figure, object, embed.
// Ported from a11yinspect: img-element-*, area-element-error, map-element-*, svg-element-*,
// canvas-element-*, figure-element-error, object-element-*, embed-element-error.
import { childByTag, closestTag, normalizeSpace, rawRole } from "../dom.js";
import { ariaTrue, hasText, type Rule } from "../rule.js";

const GENERIC_IMAGE_NAMES = new Set([
  "image", "graphic", "picture", "photo", "spacer", "thumbnail", "drawing", "painting", "artwork",
  "animation", "jpeg", "png", "gif", "svg", "tiff", "webp", "img", "icon",
]);

function isDecorativeRole(role: string | null): boolean {
  return role === "presentation" || role === "none";
}

/** An <i> used as an icon (no text of its own) rather than for italic text. */
function isIconI(el: Element): boolean {
  return normalizeSpace(el.textContent || "") === "";
}

/** The closest link/button ancestor whose name would come from this element's content. */
function controlAncestor(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if ((p.localName === "a" && p.hasAttribute("href")) || p.localName === "button") return p;
    const r = rawRole(p);
    if (r === "button" || r === "link") return p;
  }
  return null;
}

export const imgElementError: Rule = {
  id: "img-element-error",
  tags: ["img", "i"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (el.localName === "i") {
      if (ctx.excluded(el, "visible")) return; // includes own aria-hidden="true"
      if (rawRole(el) === "img" && !ctx.dom.ariaName(el)) ctx.report(el, "iconMissingAccessibleName");
      return;
    }
    const role = rawRole(el);
    const ownHidden = ariaTrue(a["aria-hidden"]);
    if (role === "img" && ownHidden) {
      ctx.report(el, "imgRoleImgAriaHidden");
      return;
    }
    if (isDecorativeRole(role) || ctx.excluded(el, "visible")) return;
    const alt = a["alt"];
    if (alt === undefined) {
      ctx.report(el, ctx.dom.ariaName(el) ? "imgMissingAlt" : "imgMissingAltNoAria");
      return;
    }
    if (alt.trim() === "") {
      // Runtime refinement: alt="" is the correct way to mark a decorative image. Report only
      // whitespace-only alt, conflicting signals (alt="" plus a label), or an alt="" image that
      // leaves its link/button without any accessible name.
      if (alt !== "") return ctx.report(el, "imgEmptyAlt", { detail: "whitespace-only alt" });
      if (hasText(a["aria-label"]) || hasText(a["aria-labelledby"]) || hasText(a["title"])) {
        return ctx.report(el, "imgEmptyAlt", { detail: 'alt="" but the image is also labelled' });
      }
      const ctl = controlAncestor(el);
      if (ctl && !ctx.dom.accessibleName(ctl)) ctx.report(el, "imgEmptyAlt", { detail: "sole content of an unnamed control" });
    }
  },
};

export const imgElementWarning: Rule = {
  id: "img-element-warning",
  tags: ["img", "i"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (el.localName === "i") {
      if (ctx.excluded(el, "visible")) return;
      const role = rawRole(el);
      // Runtime refinement: only <i> elements without text are icons; <i>text</i> is italics.
      if (role !== "img" && !isDecorativeRole(role) && isIconI(el)) ctx.report(el, "iconMissingRoleImg");
      return;
    }
    const role = rawRole(el);
    if (isDecorativeRole(role) || ariaTrue(a["aria-hidden"])) {
      ctx.report(el, "imgDecorative");
      return;
    }
    if (ctx.excluded(el, "visible")) return;
    if (a["src"] === undefined && a["srcset"] === undefined) {
      ctx.report(el, "imgMissingSrc");
      return;
    }
    const alt = a["alt"];
    if (alt === undefined || alt.trim() === "") return;
    const t = alt.trim();
    if (GENERIC_IMAGE_NAMES.has(t.toLowerCase())) return ctx.report(el, "imgAltGeneric");
    if (/\.(jpg|jpeg|png|gif|svg|webp|bmp|avif)$/i.test(t)) ctx.report(el, "imgAltFilename");
  },
};

export const areaElementError: Rule = {
  id: "area-element-error",
  tags: ["area"],
  visit(el, a, ctx) {
    // <area> never has its own box; visibility is that of its <map> (and the image using it).
    const map = closestTag(el, "map") ?? el;
    const opts = { visibilityOf: map };
    if (a["href"] === undefined) ctx.report(el, "areaMissingHrefAttribute", opts);
    const alt = a["alt"];
    if (alt === undefined) ctx.report(el, "areaMissingAltAttribute", opts);
    else if (alt.trim() === "") ctx.report(el, "areaEmptyAlt", opts);
  },
};

export const mapElementError: Rule = {
  id: "map-element-error",
  tags: ["map"],
  scope: "all",
  visit(el, a, ctx) {
    if (ctx.dom.ariaHidden(el)) return;
    const name = a["name"];
    if (name === undefined) ctx.report(el, "mapMissingNameAttribute");
    else if (name.trim() === "") ctx.report(el, "mapEmptyNameAttribute");
    if (el.getElementsByTagName("area").length === 0) ctx.report(el, "mapAreaChildren");
  },
};

export const mapElementWarning: Rule = {
  id: "map-element-warning",
  tags: ["map"],
  scope: "all",
  visit(el, a, ctx) {
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "mapAriaHidden");
  },
};

function svgHasTitle(el: Element): boolean {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === "title" && normalizeSpace(c.textContent || "")) return true;
  }
  return false;
}

function svgName(el: Element, ctx: { dom: { ariaName(el: Element): string } }): boolean {
  return !!ctx.dom.ariaName(el) || svgHasTitle(el);
}

function isOuterSvg(el: Element): boolean {
  const p = el.parentElement;
  return !p || closestTag(p, "svg") === null;
}

function hasNamedAncestor(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const t = p.localName;
    if (t === "a" || t === "button" || /^h[1-6]$/.test(t)) return true;
    const r = rawRole(p);
    if (r === "button" || r === "link" || r === "heading") return true;
  }
  return false;
}

export const svgElementError: Rule = {
  id: "svg-element-error",
  tags: ["svg"],
  visit(el, _a, ctx) {
    if (!isOuterSvg(el)) return;
    const role = rawRole(el);
    // Source: any role. Runtime refinement: role="none"/"presentation" marks a decorative SVG.
    if (!role || isDecorativeRole(role)) return;
    if (!svgName(el, ctx) && !hasNamedAncestor(el)) ctx.report(el, "svgMissingName");
  },
};

export const svgElementWarning: Rule = {
  id: "svg-element-warning",
  tags: ["svg"],
  visit(el, a, ctx) {
    if (!isOuterSvg(el)) return;
    const role = rawRole(el);
    const decorative = isDecorativeRole(role);
    const valid = role === "img" || role === "graphics-document" || role === "graphics-symbol";
    const label = a["aria-label"];
    if (!valid && !decorative) ctx.report(el, "svgMissingRole");
    if (hasText(label) && !valid) ctx.report(el, "svgAriaLabelNoRole");
    if (role === "img" && !svgName(el, ctx)) ctx.report(el, "svgRoleImgNoDescription");
    if (label !== undefined && GENERIC_IMAGE_NAMES.has(label.trim().toLowerCase())) ctx.report(el, "svgGenericDescription");
    if (role !== "img" && !decorative) ctx.report(el, "svgShouldHaveRoleImg");
  },
};

export const canvasElementError: Rule = {
  id: "canvas-element-error",
  tags: ["canvas"],
  visit(el, a, ctx) {
    const role = rawRole(el);
    if (isDecorativeRole(role) || ariaTrue(a["aria-hidden"]) || role === "img") return;
    // Fallback content has no layout box inside <canvas>, so read it structurally.
    if (!normalizeSpace(el.textContent || "")) ctx.report(el, "canvasMissingRoleImg");
  },
};

export const canvasElementWarning: Rule = {
  id: "canvas-element-warning",
  tags: ["canvas"],
  scope: "rendered",
  visit(el, a, ctx) {
    const role = rawRole(el);
    if (isDecorativeRole(role) || ariaTrue(a["aria-hidden"])) return ctx.report(el, "canvasDecorative");
    if (ctx.excluded(el, "visible")) return;
    const fallback = normalizeSpace(el.textContent || "");
    if (role === "img") {
      ctx.report(el, ctx.dom.ariaName(el) || fallback ? "canvasHasDescription" : "canvasMissingDescription");
      return;
    }
    if (fallback) ctx.report(el, "canvasHasDescription");
  },
};

export const figureElementError: Rule = {
  id: "figure-element-error",
  tags: ["figure"],
  visit(el, _a, ctx) {
    if (ctx.dom.ariaName(el)) return;
    if (!childByTag(el, "figcaption")) ctx.report(el, "figureMissingFigcaption");
  },
};

export const objectElementError: Rule = {
  id: "object-element-error",
  tags: ["object"],
  visit(el, a, ctx) {
    if (a["type"] === undefined) ctx.report(el, "objectMissingTypeAttribute");
    if (!ctx.dom.ariaName(el) && !hasText(a["title"]) && !normalizeSpace(el.textContent || "")) ctx.report(el, "objectMissingFallbackContent");
  },
};

export const objectElementWarning: Rule = {
  id: "object-element-warning",
  tags: ["object"],
  scope: "rendered",
  visit(el, a, ctx) {
    if (ariaTrue(a["aria-hidden"])) ctx.report(el, "objectAriaHidden");
  },
};

export const embedElementError: Rule = {
  id: "embed-element-error",
  tags: ["embed"],
  visit(el, a, ctx) {
    if (a["type"] === undefined) ctx.report(el, "embedMissingTypeAttribute");
    if (!ctx.dom.ariaName(el) && !hasText(a["title"])) ctx.report(el, "embedMissingAccessibleName");
  },
};

export const IMAGE_RULES: readonly Rule[] = [
  imgElementError, imgElementWarning, areaElementError, mapElementError, mapElementWarning,
  svgElementError, svgElementWarning, canvasElementError, canvasElementWarning, figureElementError,
  objectElementError, objectElementWarning, embedElementError,
];

