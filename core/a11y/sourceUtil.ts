// Helpers shared by the engine adapters (ibm.ts, axe.ts): element resolution, selectors, hashing,
// page metadata. DOM access only on the elements handed in; never mutates the page.
import { DomCache } from "./dom.js";
import type { A11yImpact, A11yKind, A11ySeverityTag } from "./types.js";

export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const nowMs: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();

export const IMPACT_RANK: Record<A11yImpact, number> = { critical: 0, major: 1, minor: 2, info: 3 };

export const SEVERITY_FOR_IMPACT: Record<A11yImpact, A11ySeverityTag> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Best Practice",
};

export function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Node).nodeType === 1;
}

export function isDocument(n: unknown): n is Document {
  return !!n && typeof n === "object" && (n as Node).nodeType === 9;
}

export function docOf(root: Document | Element | null | undefined): Document | null {
  if (!root) return typeof document !== "undefined" ? document : null;
  return isDocument(root) ? root : root.ownerDocument;
}

export function pageUrl(doc: Document | null): string {
  if (!doc) return "";
  try {
    const loc = doc.defaultView?.location;
    if (loc && loc.origin && loc.origin !== "null") return loc.origin + loc.pathname;
    const u = new URL(doc.URL);
    return (u.origin !== "null" ? u.origin : u.protocol) + u.pathname;
  } catch {
    return "";
  }
}

export function pageTitle(doc: Document | null): string {
  try {
    return doc ? String(doc.title || "").trim().slice(0, 200) : "";
  } catch {
    return "";
  }
}

/**
 * Resolves an XPath such as "/html[1]/body[1]/div[2]/#document-fragment[1]/span[1]" (the form
 * accessibility engines report) by walking element children, shadow roots and same-origin frame
 * documents. The first step always maps to documentElement (some engines count the doctype).
 */
export function resolveXPath(doc: Document, xpath: string): Element | null {
  try {
    const steps = String(xpath || "").split("/").filter(Boolean);
    if (!steps.length) return null;
    let cur: Element | Document | ShadowRoot | null = doc.documentElement;
    for (let i = 1; i < steps.length && cur; i++) {
      const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(steps[i]);
      if (!m) return null;
      const name = m[1].toLowerCase();
      const idx = m[2] ? Number(m[2]) : 1;
      if (name === "#document-fragment") {
        cur = isElement(cur) ? cur.shadowRoot : null;
        continue;
      }
      if (name === "#document") {
        const d: Document | null | undefined = isElement(cur) ? (cur as HTMLIFrameElement).contentDocument : null;
        cur = d ? d : null;
        continue;
      }
      const local = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
      // Frame content without an explicit "#document" step: /…/iframe[1]/html[1]/…
      if (isElement(cur) && (cur.localName === "iframe" || cur.localName === "frame")) {
        let fd: Document | null = null;
        try {
          fd = (cur as HTMLIFrameElement).contentDocument;
        } catch {
          fd = null;
        }
        if (!fd) return null;
        cur = local === "html" ? fd.documentElement : fd;
        if (local === "html") continue;
      }
      let n = 0;
      let found: Element | null = null;
      const parent: ParentNode = isDocument(cur) ? cur : (cur as ParentNode);
      for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName.toLowerCase() === local && ++n === idx) {
          found = c;
          break;
        }
      }
      if (!found && isDocument(cur as unknown)) found = (cur as unknown as Document).documentElement;
      cur = found;
    }
    return isElement(cur) ? cur : null;
  } catch {
    return null;
  }
}

/** Document-level CSS path for elements in `doc` itself (not in shadow trees / other frames). */
export function selectorFor(el: Element | null, dom: DomCache): string {
  if (!el) return "";
  try {
    if (el.ownerDocument !== dom.doc) return "";
    const root = typeof el.getRootNode === "function" ? el.getRootNode() : dom.doc;
    if (root !== dom.doc) return "";
    return dom.uniqueSelector(el);
  } catch {
    return "";
  }
}

