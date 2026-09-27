// ARIA vocabulary tables. The base lists come from the source rules (a11yinspect aria-element-*,
// focus-element-*, role-props-element-*); runtime additions from WAI-ARIA 1.2/1.3, Graphics-ARIA
// and DPUB-ARIA are marked so false positives on valid modern markup are avoided.

/** Roles listed in the source rule (aria-element-error.js). */
const SOURCE_ROLES = [
  "alert", "alertdialog", "application", "article", "banner", "button",
  "checkbox", "columnheader", "combobox", "complementary", "contentinfo",
  "definition", "dialog", "directory", "document", "feed", "figure", "form",
  "grid", "gridcell", "group", "heading", "img", "link", "list", "listbox",
  "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option",
  "presentation", "progressbar", "radio", "radiogroup", "region", "row",
  "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator",
  "slider", "spinbutton", "status", "switch", "tab", "table", "tablist",
  "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip", "tree",
  "treegrid", "treeitem",
];

/** Runtime addition: valid roles the source list omits (ARIA 1.2/1.3, Graphics-ARIA, DPUB-ARIA). */
const EXTRA_ROLES = [
  "cell", "generic", "meter", "blockquote", "caption", "code", "deletion", "emphasis",
  "insertion", "paragraph", "strong", "subscript", "superscript", "time", "comment",
  "mark", "suggestion", "image",
  "graphics-document", "graphics-object", "graphics-symbol",
  "doc-abstract", "doc-acknowledgments", "doc-afterword", "doc-appendix", "doc-backlink",
  "doc-biblioentry", "doc-bibliography", "doc-biblioref", "doc-chapter", "doc-colophon",
  "doc-conclusion", "doc-cover", "doc-credit", "doc-credits", "doc-dedication", "doc-endnote",
  "doc-endnotes", "doc-epigraph", "doc-epilogue", "doc-errata", "doc-example", "doc-footnote",
  "doc-foreword", "doc-glossary", "doc-glossref", "doc-index", "doc-introduction", "doc-noteref",
  "doc-notice", "doc-pagebreak", "doc-pagefooter", "doc-pageheader", "doc-pagelist", "doc-part",
  "doc-preface", "doc-prologue", "doc-pullquote", "doc-qna", "doc-subtitle", "doc-tip", "doc-toc",
];

export const VALID_ROLES: ReadonlySet<string> = new Set([...SOURCE_ROLES, ...EXTRA_ROLES]);

export const VALID_ARIA_PROPS: ReadonlySet<string> = new Set([
  "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-busy",
  "aria-checked", "aria-colcount", "aria-colindex", "aria-colspan",
  "aria-controls", "aria-current", "aria-describedby", "aria-description",
  "aria-details", "aria-disabled", "aria-dropeffect", "aria-errormessage",
  "aria-expanded", "aria-flowto", "aria-grabbed", "aria-haspopup",
  "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label",
  "aria-labelledby", "aria-level", "aria-live", "aria-modal",
  "aria-multiline", "aria-multiselectable", "aria-orientation", "aria-owns",
  "aria-placeholder", "aria-posinset", "aria-pressed", "aria-readonly",
  "aria-relevant", "aria-required", "aria-roledescription", "aria-rowcount",
  "aria-rowindex", "aria-rowspan", "aria-selected", "aria-setsize",
  "aria-sort", "aria-valuemax", "aria-valuemin", "aria-valuenow",
  "aria-valuetext", "aria-braillelabel", "aria-brailleroledescription",
  // Runtime addition (ARIA 1.3 drafts, already shipped in Chromium):
  "aria-colindextext", "aria-rowindextext",
]);

type ValueType = "boolean" | "tristate" | "integer" | "number" | readonly string[];

