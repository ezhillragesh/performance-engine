/**
 * DOM helpers shared by trackers. All functions are defensive: they never
 * throw and work with SVG elements (`className` is an SVGAnimatedString there).
 */

const MAX_LABEL_LENGTH = 60;

function isElement(value: unknown): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function classList(el: Element): string[] {
  const raw = el.getAttribute("class");
  if (!raw) return [];
  return raw.trim().split(/\s+/).filter(Boolean);
}

/** Short CSS-like descriptor, e.g. `button#save.primary.large`. */
export function describeTarget(target: EventTarget | null | undefined): string {
  try {
    if (!isElement(target)) {
      if (typeof Document !== "undefined" && target instanceof Document) return "document";
      if (typeof Window !== "undefined" && target instanceof Window) return "window";
      return "unknown";
    }
    const tag = target.tagName.toLowerCase();
    const id = target.id ? `#${target.id}` : "";
    const classes = classList(target).slice(0, 2);
    const cls = classes.length > 0 ? `.${classes.join(".")}` : "";
    return `${tag}${id}${cls}`;
  } catch {
    return "unknown";
  }
}

function clean(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > MAX_LABEL_LENGTH ? `${collapsed.slice(0, MAX_LABEL_LENGTH - 1)}…` : collapsed;
}

const FORM_FIELD_TAGS = new Set(["input", "textarea", "select"]);

/**
 * Human label: aria-label, title, then (bounded) text content. Form field
 * values and contenteditable text are never read (PII). Text nodes are read
 * directly instead of `innerText`, which forces a synchronous layout on every
 * captured event.
 */
export function describeLabel(target: EventTarget | null | undefined): string | undefined {
  try {
    if (!isElement(target)) return undefined;
    const aria = clean(target.getAttribute("aria-label"));
    if (aria) return aria;
    const title = clean(target.getAttribute("title"));
    if (title) return title;
    const tag = target.tagName.toLowerCase();
    if (FORM_FIELD_TAGS.has(tag)) {
      return clean(target.getAttribute("name")) ?? clean(target.getAttribute("placeholder"));
    }
    // Page-level targets are containers, never labels (and reading their text
    // would walk the whole document on every keystroke).
    if (tag === "body" || tag === "html") return undefined;
    // Rich-text editors: the text is what the user typed (PII), like a field value.
    if (isEditable(target)) return undefined;
    return clean(boundedText(target, TEXT_SCAN_LIMIT));
  } catch {
    return undefined;
  }
}

/** `<input type>`s that take typed text (the empty string is the default type, text). */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);
const TEXT_ENTRY_ROLES: ReadonlySet<string> = new Set(["textbox", "searchbox", "combobox"]);

/**
 * True when `target` takes text entry: a text-like `<input>`, a `<textarea>`,
 * contenteditable content, or an element with role textbox / searchbox /
 * combobox. Reads only the element type and attributes, never the value.
 */
export function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  try {
    if (!isElement(target)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      // The `type` property normalises unknown types to "text"; fall back to the attribute (SVG / test DOMs).
      const prop = (target as Element & { type?: unknown }).type;
      const type = typeof prop === "string" ? prop : (target.getAttribute("type") ?? "");
      return TEXT_INPUT_TYPES.has(type.trim().toLowerCase());
    }
    const role = (target.getAttribute("role") ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (TEXT_ENTRY_ROLES.has(role)) return true;
    return isEditable(target);
  } catch {
    return false;
  }
}

/** A subtree with more text than this is a container, not a label. */
const TEXT_SCAN_LIMIT = 2000;
/** Max nodes visited, so a huge subtree with little text is still cheap. */
const NODE_SCAN_LIMIT = 200;

function isEditable(el: Element): boolean {
  const html = el as Element & { isContentEditable?: boolean };
  if (html.isContentEditable === true) return true;
  // jsdom/SVG fallbacks: an explicit contenteditable ancestor.
  const editable = typeof el.closest === "function" ? el.closest("[contenteditable]") : null;
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

/**
 * Text of `el`'s subtree, visiting at most NODE_SCAN_LIMIT nodes instead of
 * materialising `textContent` for arbitrarily large trees. Returns undefined
 * when the subtree holds more than `limit` characters (a container).
 */
function boundedText(el: Element, limit: number): string | undefined {
  let out = "";
  let visited = 0;
  const stack: Node[] = [el];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visited += 1;
    if (visited > NODE_SCAN_LIMIT) return undefined; // a container, not a label
    if (node.nodeType === 3 /* TEXT_NODE */) {
      out += node.nodeValue ?? "";
      if (out.length > limit) return undefined;
      continue;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
  }
  return out;
}
