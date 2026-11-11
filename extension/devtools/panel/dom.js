// DOM helpers. All text goes through textContent / createTextNode — never innerHTML.

const SVG_NS = "http://www.w3.org/2000/svg";

function applyProps(el, props, isSvg) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class" || key === "className") {
      el.setAttribute("class", Array.isArray(value) ? value.filter(Boolean).join(" ") : value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key === "dataset") {
      for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== null) el.dataset[k] = String(v);
    } else if (key === "style" && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined || v === null) continue;
        if (k.startsWith("--")) el.style.setProperty(k, String(v));
        else el.style[k] = v;
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!isSvg && (key === "value" || key === "checked" || key === "disabled" || key === "hidden" || key === "tabIndex")) {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else if (child instanceof Node) el.appendChild(child);
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/** h("div", { class: "x", onClick }, "text", child) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props, false);
  append(el, children);
  return el;
}

/** SVG element builder (same API as h). */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function replaceChildren(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** Text with ellipsis + full value as tooltip. */
export function ellipsis(text, className = "") {
  const t = text === undefined || text === null ? "" : String(text);
  return h("span", { class: `ellipsis ${className}`.trim(), title: t, text: t });
}

// ── Icons: authored SF-Symbols-like glyphs, 16px, stroke 1.5 ─────────

const ICONS = {
  record: [["circle", { cx: 8, cy: 8, r: 4.5, fill: "currentColor", stroke: "none" }]],
  pause: [["path", { d: "M5.5 3.5v9M10.5 3.5v9" }]],
  play: [["path", { d: "M5 3.5v9l7-4.5z", fill: "currentColor" }]],
  trash: [["path", { d: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4" }]],
  export: [["path", { d: "M8 10V2.5M5.2 5.2 8 2.5l2.8 2.7M4.5 7.5H3.5v6h9v-6h-1" }]],
  import: [["path", { d: "M8 2.5V10M5.2 7.3 8 10l2.8-2.7M4.5 7.5H3.5v6h9v-6h-1" }]],
  gauge: [["path", { d: "M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.5-3.5M8 11h.01" }]],
  search: [["circle", { cx: 7, cy: 7, r: 4 }], ["path", { d: "m10 10 3.5 3.5" }]],
  xmark: [["circle", { cx: 8, cy: 8, r: 6, fill: "currentColor", stroke: "none", opacity: 0.35 }], ["path", { d: "m6 6 4 4M10 6l-4 4" }]],
  close: [["path", { d: "m4.5 4.5 7 7M11.5 4.5l-7 7" }]],
  plus: [["path", { d: "M8 3.5v9M3.5 8h9" }]],
  minus: [["path", { d: "M3.5 8h9" }]],
  fit: [["path", { d: "M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" }]],
  overview: [["rect", { x: 2.5, y: 2.5, width: 4.5, height: 4.5, rx: 1 }], ["rect", { x: 9, y: 2.5, width: 4.5, height: 4.5, rx: 1 }], ["rect", { x: 2.5, y: 9, width: 4.5, height: 4.5, rx: 1 }], ["rect", { x: 9, y: 9, width: 4.5, height: 4.5, rx: 1 }]],
  lightbulb: [["path", { d: "M6 12.5h4M6.5 14h3M5.2 9.8A4 4 0 1 1 10.8 9.8c-.6.6-.8 1.2-.8 1.7H6c0-.5-.2-1.1-.8-1.7z" }]],
  timeline: [["path", { d: "M2.5 4h6M5 8h8.5M2.5 12h5" }]],
  waterfall: [["path", { d: "M2.5 3.5h5M4.5 6.5h5M6.5 9.5h4M8.5 12.5h5" }]],
  cube: [["path", { d: "M8 2 13.5 5v6L8 14 2.5 11V5zM2.5 5 8 8l5.5-3M8 8v6" }]],
  globe: [["circle", { cx: 8, cy: 8, r: 5.5 }], ["path", { d: "M2.5 8h11M8 2.5c1.6 1.6 2.3 3.4 2.3 5.5S9.6 11.9 8 13.5C6.4 11.9 5.7 10.1 5.7 8S6.4 4.1 8 2.5z" }]],
  warning: [["path", { d: "M8 2.5 14 13H2zM8 6.5v3M8 11.3h.01" }]],
  bolt: [["path", { d: "M9 2 4 9h3.5L7 14l5-7H8.5z" }]],
  link: [["path", { d: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7" }]],
  arrowRight: [["path", { d: "M3 8h10M9.5 4.5 13 8l-3.5 3.5" }]],
  chevronDown: [["path", { d: "m4.5 6.5 3.5 3.5 3.5-3.5" }]],
  info: [["circle", { cx: 8, cy: 8, r: 5.5 }], ["path", { d: "M8 7.5V11M8 5.2h.01" }]],
  check: [["path", { d: "m3.5 8.5 3 3 6-7" }]],
  hand: [["path", { d: "M5.5 8V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v5c0 2.5-1.5 4.5-4 4.5-1.8 0-2.7-.8-3.8-2.3L2.5 9a1 1 0 0 1 1.6-1.1L5.5 9.5" }]],
  plug: [["path", { d: "M6 2.5V5M10 2.5V5M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v2.5" }]],
  refresh: [["path", { d: "M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" }]],
  help: [["circle", { cx: 8, cy: 8, r: 5.5 }], ["path", { d: "M6.4 6.4a1.7 1.7 0 0 1 3.3.5c0 1.1-1.7 1.4-1.7 2.4M8 11.3h.01" }]],
  copy: [["rect", { x: 5.5, y: 5.5, width: 7.5, height: 8, rx: 1.5 }], ["path", { d: "M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4.5A1.5 1.5 0 0 0 3 4v6a1.5 1.5 0 0 0 1.5 1.5h1" }]],
  lock: [["rect", { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.5 }], ["path", { d: "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" }]],
};

export function icon(name, size = 16, className = "") {
  const parts = ICONS[name] || ICONS.info;
  const svg = s("svg", {
    class: `icon ${className}`.trim(),
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 1.5,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  });
  for (const [tag, attrs] of parts) svg.appendChild(s(tag, attrs));
  return svg;
}

// ── Keyed reconciliation ─────────────────────────────────────────────

const keyedMaps = new WeakMap();

/**
 * Reconcile `parent`'s children against `items`, reusing elements by key so focus,
 * selection and scroll survive updates. `create(item)` builds a node; `update(node, item)`
 * patches it in place.
 */
export function reconcile(parent, items, getKey, create, update) {
  let map = keyedMaps.get(parent);
  if (!map) {
    map = new Map();
    keyedMaps.set(parent, map);
  }
  const nextMap = new Map();
  let cursor = parent.firstChild;
  for (const item of items) {
    const key = getKey(item);
    let node = map.get(key);
    if (node) {
      update(node, item);
    } else {
      node = create(item);
      update(node, item);
    }
    nextMap.set(key, node);
    if (node !== cursor) parent.insertBefore(node, cursor);
    else cursor = cursor.nextSibling;
  }
  // Every kept node now sits before `cursor`; whatever remains after it (stale keyed
  // nodes or unkeyed strays) is removed.
  while (cursor) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
  keyedMaps.set(parent, nextMap);
}

/** Set textContent only when it changed (avoids layout churn). */
export function setText(el, text) {
  const t = text === undefined || text === null ? "" : String(text);
  if (el.textContent !== t) el.textContent = t;
}

export function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Empty-state block used across views. */
export function emptyState({ iconName = "info", title, body, action }) {
  return h(
    "div",
    { class: "empty", role: "status" },
    h("div", { class: "empty-icon" }, icon(iconName, 28)),
    h("p", { class: "empty-title", text: title }),
    body ? (typeof body === "string" ? h("p", { class: "empty-body", text: body }) : body) : null,
    action || null,
  );
}

/** Segmented control (single choice). Returns { el, set(value) }. */
export function segmented({ options, value, onChange, label, className = "" }) {
  const el = h("div", { class: `segmented ${className}`.trim(), role: "radiogroup", "aria-label": label });
  const buttons = options.map((opt) => {
    const btn = h(
      "button",
      {
        type: "button",
        role: "radio",
        class: "segment",
        dataset: { value: opt.value },
        title: opt.title || opt.label,
        onClick: () => {
          set(opt.value);
          onChange(opt.value);
        },
      },
      opt.icon ? icon(opt.icon, 14) : null,
      opt.label ? h("span", { text: opt.label }) : null,
      opt.count !== undefined ? h("span", { class: "segment-count", text: opt.count }) : null,
    );
    el.appendChild(btn);
    return btn;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const next = buttons[(idx + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
    next.click();
    next.focus();
    e.preventDefault();
  });
  function set(v) {
    for (const b of buttons) {
      const on = b.dataset.value === String(v);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
  }
  set(value);
  return { el, set, buttons };
}

/** Search field with magnifier + clear button. Returns { el, input, set(value) }. */
export function searchField({ placeholder, value = "", onInput, label }) {
  const input = h("input", {
    type: "search",
    class: "search-input",
    placeholder,
    value,
    "aria-label": label || placeholder,
    spellcheck: "false",
    autocomplete: "off",
  });
  const clearBtn = h("button", { type: "button", class: "search-clear", title: "Clear search", "aria-label": "Clear search" }, icon("xmark", 14));
  const el = h("div", { class: "search", dataset: { search: "" } }, icon("search", 14, "search-icon"), input, clearBtn);
  const sync = () => el.classList.toggle("has-value", input.value.length > 0);
  input.addEventListener("input", () => {
    sync();
    onInput(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (input.value) {
        input.value = "";
        sync();
        onInput("");
      } else input.blur();
      e.stopPropagation();
      e.preventDefault();
    }
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    sync();
    onInput("");
    input.focus();
  });
  sync();
  return {
    el,
    input,
    set(v) {
      if (input.value !== v) {
        input.value = v;
        sync();
      }
    },
  };
}

/** Sortable table header helper. */
export function sortHeader(columns, sort, onSort) {
  const tr = h("tr");
  for (const col of columns) {
    const active = sort.key === col.key;
    const th = h("th", {
      scope: "col",
      class: [col.className, col.sortable === false ? "" : "sortable", active ? "sorted" : ""],
      "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : col.sortable === false ? undefined : "none",
    });
    if (col.sortable === false) {
      th.textContent = col.label;
    } else {
      th.appendChild(
        h(
          "button",
          {
            type: "button",
            class: "th-btn",
            onClick: () => onSort(col.key, active ? (sort.dir === "asc" ? "desc" : "asc") : col.defaultDir || "desc"),
          },
          h("span", { text: col.label }),
          h("span", { class: "sort-arrow", "aria-hidden": "true", text: active ? (sort.dir === "asc" ? "▲" : "▼") : "" }),
        ),
      );
    }
    tr.appendChild(th);
  }
  return h("thead", null, tr);
}

/** Keyboard navigation for a listbox/table body: ↑/↓/Home/End move, Enter activates. */
export function listKeyNav(container, { itemSelector, onMove, onActivate }) {
  container.addEventListener("keydown", (e) => {
    const items = [...container.querySelectorAll(itemSelector)];
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, current + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, current === -1 ? 0 : current - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Enter" && current >= 0) {
      onActivate?.(items[current]);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    const el = items[next];
    el.focus();
    el.scrollIntoView({ block: "nearest" });
    onMove?.(el);
  });
}

/**
 * Copies text to the clipboard. The Clipboard API is often blocked inside DevTools panels, so a
 * selection copy runs first (synchronously, inside the user gesture), the async API second.
 * Resolves to true on success.
 */
export function copyText(text) {
  let ok = false;
  const ta = h("textarea", { "aria-hidden": "true", tabIndex: -1, readonly: true, style: { position: "fixed", top: "-1000px", left: "0", opacity: "0" } });
  ta.value = String(text);
  const prevFocus = document.activeElement;
  document.body.appendChild(ta);
  try {
    ta.select();
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (prevFocus instanceof HTMLElement) prevFocus.focus({ preventScroll: true });
  if (ok) return Promise.resolve(true);
  try {
    return navigator.clipboard.writeText(String(text)).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Button that copies `getText()` and briefly confirms ("Copied" / "Copy failed"). */
export function copyButton({ label = "Copy", title, getText, className = "btn" }) {
  const text = h("span", { text: label });
  const btn = h("button", { type: "button", class: className, title: title || label }, icon("copy", 14), text);
  let timer = 0;
  btn.addEventListener("click", () => {
    let value = "";
    try {
      value = getText();
    } catch {
      value = "";
    }
    copyText(value).then((ok) => {
      text.textContent = ok ? "Copied" : "Copy failed";
      btn.classList.toggle("is-copied", ok);
      clearTimeout(timer);
      timer = setTimeout(() => {
        text.textContent = label;
        btn.classList.remove("is-copied");
      }, 1600);
    });
  });
  return btn;
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, hidden: true });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