/** Value grammar per attribute (source table, with "undefined" allowed where ARIA allows it). */
export const ARIA_VALUE_TYPES: Readonly<Record<string, ValueType>> = {
  "aria-atomic": "boolean", "aria-busy": "boolean", "aria-disabled": "boolean", "aria-grabbed": "boolean",
  "aria-modal": "boolean", "aria-multiline": "boolean", "aria-multiselectable": "boolean",
  "aria-readonly": "boolean", "aria-required": "boolean",
  "aria-hidden": ["true", "false", "undefined"],
  "aria-checked": "tristate", "aria-pressed": "tristate",
  "aria-autocomplete": ["inline", "list", "both", "none"],
  "aria-current": ["page", "step", "location", "date", "time", "true", "false"],
  "aria-dropeffect": ["copy", "execute", "link", "move", "none", "popup"],
  "aria-haspopup": ["true", "false", "menu", "listbox", "tree", "grid", "dialog"],
  "aria-invalid": ["grammar", "spelling", "true", "false"],
  "aria-live": ["assertive", "off", "polite"],
  "aria-orientation": ["horizontal", "vertical", "undefined"],
  "aria-sort": ["ascending", "descending", "none", "other"],
  "aria-expanded": ["true", "false", "undefined"],
  "aria-selected": ["true", "false", "undefined"],
  "aria-colcount": "integer", "aria-colindex": "integer", "aria-colspan": "integer", "aria-level": "integer",
  "aria-posinset": "integer", "aria-rowcount": "integer", "aria-rowindex": "integer", "aria-rowspan": "integer",
  "aria-setsize": "integer",
  "aria-valuemax": "number", "aria-valuemin": "number", "aria-valuenow": "number",
};

/** Returns true when `value` is valid for `name` (unknown/free-text attributes are always valid). */
export function isValidAriaValue(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (name === "aria-relevant") {
    // Token list: "all" alone, or any combination of additions/removals/text (runtime: full grammar).
    if (v === "all") return true;
    const parts = v.split(/\s+/);
    return parts.length > 0 && parts.every((p) => p === "additions" || p === "removals" || p === "text");
  }
  const t = ARIA_VALUE_TYPES[name];
  if (!t) return true;
  if (t === "boolean") return v === "true" || v === "false";
  if (t === "tristate") return v === "true" || v === "false" || v === "mixed";
  if (t === "integer") return /^-?\d+$/.test(v);
  if (t === "number") return /^-?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/.test(v);
  return t.includes(v);
}

export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button", "checkbox", "combobox", "gridcell", "link", "listbox", "menu",
  "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  "radio", "radiogroup", "scrollbar", "searchbox", "slider", "spinbutton",
  "switch", "tab", "textbox", "treeitem",
]);

export const NONINTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "alert", "article", "banner", "complementary", "contentinfo", "definition",
  "dialog", "directory", "document", "feed", "figure", "form", "group",
  "heading", "img", "list", "listitem", "log", "main", "marquee", "math",
  "navigation", "none", "note", "presentation", "region", "row", "rowgroup",
  "separator", "status", "table", "term", "timer", "toolbar", "tooltip",
]);

export const NONINTERACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  "article", "aside", "blockquote", "caption", "dd", "details", "div",
  "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main",
  "nav", "ol", "p", "pre", "section", "span", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul",
]);

/**
 * Runtime refinement: WAI-ARIA composite-widget patterns where a non-interactive element legitimately
 * carries an interactive role (e.g. <li role="tab">, <ul role="listbox">, <td role="gridcell">).
 */
