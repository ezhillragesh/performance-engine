// DOM helpers for the runtime accessibility audit. Everything is memoised per audit run in a
// DomCache so repeated questions ("is this hidden?", "what is its name?") stay O(1) amortised.
//
// PII: nothing here ever reads form-field values or contenteditable text. Embedded controls
// contribute "" to accessible-name computation (accname would use their value), and snippets
// redact value-like attributes.
import { NAME_FROM_CONTENT_ROLES, VALID_ROLES } from "./aria-data.js";

/** How a rule's findings are filtered by visibility. */
export type Scope =
  /** Skip elements that are not rendered OR are hidden from assistive technology (aria-hidden / inert). Default. */
  | "visible"
  /** Skip only elements that are not rendered; aria-hidden elements are still reported (rules about aria-hidden). */
  | "rendered"
  /** Never skip (document-level checks: ids, <head> metadata). */
  | "all";

export type Attrs = Readonly<Record<string, string>>;

export const EMPTY_ATTRS: Attrs = Object.freeze(Object.create(null) as Record<string, string>);

/** Attribute name -> value for one element. Names are as stored (lowercase for HTML elements). */
export function readAttrs(el: Element): Attrs {
  if (!el.hasAttributes()) return EMPTY_ATTRS;
  // getAttributeNames() avoids materialising Attr nodes (2x faster than el.attributes[i] in jsdom).
  const names = el.getAttributeNames();
  const out = Object.create(null) as Record<string, string>;
  for (let i = 0; i < names.length; i++) {
    const v = el.getAttribute(names[i]);
    if (v !== null) out[names[i]] = v;
  }
  return out;
}

/** Elements with no box per the HTML UA stylesheet (used when checkVisibility is unavailable). */
const UA_HIDDEN = new Set([
  "head", "script", "style", "template", "title", "meta", "link", "base", "noscript",
  "area", "datalist", "param", "rp", "source", "track", "noembed", "noframes",
]);

const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark",
  "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  "label", "font", "img", "svg", "tspan",
]);

const SKIP_CONTENT_TAGS = new Set(["script", "style", "template", "noscript", "textarea", "select", "datalist"]);

const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "tel", "url", "password", "number"]);

// ── Cheap structural helpers (avoid the selector engine in hot paths) ──

/** First element child with this local name. */
export function childByTag(el: Element, tag: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === tag) return c;
  return null;
}

/** Nearest inclusive ancestor whose local name is one of `tags`. */
export function closestTag(el: Element | null, ...tags: string[]): Element | null {
  for (let p = el; p; p = p.parentElement) if (tags.includes(p.localName)) return p;
  return null;
}

/** Nearest inclusive ancestor carrying `attr`. */
export function closestWithAttr(el: Element | null, attr: string): Element | null {
  for (let p = el; p; p = p.parentElement) if (p.hasAttribute(attr)) return p;
  return null;
}

/** Depth-first search of `el`'s descendants (not `el`), stopping at the first match. */
export function findDescendant(el: Element, pred: (e: Element) => boolean): Element | null {
  let n: Element | null = el.firstElementChild;
  while (n) {
    if (pred(n)) return n;
    let next: Element | null = n.firstElementChild;
    if (!next) {
      let cur: Element | null = n;
      while (cur && cur !== el && !cur.nextElementSibling) cur = cur.parentElement;
      if (!cur || cur === el) return null;
      next = cur.nextElementSibling;
    }
    n = next;
  }
  return null;
}

/** All descendants with one of the given local names, in document order (manual walk: cheap for small subtrees). */
export function descendantsByTag(el: Element, ...tags: string[]): Element[] {
  if (!el.firstElementChild) return [];
  const out: Element[] = [];
  findDescendant(el, (e) => {
    if (tags.includes(e.localName)) out.push(e);
    return false;
  });
  return out;
}

/** Labelable elements per HTML (hidden inputs excluded). */
export function isLabelable(e: Element): boolean {
  switch (e.localName) {
    case "input":
      return inputType(e) !== "hidden";
    case "select":
    case "textarea":
    case "button":
    case "meter":
    case "output":
    case "progress":
      return true;
    default:
      return false;
  }
}

export function hasRoleToken(el: Element, role: string): boolean {
  const v = el.getAttribute("role");
  return v !== null && v.toLowerCase().split(/\s+/).includes(role);
}

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Lowercased, trimmed attribute value or null. */
export function lowerAttr(el: Element, name: string): string | null {
  const v = el.getAttribute(name);
  return v === null ? null : v.trim().toLowerCase();
}

