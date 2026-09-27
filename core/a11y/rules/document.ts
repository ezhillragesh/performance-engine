// Page-level metadata. Ported from a11yinspect: lang-element-error, title-element-error, meta-element-*.
// These only make sense for a whole document, so they report on <html>/<title>/<meta> with scope "all".
import { normalizeSpace } from "../dom.js";
import type { Rule } from "../rule.js";

const XHTML = "http://www.w3.org/1999/xhtml";

/** BCP 47 structure (Intl) plus an ISO 639 primary subtag, so "english" or "en_US" fail. */
export function isValidLang(lang: string): boolean {
  const t = lang.trim();
  if (!/^[a-z]{2,3}(-|$)/i.test(t)) return false;
  const intl = (globalThis as { Intl?: { getCanonicalLocales?: (l: string) => string[] } }).Intl;
  if (intl && typeof intl.getCanonicalLocales === "function") {
    try {
      intl.getCanonicalLocales(t);
      return true;
    } catch {
      return false;
    }
  }
  return /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/i.test(t);
}

export const langElementError: Rule = {
  id: "lang-element-error",
  tags: ["html"],
  scope: "all",
  visit(el, a, ctx) {
    if (el !== ctx.doc.documentElement) return;
    const lang = a["lang"] ?? a["xml:lang"];
    if (lang === undefined) return ctx.report(el, "htmlElementMissingLangAttribute");
    if (!lang.trim()) return ctx.report(el, "emptyLangAttribute");
    if (!isValidLang(lang)) ctx.report(el, "invalidLangAttributeValue", { detail: `lang="${lang.trim().slice(0, 30)}"` });
  },
};

export const titleElementError: Rule = {
  id: "title-element-error",
  scope: "all",
  finish(ctx) {
    if (!ctx.isDocument) return;
    const titles = ctx.doc.getElementsByTagName("title");
    let title: Element | null = null;
    for (let i = 0; i < titles.length; i++) {
      const t = titles[i];
      if (t.namespaceURI === XHTML && !t.closest("svg")) {
        title = t;
        break;
      }
    }
    if (!title) {
      if (ctx.doc.documentElement) ctx.report(ctx.doc.documentElement, "pageMissingTitleElement");
      return;
    }
    if (!normalizeSpace(title.textContent || "")) ctx.report(title, "titleElementEmpty");
  },
};

export const metaElementError: Rule = {
  id: "meta-element-error",
  tags: ["meta"],
  scope: "all",
  visit(el, a, ctx) {
    if ((a["name"] || "").trim().toLowerCase() !== "viewport") return;
    const content = a["content"];
    if (!content) return;
    if (/user-scalable\s*=\s*["']?(no|0)\b/i.test(content)) {
      ctx.report(el, "metaViewportDisablesZoom");
      ctx.report(el, "viewportUserScalableNo");
    }
    const m = /maximum-scale\s*=\s*["']?([\d.]+)/i.exec(content);
    if (m && parseFloat(m[1]) < 2) ctx.report(el, "viewportMaxScaleLow", { detail: `maximum-scale=${m[1]}` });
  },
};

export const metaElementWarning: Rule = {
  id: "meta-element-warning",
  tags: ["meta"],
  scope: "all",
  visit(el, a, ctx) {
    if ((a["http-equiv"] || "").trim().toLowerCase() !== "refresh") return;
    const content = a["content"];
    if (!content || !content.trim()) return;
    ctx.report(el, "metaRefreshDetected");
    // Runtime: parse the delay; only a non-zero delay is a timed refresh/redirect (source: any non-"0;" prefix).
    const delay = parseFloat(content);
    if (!(delay === 0)) ctx.report(el, "metaRefreshTimeout", { detail: Number.isFinite(delay) ? `${delay}s` : undefined });
  },
};

export const DOCUMENT_RULES: readonly Rule[] = [langElementError, titleElementError, metaElementError, metaElementWarning];