function xpathStep(el: Element, parent: ParentNode): string {
  let idx = 0;
  const name = el.localName;
  for (let c = parent.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) idx++;
    if (c === el) break;
  }
  return `${name}[${Math.max(1, idx)}]`;
}

/**
 * Our own XPath for an element, in the form resolveXPath() reads back: shadow roots are a
 * "#document-fragment[1]" step, same-origin frame content continues after the frame element
 * ("/…/iframe[1]/html[1]/body[1]/…"). "" for detached elements.
 */
export function canonicalXPath(el: Element | null): string {
  if (!el) return "";
  try {
    const steps: string[] = [];
    let cur: Element | null = el;
    for (let guard = 0; cur && guard < 1000; guard++) {
      const parent: Node | null = cur.parentNode;
      if (!parent) return "";
      if (parent.nodeType === 9) {
        steps.unshift("html[1]");
        let frame: Element | null = null;
        try {
          frame = (parent as Document).defaultView?.frameElement ?? null;
        } catch {
          frame = null;
        }
        cur = frame;
        continue;
      }
      steps.unshift(xpathStep(cur, parent as ParentNode));
      if (parent.nodeType === 11) {
        steps.unshift("#document-fragment[1]");
        cur = (parent as ShadowRoot).host ?? null;
        if (!cur) return "";
        continue;
      }
      cur = parent as Element;
    }
    return "/" + steps.join("/");
  } catch {
    return "";
  }
}

/**
 * The one selector a finding shows for an element, whichever engine reported it: our unique CSS
 * path for elements of `dom.doc`, else our XPath (shadow DOM, frames). `xpath` is set in the latter case.
 */
export function canonicalSelector(el: Element | null, dom: DomCache | null): { selector: string; xpath?: string } {
  if (!el) return { selector: "" };
  const css = dom ? selectorFor(el, dom) : "";
  if (css) return { selector: css };
  const xp = canonicalXPath(el);
  return xp ? { selector: xp, xpath: xp } : { selector: "" };
}

const NO_PREVIEW = new Set(["html", "head", "body", "input", "textarea", "select", "option", "optgroup", "datalist", "output", "script", "style", "noscript", "template", "meta", "link", "title", "iframe", "frame", "object", "embed"]);
const FIELDS = 'input,textarea,select,[contenteditable]:not([contenteditable="false" i])';
const MAX_PREVIEW_DESCENDANTS = 150;

const NO_TEXT_PARENTS = new Set(["script", "style", "template", "noscript"]);

/** Text nodes of `el` joined with spaces (textContent glues "hide", "v", "t" into "hidevt"). */
function textOf(el: Element): string {
  const parts: string[] = [];
  let len = 0;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n && len < 200; n = walker.nextNode()) {
    if (NO_TEXT_PARENTS.has(n.parentElement?.localName ?? "")) continue;
    const v = n.nodeValue || "";
    if (!v.trim()) continue;
    parts.push(v);
    len += v.length;
  }
  return parts.join(" ");
}

/**
 * Short preview of what the element says (aria name, alt, text, title), max `max` chars, for telling
 * similar findings apart in the list. PII guard: nothing for form fields, their options, elements
 * inside or containing fields / contenteditable content (their text can echo user input), the page
 * root, or large containers; textContent only (never innerText).
 */
export function namePreview(el: Element | null, dom: DomCache | null, memo?: Map<Element, string>, max = 60): string {
  if (!el) return "";
  const hit = memo?.get(el);
  if (hit !== undefined) return hit;
  let out = "";
  try {
    if (!NO_PREVIEW.has(el.localName) && !el.closest(FIELDS) && !el.querySelector(FIELDS)) {
      let t = "";
      const inDoc = !!dom && el.ownerDocument === dom.doc && el.getRootNode() === dom.doc;
      if (inDoc) t = dom!.ariaName(el);
      else t = el.getAttribute("aria-label") || "";
      if (!t) t = el.getAttribute("alt") || "";
      if (!t && el.getElementsByTagName("*").length <= MAX_PREVIEW_DESCENDANTS) t = textOf(el);
      if (!t.trim()) t = el.getAttribute("title") || "";
      t = t.replace(/\s+/g, " ").trim();
      out = t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
    }
  } catch {
    out = "";
  }
  memo?.set(el, out);
  return out;
}