export function isAriaHiddenAttr(el: Element): boolean {
  return lowerAttr(el, "aria-hidden") === "true";
}

/** First token of the role attribute (raw, lowercased) or null. */
export function rawRole(el: Element): string | null {
  const v = el.getAttribute("role");
  if (v === null) return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  const sp = t.search(/\s/);
  return sp === -1 ? t : t.slice(0, sp);
}

/** Effective explicit role: the first valid token of the role attribute (ARIA fallback list), or null. */
export function explicitRole(el: Element): string | null {
  const v = el.getAttribute("role");
  if (v === null) return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  for (const tok of t.split(/\s+/)) if (VALID_ROLES.has(tok)) return tok;
  return null;
}

export function inputType(el: Element): string {
  const t = el.getAttribute("type");
  return t === null ? "text" : t.trim().toLowerCase() || "text";
}

function hasScopingAncestor(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const t = p.localName;
    if (t === "article" || t === "aside" || t === "main" || t === "nav" || t === "section") return true;
    const r = explicitRole(p);
    if (r === "article" || r === "complementary" || r === "main" || r === "navigation" || r === "region") return true;
  }
  return false;
}

/**
 * Implicit ARIA role per HTML-AAM (null = generic / no role). Context-sensitive where it matters:
 * header/footer are only banner/contentinfo outside sectioning content, section/form only map to
 * landmarks when named, img alt="" is presentational, a/area are links only with href.
 */
export function implicitRole(el: Element, hasName?: () => boolean): string | null {
  const tag = el.localName;
  switch (tag) {
    case "a":
    case "area":
      return el.hasAttribute("href") ? "link" : null;
    case "article": return "article";
    case "aside": return "complementary";
    case "blockquote": return "blockquote";
    case "button": return "button";
    case "caption": return "caption";
    case "code": return "code";
    case "datalist": return "listbox";
    case "dd": return "definition";
    case "del": return "deletion";
    case "details": return "group";
    case "dialog": return "dialog";
    case "dt": return "term";
    case "em": return "emphasis";
    case "fieldset": return "group";
    case "figure": return "figure";
    case "footer": return hasScopingAncestor(el) ? null : "contentinfo";
    case "header": return hasScopingAncestor(el) ? null : "banner";
    case "form": return hasName && hasName() ? "form" : null;
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
    case "hr": return "separator";
    case "img": {
      const alt = el.getAttribute("alt");
      if (alt === "" && !el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !el.hasAttribute("title")) return "presentation";
      return "img";
    }
    case "input": {
      const t = inputType(el);
      if (t === "button" || t === "submit" || t === "reset" || t === "image") return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "hidden" || t === "color" || t === "file" || t === "date" || t === "datetime-local" || t === "month" || t === "time" || t === "week" || t === "password") return null;
      if (el.hasAttribute("list")) return "combobox";
      return t === "search" ? "searchbox" : "textbox";
    }
    case "ins": return "insertion";
    case "li": return "listitem";
    case "main": return "main";
    case "math": return "math";
    case "menu": return "list";
    case "meter": return "meter";
    case "nav": return "navigation";
    case "ol": case "ul": return "list";
    case "optgroup": return "group";
    case "option": return "option";
    case "output": return "status";
    case "p": return "paragraph";
    case "progress": return "progressbar";
    case "search": return "search";
    case "section": return hasName && hasName() ? "region" : null;
    case "select": {
      const size = Number(el.getAttribute("size") || "0");
      return el.hasAttribute("multiple") || size > 1 ? "listbox" : "combobox";
    }
    case "strong": return "strong";
    case "sub": return "subscript";
    case "sup": return "superscript";
    case "svg": return "graphics-document";
    case "table": return "table";
    case "tbody": case "thead": case "tfoot": return "rowgroup";
    case "td": return "cell";
    case "textarea": return "textbox";
    case "th": return "columnheader";
    case "time": return "time";
    case "tr": return "row";
    case "address": case "hgroup": return "group";
    default: return null;
  }
}

const FORM_CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "optgroup", "option", "fieldset"]);