export const ALLOWED_INTERACTIVE_ROLE_ON: Readonly<Record<string, readonly string[]>> = {
  li: ["menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "tab", "treeitem", "checkbox", "row"],
  ul: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid", "grid"],
  ol: ["listbox", "menu", "menubar", "radiogroup", "tablist", "tree", "treegrid", "grid"],
  table: ["grid", "treegrid"],
  td: ["gridcell"],
  th: ["gridcell"],
  fieldset: ["radiogroup"],
  tr: ["row"],
};

export const ROLE_TO_SEMANTIC_ELEMENT: Readonly<Record<string, string>> = {
  button: "<button>", link: "<a>", heading: "<h1>-<h6>",
  navigation: "<nav>", main: "<main>", complementary: "<aside>",
  contentinfo: "<footer>", banner: "<header>", list: "<ul> or <ol>",
  listitem: "<li>", img: "<img>", form: "<form>",
  textbox: "<input> or <textarea>", table: "<table>",
  article: "<article>", region: "<section>",
};

/** role-props-element-error.js */
export const ROLE_REQUIRED_PROPS: Readonly<Record<string, readonly string[]>> = {
  checkbox: ["aria-checked"],
  combobox: ["aria-expanded"],
  heading: ["aria-level"],
  meter: ["aria-valuenow"],
  option: ["aria-selected"],
  radio: ["aria-checked"],
  scrollbar: ["aria-controls", "aria-valuenow"],
  slider: ["aria-valuenow"],
  spinbutton: ["aria-valuenow"],
  switch: ["aria-checked"],
  separator: [],
};

/** Global props from role-props-element-warning.js plus ARIA 1.2 globals it misses (runtime addition). */
export const GLOBAL_ARIA_PROPS: ReadonlySet<string> = new Set([
  "aria-atomic", "aria-busy", "aria-controls", "aria-describedby", "aria-details",
  "aria-disabled", "aria-dropeffect", "aria-errormessage", "aria-flowto", "aria-grabbed",
  "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label",
  "aria-labelledby", "aria-live", "aria-owns", "aria-relevant", "aria-roledescription",
  "aria-current", "aria-description", "aria-braillelabel", "aria-brailleroledescription",
]);

const P = (s: string): readonly string[] => s.split(" ");

/** role-props-element-warning.js supported-props table. */
export const ROLE_SUPPORTED_PROPS: Readonly<Record<string, readonly string[]>> = {
  alert: P("aria-atomic aria-busy aria-controls aria-describedby aria-details aria-flowto aria-hidden aria-label aria-labelledby aria-live aria-owns aria-relevant aria-roledescription"),
  button: P("aria-atomic aria-busy aria-controls aria-describedby aria-details aria-disabled aria-expanded aria-flowto aria-haspopup aria-hidden aria-label aria-labelledby aria-owns aria-pressed aria-roledescription"),
  checkbox: P("aria-atomic aria-busy aria-checked aria-controls aria-describedby aria-details aria-disabled aria-errormessage aria-expanded aria-flowto aria-hidden aria-invalid aria-label aria-labelledby aria-owns aria-readonly aria-required aria-roledescription"),
  combobox: P("aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-controls aria-describedby aria-details aria-disabled aria-errormessage aria-expanded aria-flowto aria-haspopup aria-hidden aria-invalid aria-label aria-labelledby aria-owns aria-readonly aria-required aria-roledescription"),
  dialog: P("aria-atomic aria-busy aria-describedby aria-details aria-flowto aria-hidden aria-label aria-labelledby aria-modal aria-owns aria-roledescription"),
  grid: P("aria-activedescendant aria-atomic aria-busy aria-colcount aria-describedby aria-details aria-disabled aria-flowto aria-hidden aria-label aria-labelledby aria-multiselectable aria-owns aria-readonly aria-roledescription aria-rowcount"),
  img: P("aria-atomic aria-busy aria-describedby aria-details aria-flowto aria-hidden aria-label aria-labelledby aria-owns aria-roledescription"),
  link: P("aria-atomic aria-busy aria-controls aria-describedby aria-details aria-disabled aria-expanded aria-flowto aria-haspopup aria-hidden aria-label aria-labelledby aria-owns aria-roledescription"),
  listbox: P("aria-activedescendant aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-errormessage aria-expanded aria-flowto aria-hidden aria-invalid aria-label aria-labelledby aria-multiselectable aria-orientation aria-owns aria-readonly aria-required aria-roledescription"),
  menu: P("aria-activedescendant aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-flowto aria-hidden aria-label aria-labelledby aria-orientation aria-owns aria-roledescription"),
  menuitem: P("aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-expanded aria-flowto aria-haspopup aria-hidden aria-label aria-labelledby aria-owns aria-posinset aria-roledescription aria-setsize"),
  option: P("aria-atomic aria-busy aria-checked aria-describedby aria-details aria-disabled aria-flowto aria-hidden aria-label aria-labelledby aria-owns aria-posinset aria-roledescription aria-selected aria-setsize"),
  progressbar: P("aria-atomic aria-busy aria-describedby aria-details aria-flowto aria-hidden aria-label aria-labelledby aria-owns aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"),
  radio: P("aria-atomic aria-busy aria-checked aria-describedby aria-details aria-disabled aria-flowto aria-hidden aria-label aria-labelledby aria-owns aria-posinset aria-roledescription aria-setsize"),
  slider: P("aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-errormessage aria-flowto aria-haspopup aria-hidden aria-invalid aria-label aria-labelledby aria-orientation aria-owns aria-readonly aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"),
  spinbutton: P("aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-errormessage aria-flowto aria-hidden aria-invalid aria-label aria-labelledby aria-owns aria-readonly aria-required aria-roledescription aria-valuemax aria-valuemin aria-valuenow aria-valuetext"),
  switch: P("aria-atomic aria-busy aria-checked aria-controls aria-describedby aria-details aria-disabled aria-errormessage aria-expanded aria-flowto aria-hidden aria-invalid aria-label aria-labelledby aria-owns aria-readonly aria-required aria-roledescription"),
  tab: P("aria-atomic aria-busy aria-controls aria-describedby aria-details aria-disabled aria-expanded aria-flowto aria-haspopup aria-hidden aria-label aria-labelledby aria-owns aria-posinset aria-roledescription aria-selected aria-setsize"),
  tablist: P("aria-activedescendant aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-flowto aria-hidden aria-label aria-labelledby aria-multiselectable aria-orientation aria-owns aria-roledescription"),
  tabpanel: P("aria-atomic aria-busy aria-describedby aria-details aria-flowto aria-hidden aria-label aria-labelledby aria-owns aria-roledescription"),
  textbox: P("aria-activedescendant aria-atomic aria-autocomplete aria-busy aria-describedby aria-details aria-disabled aria-errormessage aria-flowto aria-haspopup aria-hidden aria-invalid aria-label aria-labelledby aria-multiline aria-owns aria-placeholder aria-readonly aria-required aria-roledescription"),
  tree: P("aria-activedescendant aria-atomic aria-busy aria-describedby aria-details aria-disabled aria-errormessage aria-flowto aria-hidden aria-invalid aria-label aria-labelledby aria-multiselectable aria-orientation aria-owns aria-required aria-roledescription"),
  treeitem: P("aria-atomic aria-busy aria-checked aria-describedby aria-details aria-disabled aria-expanded aria-flowto aria-haspopup aria-hidden aria-label aria-labelledby aria-level aria-owns aria-posinset aria-roledescription aria-selected aria-setsize"),
};

/** Roles whose accessible name may come from their content (accname 1.2 "name from: contents"). */
export const NAME_FROM_CONTENT_ROLES: ReadonlySet<string> = new Set([
  "button", "cell", "checkbox", "columnheader", "gridcell", "heading", "link", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader", "switch", "tab",
  "tooltip", "treeitem", "caption", "code", "deletion", "emphasis", "insertion", "mark",
  "strong", "subscript", "superscript", "term", "time", "comment", "suggestion", "definition",
  "doc-backlink", "doc-biblioref", "doc-glossref", "doc-noteref",
]);

export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  "banner", "main", "navigation", "contentinfo", "complementary", "region", "search", "form",
]);