/** Per-run memo for elementPosition(): parent -> child element -> 1-based index. */
export type PositionMemo = WeakMap<object, Map<Element, number>>;

function childIndex(parent: ParentNode, el: Element, memo: PositionMemo): number {
  let m = memo.get(parent);
  if (!m) {
    m = new Map();
    let i = 0;
    for (let c = parent.firstElementChild; c; c = c.nextElementSibling) m.set(c, ++i);
    memo.set(parent, m);
  }
  return m.get(el) ?? 0;
}

/**
 * Position of an element in the composed tree as dot-separated element-child indices from the
 * top document ("1.2.4.1"): a shadow root is step 0 of its host (before the light children), a
 * same-origin frame's document continues after the frame element. Comparing positions step by step
 * gives document order, and an ancestor's position is a prefix of its descendants' (no DOM needed,
 * so the merge can use it in the DevTools panel). "" for detached elements.
 */
export function elementPosition(el: Element | null, memo: PositionMemo = new WeakMap()): string {
  if (!el) return "";
  try {
    const steps: number[] = [];
    let cur: Element | null = el;
    for (let guard = 0; cur && guard < 1000; guard++) {
      const parent: Node | null = cur.parentNode;
      if (!parent) return "";
      if (parent.nodeType === 9) {
        steps.push(1);
        let frame: Element | null = null;
        try {
          frame = (parent as Document).defaultView?.frameElement ?? null;
        } catch {
          frame = null;
        }
        cur = frame;
        continue;
      }
      steps.push(childIndex(parent as ParentNode, cur, memo));
      if (parent.nodeType === 11) {
        steps.push(0);
        cur = (parent as ShadowRoot).host ?? null;
        if (!cur) return "";
        continue;
      }
      cur = parent as Element;
    }
    return steps.reverse().join(".");
  } catch {
    return "";
  }
}

/** Document order of two elementPosition() values (-1, 0, 1); "" sorts last. */
export function comparePositions(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** True when position `inner` is strictly inside position `outer`. */
export function positionContains(outer: string | undefined, inner: string | undefined): boolean {
  return !!outer && !!inner && inner.length > outer.length && inner.startsWith(outer + ".");
}

// ── Node identity ──
// The engines describe the same element differently (a CSS path, an XPath through a shadow root,
// axe's "host >>> inner" target), so the merge keys findings by the live element instead: every
// adapter of one bundle asks this registry for the element's key while it still holds the element.
// The random prefix keeps keys from different registries (a re-injected bundle, another page) apart.
const NODE_KEYS = new WeakMap<object, string>();
const NODE_REFS = new Map<string, { deref(): Element | undefined }>();
const NODE_PREFIX = "n" + Math.random().toString(36).slice(2, 7) + (Date.now() % 1e6).toString(36);
const MAX_NODE_REFS = 20_000;
let nodeSeq = 0;

/** Stable per-page identity of an element (same element -> same key in every engine report). */
export function nodeKey(el: Element | null | undefined): string {
  if (!isElement(el)) return "";
  let k = NODE_KEYS.get(el);
  if (!k) {
    k = `${NODE_PREFIX}:${(++nodeSeq).toString(36)}`;
    NODE_KEYS.set(el, k);
    if (typeof WeakRef === "function") {
      if (NODE_REFS.size >= MAX_NODE_REFS) for (const [key, ref] of NODE_REFS) if (!ref.deref()?.isConnected) NODE_REFS.delete(key);
      if (NODE_REFS.size < MAX_NODE_REFS) NODE_REFS.set(k, new WeakRef(el));
    }
  }
  return k;
}

/** The live, connected element for a nodeKey() of this registry, or null. */
export function elementForNodeKey(key: string): Element | null {
  const el = typeof key === "string" ? NODE_REFS.get(key)?.deref() : undefined;
  return el && el.isConnected ? el : null;
}

export const KIND_RANK: Record<A11yKind, number> = { error: 0, review: 1, warning: 2 };