/** HTML "actually disabled": own disabled attribute, disabled optgroup, or inside a disabled fieldset (outside its first legend). */
export function isDisabled(el: Element): boolean {
  const tag = el.localName;
  if (!FORM_CONTROL_TAGS.has(tag)) return false;
  if (el.hasAttribute("disabled")) return true;
  if (tag === "option") {
    const g = el.parentElement;
    if (g && g.localName === "optgroup" && g.hasAttribute("disabled")) return true;
  }
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.localName === "fieldset" && p.hasAttribute("disabled")) {
      const legend = childByTag(p, "legend");
      return !(legend && legend.contains(el));
    }
  }
  return false;
}

/** Parsed tabindex attribute, or null when absent/invalid. */
export function tabindexAttr(el: Element): number | null {
  const v = el.getAttribute("tabindex");
  if (v === null || !/^\s*[-+]?\d+\s*$/.test(v)) return null;
  return parseInt(v, 10);
}

function isContentEditableHost(el: Element): boolean {
  const v = el.getAttribute("contenteditable");
  return v !== null && v.trim().toLowerCase() !== "false";
}

/** Natively focusable per HTML (ignores tabindex, disabled and rendering). */
export function isNativelyFocusable(el: Element): boolean {
  switch (el.localName) {
    case "a":
    case "area":
      return el.hasAttribute("href");
    case "button":
    case "select":
    case "textarea":
    case "iframe":
      return true;
    case "input":
      return inputType(el) !== "hidden";
    case "summary": {
      const p = el.parentElement;
      return !!p && p.localName === "details" && childByTag(p, "summary") === el;
    }
    case "audio":
    case "video":
      return el.hasAttribute("controls");
    default:
      return isContentEditableHost(el);
  }
}

/** Focusable ignoring rendering: native or tabindex, and not disabled. */
export function isFocusableStructural(el: Element): boolean {
  if (isDisabled(el)) return false;
  if (tabindexAttr(el) !== null) return true;
  return isNativelyFocusable(el);
}

/** Effective tab index: tabindex attribute, else 0 for natively focusable elements, else -1. */
export function effectiveTabIndex(el: Element): number {
  const t = tabindexAttr(el);
  if (t !== null) return t;
  return isNativelyFocusable(el) ? 0 : -1;
}

// ── CSS escaping (CSS.escape per CSSOM, reimplemented: not every environment has it) ──

export function cssEscape(value: string): string {
  const s = String(value);
  const len = s.length;
  let out = "";
  const first = s.charCodeAt(0);
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (c === 0) {
      out += "�";
    } else if ((c >= 0x1 && c <= 0x1f) || c === 0x7f || (i === 0 && c >= 0x30 && c <= 0x39) || (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2d)) {
      out += "\\" + c.toString(16) + " ";
    } else if (i === 0 && len === 1 && c === 0x2d) {
      out += "\\" + s.charAt(i);
    } else if (c >= 0x80 || c === 0x2d || c === 0x5f || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) {
      out += s.charAt(i);
    } else {
      out += "\\" + s.charAt(i);
    }
  }
  return out;
}

// ── Snippet (opening tag), PII-safe ──

const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "data", "cite", "srcset", "background", "longdesc", "ping", "manifest", "xlink:href", "codebase"]);
const REDACT_ATTR = /(^|[-_:])(value|defaultvalue|token|password|passwd|secret|email|auth|session|csrf|nonce|ssn|phone)([-_:]|$)/i;

function stripUrl(v: string): string {
  const t = v.trim();
  if (/^(data|blob|javascript):/i.test(t)) return t.slice(0, t.indexOf(":") + 1) + "…";
  let out = t;
  const q = out.indexOf("?");
  const h = out.indexOf("#");
  if (q !== -1 && (h === -1 || q < h)) out = out.slice(0, q) + "?…" + (h !== -1 ? out.slice(h) : "");
  const h2 = out.indexOf("#");
  if (h2 !== -1 && out.slice(h2).includes("=")) out = out.slice(0, h2) + "#…";
  return out;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function buildSnippet(tag: string, attrs: ArrayLike<{ name: string; value: string }>, max: number): string {
  let s = "<" + tag;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    const name = a.name;
    let v: string;
    if (!name.startsWith("aria-") && REDACT_ATTR.test(name)) v = "[redacted]";
    else if (URL_ATTRS.has(name)) v = clip(stripUrl(a.value), 80);
    else if (name === "srcdoc" || name === "style" || name === "d" || name === "points") v = clip(a.value, 40);
    else v = clip(a.value, 80);
    s += v === "" && name !== "alt" ? ` ${name}` : ` ${name}="${v.replace(/"/g, "&quot;").replace(/\s+/g, " ")}"`;
    if (s.length > max) break;
  }
  if (s.length + 1 > max) return s.slice(0, max - 2) + "…>";
  return s + ">";
}

/** The element's opening tag, value-like attributes redacted, URL queries stripped, max 200 chars. */
export function snippet(el: Element, max = 200): string {
  return buildSnippet(el.localName, el.attributes, max);
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

/**
 * Same as snippet() for markup text (e.g. an engine's outerHTML / snippet string): only the first
 * opening tag is kept, so no text content, and attributes are redacted like snippet().
 */
export function snippetFromMarkup(markup: string, max = 200): string {
  const m = /<\s*([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/.exec(String(markup || ""));
  if (!m) return "";
  const attrs: Array<{ name: string; value: string }> = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(m[2])) && attrs.length < 50) {
    const raw = a[2] ?? a[3] ?? a[4] ?? "";
    attrs.push({ name: a[1].toLowerCase(), value: raw.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e: string) => ENTITY[e]) });
  }
  return buildSnippet(m[1].toLowerCase(), attrs, max);
}

// ── Per-run cache ──

interface NameState {
  inLabelledBy: boolean;
  includeHidden: boolean;
  depth: number;
}

export interface NameOptions {
  /** Do not fall back to placeholder / aria-placeholder (default true: placeholder is not a label). */
  excludePlaceholder?: boolean;
  /** Do not fall back to the title attribute. */
  excludeTitle?: boolean;
}

export class DomCache {
  readonly doc: Document;
  readonly win: (Window & typeof globalThis) | null;
  private readonly nr = new Map<Element, boolean>();
  private readonly ah = new Map<Element, boolean>();
  private readonly names = new Map<Element, string>();
  private readonly ids = new Map<string, boolean>();
  private readonly nth = new Map<Element, Map<Element, number>>();
  private readonly nthTotal = new Map<Element, Map<string, number>>();
  private readonly useStyles: boolean;
  private readonly hasCheckVisibility: boolean;

  constructor(doc: Document) {
    this.doc = doc;
    this.win = (doc.defaultView as (Window & typeof globalThis) | null) ?? null;
    const probe = doc.documentElement as unknown as { checkVisibility?: unknown } | null;
    this.hasCheckVisibility = !!probe && typeof probe.checkVisibility === "function";
    let sheets = 0;
    try {
      sheets = doc.styleSheets ? doc.styleSheets.length : 0;
    } catch {
      sheets = 0;
    }
    this.useStyles = !!this.win && typeof this.win.getComputedStyle === "function" && sheets > 0;
  }

  /** Not rendered: display:none, visibility:hidden, [hidden], closed <details>, content-visibility:hidden, or no box. */
  notRendered(el: Element): boolean {
    const hit = this.nr.get(el);
    if (hit !== undefined) return hit;
    const v = this.computeNotRendered(el);
    this.nr.set(el, v);
    return v;
  }

  private computeNotRendered(el: Element): boolean {
    if (this.hasCheckVisibility) {
      try {
        return !(el as unknown as { checkVisibility(o: object): boolean }).checkVisibility({ visibilityProperty: true });
      } catch {
        /* fall through */
      }
    }
    const hidden = el.getAttribute("hidden");
    if (hidden !== null && hidden !== "until-found") return true;
    if (UA_HIDDEN.has(el.localName) && el.namespaceURI === "http://www.w3.org/1999/xhtml") return true;
    if (el.localName === "title" || el.localName === "desc") {
      // SVG <title>/<desc> never render.
      if (el.namespaceURI === "http://www.w3.org/2000/svg") return true;
    }
    if (this.win && (this.useStyles || el.hasAttribute("style"))) {
      try {
        const cs = this.win.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return true;
      } catch {
        /* ignore */
      }
    }
    const p = el.parentElement;
    if (p) {
      if (p.localName === "details" && !p.hasAttribute("open") && el.localName !== "summary") return true;
      return this.notRendered(p);
    }
    return false;
  }

  /** Hidden from assistive technology by aria-hidden="true" or inert on the element or an ancestor. */
  ariaHidden(el: Element): boolean {
    const hit = this.ah.get(el);
    if (hit !== undefined) return hit;
    let v = isAriaHiddenAttr(el) || el.hasAttribute("inert");
    if (!v) {
      const p = el.parentElement;
      v = p ? this.ariaHidden(p) : false;
    }
    this.ah.set(el, v);
    return v;
  }

  /** isHidden = not rendered or hidden from assistive technology. */
  isHidden(el: Element): boolean {
    return this.notRendered(el) || this.ariaHidden(el);
  }

  excluded(el: Element, scope: Scope): boolean {
    if (scope === "all") return false;
    if (scope === "rendered") return this.notRendered(el);
    return this.notRendered(el) || this.ariaHidden(el);
  }

  inert(el: Element): boolean {
    return !!closestWithAttr(el, "inert");
  }

  /** Focusable right now: structurally focusable, rendered and not inert. */
  isFocusable(el: Element): boolean {
    return isFocusableStructural(el) && !this.notRendered(el) && !this.inert(el);
  }

  /** Reachable with Tab: focusable with tab index >= 0. */
  isTabbable(el: Element): boolean {
    return this.isFocusable(el) && effectiveTabIndex(el) >= 0;
  }

  // ── Accessible name (accname 1.2, simplified; values of embedded controls are never read) ──

  accessibleName(el: Element, opts?: NameOptions): string {
    const plain = !opts || (opts.excludePlaceholder !== false && !opts.excludeTitle);
    if (plain) {
      const hit = this.names.get(el);
      if (hit !== undefined) return hit;
    }
    let v = "";
    try {
      v = normalizeSpace(this.computeName(el, { inLabelledBy: false, includeHidden: false, depth: 0 }, true, opts || {}));
    } catch {
      v = "";
    }
    if (v.length > 1000) v = v.slice(0, 1000);
    if (plain) this.names.set(el, v);
    return v;
  }

  /** Name from aria-labelledby / aria-label only ("" when neither yields text). */
  ariaName(el: Element): string {
    const ref = el.getAttribute("aria-labelledby");
    if (ref && ref.trim()) {
      const s = this.labelledByText(ref);
      if (s) return s;
    }
    const al = el.getAttribute("aria-label");
    return al ? normalizeSpace(al) : "";
  }

  labelledByText(ref: string): string {
    const parts: string[] = [];
    for (const id of ref.trim().split(/\s+/)) {
      const t = this.doc.getElementById(id);
      if (!t) continue;
      parts.push(this.computeName(t, { inLabelledBy: true, includeHidden: this.isHidden(t), depth: 1 }, true, {}));
    }
    return normalizeSpace(parts.join(" "));
  }

  /** Text alternative of the element's content (text nodes + children's names), skipping hidden children. */
  private texts = new Map<Element, string>();

  textFromContent(el: Element): string {
    const hit = this.texts.get(el);
    if (hit !== undefined) return hit;
    let v = "";
    try {
      v = normalizeSpace(this.content(el, { inLabelledBy: false, includeHidden: false, depth: 1 }, {}));
    } catch {
      v = "";
    }
    this.texts.set(el, v);
    return v;
  }

  private computeName(el: Element, st: NameState, isRoot: boolean, opts: NameOptions): string {
    if (st.depth > 40) return "";
    if (!isRoot && !st.includeHidden && (this.notRendered(el) || isAriaHiddenAttr(el))) return "";
    if (!st.inLabelledBy) {
      const ref = el.getAttribute("aria-labelledby");
      if (ref && ref.trim()) {
        const s = this.labelledByText(ref);
        if (s) return s;
      }
    }
    const role = explicitRole(el);
    if (!isRoot && this.isEmbeddedControl(el, role)) return "";
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return al;
    const presentational = role === "none" || role === "presentation";
    if (!presentational) {
      const n = this.nativeName(el, st, opts);
      if (n !== null) return n;
    }
    const r = role ?? implicitRole(el);
    if (st.inLabelledBy || !isRoot || (r !== null && NAME_FROM_CONTENT_ROLES.has(r)) || el.localName === "label" || el.localName === "legend" || el.localName === "figcaption" || el.localName === "caption" || el.localName === "summary") {
      const c = normalizeSpace(this.content(el, { ...st, depth: st.depth + 1 }, opts));
      if (c) return c;
    }
    if (!opts.excludeTitle) {
      const t = el.getAttribute("title");
      if (t && t.trim()) return t;
    }
    if (isRoot && opts.excludePlaceholder === false) {
      const tag = el.localName;
      if ((tag === "input" && TEXT_INPUT_TYPES.has(inputType(el))) || tag === "textarea") {
        const ph = el.getAttribute("placeholder");
        if (ph && ph.trim()) return ph;
      }
      const aph = el.getAttribute("aria-placeholder");
      if (aph && aph.trim()) return aph;
    }
    return "";
  }

  private isEmbeddedControl(el: Element, role: string | null): boolean {
    const tag = el.localName;
    if (tag === "input") {
      const t = inputType(el);
      return !(t === "button" || t === "submit" || t === "reset" || t === "image");
    }
    if (tag === "textarea" || tag === "select") return true;
    if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "listbox" || role === "slider" || role === "spinbutton" || role === "scrollbar") return true;
    return isContentEditableHost(el);
  }

  private labelMap: Map<string, Element[]> | null = null;

  /**
   * The control's <label>s per HTML: label[for=id] (when the id resolves to this element) plus a
   * wrapping label without a for attribute. One document scan per run instead of `el.labels`,
   * which re-scans the document for every control.
   */
  labelsOf(el: Element): Element[] {
    if (!this.labelMap) {
      this.labelMap = new Map();
      const all = this.doc.getElementsByTagName("label");
      for (let i = 0; i < all.length; i++) {
        const f = all[i].getAttribute("for");
        if (f === null) continue;
        const list = this.labelMap.get(f);
        if (list) list.push(all[i]);
        else this.labelMap.set(f, [all[i]]);
      }
    }
    const found: Element[] = [];
    const id = el.getAttribute("id");
    if (id) {
      const list = this.labelMap.get(id);
      if (list && this.doc.getElementById(id) === el) found.push(...list);
    }
    const wrap = el.parentElement ? closestTag(el.parentElement, "label") : null;
    // A wrapping label (without for=) labels only its first labelable descendant.
    if (wrap && !wrap.hasAttribute("for") && !found.includes(wrap) && findDescendant(wrap, isLabelable) === el) found.push(wrap);
    return found;
  }

  private labelsText(el: Element): string {
    const found = this.labelsOf(el);
    const parts: string[] = [];
    for (const l of found) parts.push(this.content(l, { inLabelledBy: false, includeHidden: false, depth: 1 }, {}));
    return normalizeSpace(parts.join(" "));
  }

  /** Host-language name: string (possibly "" to stop) or null to continue with content/title. */
  private nativeName(el: Element, st: NameState, opts: NameOptions): string | null {
    const tag = el.localName;
    switch (tag) {
      case "input": {
        const t = inputType(el);
        if (t === "hidden") return "";
        if (t === "button" || t === "submit" || t === "reset") {
          const v = el.getAttribute("value");
          if (v && v.trim()) return v;
          const l = this.labelsText(el);
          if (l) return l;
          if (t === "submit") return "Submit";
          if (t === "reset") return "Reset";
          return null;
        }
        if (t === "image") {
          const alt = el.getAttribute("alt");
          if (alt && alt.trim()) return alt;
          return null;
        }
        const l = this.labelsText(el);
        return l || null;
      }
      case "textarea":
      case "select":
      case "meter":
      case "progress":
      case "output": {
        const l = this.labelsText(el);
        return l || null;
      }
      case "button": {
        const l = this.labelsText(el);
        return l || null;
      }
      case "img":
      case "area": {
        const alt = el.getAttribute("alt");
        if (alt === null) return null;
        return alt.trim() ? alt : el.getAttribute("title")?.trim() ? null : "";
      }
      case "fieldset": {
        const lg = childByTag(el, "legend");
        if (lg) {
          const c = normalizeSpace(this.content(lg, { ...st, depth: st.depth + 1 }, opts));
          if (c) return c;
        }
        return null;
      }
      case "figure": {
        const fc = childByTag(el, "figcaption");
        if (fc) {
          const c = normalizeSpace(this.content(fc, { ...st, depth: st.depth + 1 }, opts));
          if (c) return c;
        }
        return null;
      }
      case "table": {
        const cap = childByTag(el, "caption");
        if (cap) {
          const c = normalizeSpace(this.content(cap, { ...st, depth: st.depth + 1 }, opts));
          if (c) return c;
        }
        return null;
      }
      case "svg": {
        for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
          if (c.localName === "title") {
            const t = normalizeSpace(c.textContent || "");
            if (t) return t;
          }
        }
        return null;
      }
      case "optgroup": {
        const l = el.getAttribute("label");
        return l && l.trim() ? l : null;
      }
      case "option": {
        const l = el.getAttribute("label");
        return l && l.trim() ? l : null;
      }
      default:
        return null;
    }
  }

  /**
   * CSS generated content (::before / ::after) is part of the accessible name (accname 2F.ii).
   * Only in real browsers (checkVisibility present): quoted strings and attr() are resolved;
   * counter()/counters() cannot be read back, so they contribute a "#" placeholder.
   */
  private pseudoText(el: Element, which: "::before" | "::after"): string {
    if (!this.hasCheckVisibility || !this.win) return "";
    let c = "";
    try {
      c = this.win.getComputedStyle(el, which).content;
    } catch {
      return "";
    }
    if (!c || c === "none" || c === "normal") return "";
    let out = "";
    const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)|counters?\([^)]*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c))) {
      if (m[1] !== undefined || m[2] !== undefined) out += (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
      else if (m[3]) out += el.getAttribute(m[3]) ?? "";
      else out += "#";
    }
    return out;
  }

  private content(el: Element, st: NameState, opts: NameOptions): string {
    let out = this.pseudoText(el, "::before");
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        out += (n as Text).data;
      } else if (n.nodeType === 1) {
        const c = n as Element;
        const tag = c.localName;
        if (SKIP_CONTENT_TAGS.has(tag)) continue;
        if (tag === "br") {
          out += " ";
          continue;
        }
        if (isContentEditableHost(c)) continue;
        const part = this.computeName(c, { ...st, depth: st.depth + 1 }, false, opts);
        if (part) out += INLINE_TAGS.has(tag) ? part : ` ${part} `;
      }
      if (out.length > 2000) break;
    }
    return out + this.pseudoText(el, "::after");
  }

  // ── Unique selector ──

  private idCounts: Map<string, number> | null = null;

  /** Document-wide id counts collected by the engine's walk (avoids a query per selector). */
  setIdCounts(counts: Map<string, number>): void {
    this.idCounts = counts;
  }

  private isUniqueId(id: string): boolean {
    if (this.idCounts) return this.idCounts.get(id) === 1;
    const hit = this.ids.get(id);
    if (hit !== undefined) return hit;
    let v = false;
    try {
      v = this.doc.querySelectorAll("#" + cssEscape(id)).length === 1;
    } catch {
      v = false;
    }
    this.ids.set(id, v);
    return v;
  }

  private nthOfType(parent: Element, child: Element): [number, number] {
    let m = this.nth.get(parent);
    let totals = this.nthTotal.get(parent);
    if (!m || !totals) {
      m = new Map();
      totals = new Map();
      for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
        const t = c.localName;
        const n = (totals.get(t) || 0) + 1;
        totals.set(t, n);
        m.set(c, n);
      }
      this.nth.set(parent, m);
      this.nthTotal.set(parent, totals);
    }
    return [m.get(child) || 1, totals.get(child.localName) || 1];
  }

  /** Unique, stable CSS path: nearest unique id, then tag names with :nth-of-type where ambiguous. */
  uniqueSelector(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur) {
      const id = cur.getAttribute("id");
      if (id && this.isUniqueId(id)) {
        parts.unshift("#" + cssEscape(id));
        break;
      }
      const tag = cssEscape(cur.localName);
      if (cur === this.doc.documentElement || ((cur.localName === "body" || cur.localName === "head") && cur.parentElement === this.doc.documentElement)) {
        parts.unshift(tag);
        break;
      }
      const parent: Element | null = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const [idx, total] = this.nthOfType(parent, cur);
      parts.unshift(total > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      cur = parent;
    }
    return parts.join(" > ");
  }
}

// ── Standalone helpers (fresh cache per call; the engine uses one shared DomCache) ──

function cacheFor(el: Element, cache?: DomCache): DomCache {
  return cache ?? new DomCache(el.ownerDocument);
}

export function accessibleName(el: Element, cache?: DomCache, opts?: NameOptions): string {
  return cacheFor(el, cache).accessibleName(el, opts);
}

export function isHidden(el: Element, cache?: DomCache): boolean {
  return cacheFor(el, cache).isHidden(el);
}

export function isFocusable(el: Element, cache?: DomCache): boolean {
  return cacheFor(el, cache).isFocusable(el);
}

export function uniqueSelector(el: Element, cache?: DomCache): string {
  return cacheFor(el, cache).uniqueSelector(el);
}
