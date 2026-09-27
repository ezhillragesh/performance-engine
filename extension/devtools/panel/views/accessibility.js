// Accessibility view: audits the inspected page with ONE unified rule set and shows its findings,
// its WCAG coverage and its rules.
//
// Internally the unified rule set (core/a11y/catalog/unified.ts, vendored as vendor/a11y-rules.mjs)
// is evaluated by three engines — the A11yInspect port in vendor/a11y-audit.js, and the vendored
// IBM Equal Access (vendor/ibm-ace.js) and axe-core (vendor/axe.min.js) engines, injected on demand
// and wrapped so they never touch the page's own globals. The fast built-in engine runs first; the
// other two refine the same list asynchronously; results are merged per element + unified rule.
// Engine names are never shown in the UI (hidden `sources` stay in the data for exports).
//
// Wiring (main.js): VIEWS row { id: "accessibility", label: "Accessibility", icon: "check" }; the view
// exposes getReport() for Export and onNavigated(). It loads its stylesheet (panel/a11y.css) itself.
//
// Dependencies are injectable for tests / the dev preview:
//   createAccessibilityView(ctx, { evalInPage(code) => Promise<result>, loadAuditSource() => Promise<string>,
//                                  loadEngineSource(name) => Promise<string>, subscribeNavigation(cb) => unsubscribe })
//
// Security: every value coming back from the page is untrusted — it is validated/capped in
// validateReport() and rendered with textContent only (dom.js h()); never innerHTML.
import { h, s, icon, replaceChildren, reconcile, setText, ellipsis, emptyState, segmented, searchField, listKeyNav } from "../dom.js";
import { formatClock, formatCount, formatMs, isNum, pluralize } from "../format.js";
import * as R from "../../../vendor/a11y-rules.mjs";

const AUDIT_PATH = "vendor/a11y-audit.js";
const ENGINE_FILES = { ibm: "vendor/ibm-ace.js", axe: "vendor/axe.min.js" };
const NOTICES_PATH = "THIRD_PARTY_NOTICES.txt";
const LIVE_POLL_MS = 1500;
const NAV_RESCAN_DELAY_MS = 900;
const ENGINE_POLL_MS = 250;
const ENGINE_TIMEOUT_MS = 180_000;
const MAX_FINDINGS = 2000;
/** Rows a group shows before "Show all N" (keeps a 200-link contrast group from being endless). */
export const GROUP_PAGE = 50;
const STANDARD_KEY = "perf-intel.a11y.standard";

export const RULE_COUNT = R.UNIFIED_RULES.length;
export const IMPACTS = ["critical", "major", "minor", "info"];
export const KINDS = ["error", "review", "warning"];
const ENGINE_IDS = ["a11yinspect", "ibm", "axe"];
const IMPACT_LABEL = { critical: "Critical", major: "Major", minor: "Minor", info: "Info" };
const IMPACT_RANK = { critical: 0, major: 1, minor: 2, info: 3 };
const KIND_LABEL = { error: "Error", review: "Needs review", warning: "Warning" };
const KIND_RANK = { error: 0, review: 1, warning: 2 };

export function wcagUrl(criterion) {
  return R.wcagUnderstandingUrl(criterion);
}

export function wcagTitle(criterion) {
  return R.wcagCriterion(criterion)?.name || "";
}

// ── Validation of untrusted page results / imported bundles ──────────────────────────────────

const str = (v, max) => (typeof v === "string" ? (v.length > max ? v.slice(0, max - 1) + "…" : v) : "");
const num = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const isCriterion = (c) => typeof c === "string" && /^\d\.\d{1,2}\.\d{1,2}$/.test(c);
const strList = (v, maxItems, maxLen) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x && x.length <= maxLen).slice(0, maxItems) : undefined);

function validateSource(s) {
  if (!s || typeof s !== "object" || !ENGINE_IDS.includes(s.engine)) return null;
  const rule = str(s.rule, 80);
  if (!rule) return null;
  const out = { engine: s.engine, rule, kind: KINDS.includes(s.kind) ? s.kind : "error" };
  const check = str(s.check, 80);
  if (check) out.check = check;
  return out;
}

/**
 * Returns a sanitized report or null when `raw` is not an audit report. Accepts engine-level
 * reports (page results) and unified reports (merged / imported). Counts are recomputed locally.
 */
export function validateReport(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.findings)) return null;
  const findings = [];
  const seen = new Set();
  for (const f of raw.findings.slice(0, MAX_FINDINGS)) {
    if (!f || typeof f !== "object") continue;
    const ruleId = str(f.ruleId, 80);
    if (!ruleId) continue;
    const check = str(f.check, 80);
    let id = str(f.id, 80) || `${ruleId}/${check}/${findings.length}`;
    if (seen.has(id)) id = `${id}~${findings.length}`;
    seen.add(id);
    const item = {
      id,
      ruleId,
      check,
      kind: KINDS.includes(f.kind) ? f.kind : "error",
      impact: IMPACTS.includes(f.impact) ? f.impact : "minor",
      severity: str(f.severity, 20),
      wcag: isCriterion(f.wcag) ? f.wcag : "",
      level: f.level === "A" || f.level === "AA" || f.level === "AAA" ? f.level : null,
      message: str(f.message, 300),
      help: str(f.help, 400),
      selector: str(f.selector, 1500),
      snippet: str(f.snippet, 300),
      detail: str(f.detail, 400),
      count: Math.round(num(f.count, 1, 1e6) ?? 1),
    };
    if (ENGINE_IDS.includes(f.engine)) item.engine = f.engine;
    if (Array.isArray(f.criteria)) item.criteria = f.criteria.filter(isCriterion).slice(0, 8);
    if (f.bestPractice === true) item.bestPractice = true;
    const xpath = str(f.xpath, 1500);
    if (xpath) item.xpath = xpath;
    // Hidden merge keys: the element's per-page identity and composed-tree position.
    if (typeof f.node === "string" && /^[\w:]{1,40}$/.test(f.node)) item.node = f.node;
    if (typeof f.pos === "string" && f.pos.length <= 600 && /^\d+(\.\d+)*$/.test(f.pos)) item.pos = f.pos;
    const name = str(f.name, 80);
    if (name) item.name = name;
    if (Array.isArray(f.sources)) item.sources = f.sources.slice(0, 12).map(validateSource).filter(Boolean);
    findings.push(item);
  }
  const counts = { errors: 0, warnings: 0, reviews: 0, byImpact: { critical: 0, major: 0, minor: 0, info: 0 } };
  for (const f of findings) {
    counts[f.kind === "error" ? "errors" : f.kind === "review" ? "reviews" : "warnings"]++;
    counts.byImpact[f.impact]++;
  }
  const out = {
    url: str(raw.url, 500),
    title: str(raw.title, 200),
    timestamp: num(raw.timestamp) ?? Date.now(),
    durationMs: num(raw.durationMs, 0, 1e7),
    rulesRun: Math.round(num(raw.rulesRun, 0, 1000) ?? 0),
    elementsScanned: Math.round(num(raw.elementsScanned, 0, 1e9) ?? 0),
    score: Math.round(num(raw.score, 0, 100) ?? 0),
    truncated: raw.truncated === true,
    droppedFindings: Math.round(num(raw.droppedFindings, 0, 1e9) ?? 0),
    engineVersion: str(raw.engineVersion, 20),
    error: str(raw.error, 300),
    findings,
    counts,
  };
  if (ENGINE_IDS.includes(raw.engine)) out.engine = raw.engine;
  const sourceRules = strList(raw.sourceRules, 600, 80);
  if (sourceRules) out.sourceRules = sourceRules;
  const rulesChecked = strList(raw.rulesChecked, 600, 80);
  if (rulesChecked) out.rulesChecked = rulesChecked;
  if (raw.standard && typeof raw.standard === "object") out.standard = R.normalizeStandard(raw.standard);
  if (Array.isArray(raw.engines)) {
    out.engines = raw.engines
      .slice(0, 6)
      .filter((e) => e && typeof e === "object" && ENGINE_IDS.includes(e.engine))
      .map((e) => ({ engine: e.engine, version: str(e.version, 20), durationMs: num(e.durationMs, 0, 1e7) ?? 0, findings: Math.round(num(e.findings, 0, 1e6) ?? 0), ...(str(e.error, 300) ? { error: str(e.error, 300) } : {}) }));
  }
  return out;
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────────────────────────

/** "[Critical] img missing alt attribute (1.1.1 A)" -> "img missing alt attribute" (older exports). */
export function cleanMessage(message) {
  return String(message || "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .replace(/\s*\(\d\.\d{1,2}\.\d{1,2}\s+A{1,3}\)\s*$/, "")
    .trim();
}

const criteriaOf = (f) => (f.criteria && f.criteria.length ? f.criteria : f.wcag ? [f.wcag] : []);

export function filterFindings(findings, f) {
  const q = (f.search || "").trim().toLowerCase();
  return findings.filter((x) => {
    if (f.kind !== "all" && x.kind !== f.kind) return false;
    if (f.impact !== "all" && x.impact !== f.impact) return false;
    if (f.level === "bp" ? !x.bestPractice : f.level !== "all" && x.level !== f.level) return false;
    if (f.rule && x.ruleId !== f.rule) return false;
    if (f.criterion && !criteriaOf(x).includes(f.criterion)) return false;
    if (q && !`${x.message} ${x.ruleId} ${x.selector} ${criteriaOf(x).join(" ")} ${x.snippet} ${x.name || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Groups by rule id or WCAG criterion. Every finding is in exactly one group: "By WCAG" uses its
 * primary criterion (`wcag`, the first of its rule's criteria in the standard); the others are shown
 * on the row ("also 1.3.1"), while the WCAG coverage view counts the finding for each criterion.
 * `rank` (id -> position) keeps the order stable while later engines refine the list; without it
 * groups sort by worst impact, then size.
 */
export function groupFindings(findings, by, rank) {
  const r = (f) => (rank && rank.has(f.id) ? rank.get(f.id) : Number.MAX_SAFE_INTEGER);
  const map = new Map();
  const seen = new Set();
  for (const f of findings) {
    if (seen.has(f.id)) continue; // defensive: a finding is listed once
    seen.add(f.id);
    const key = by === "wcag" ? f.wcag || "other" : f.ruleId;
    let g = map.get(key);
    if (!g) map.set(key, (g = { key, items: [], worst: 3, errors: 0, first: Number.MAX_SAFE_INTEGER }));
    g.items.push(f);
    g.worst = Math.min(g.worst, IMPACT_RANK[f.impact]);
    g.first = Math.min(g.first, r(f));
    if (f.kind === "error") g.errors++;
  }
  const groups = [...map.values()];
  const byImpact = (a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || KIND_RANK[a.kind] - KIND_RANK[b.kind];
  for (const g of groups) g.items.sort((a, b) => (rank ? r(a) - r(b) : 0) || byImpact(a, b));
  groups.sort((a, b) => (rank ? a.first - b.first : 0) || a.worst - b.worst || b.items.length - a.items.length || (a.key < b.key ? -1 : 1));
  return groups;
}

export function gradeForScore(score) {
  return !isNum(score) ? "none" : score >= 90 ? "good" : score >= 50 ? "needs-improvement" : "poor";
}

const VERSION_RANK = { "2.0": 0, "2.1": 1, "2.2": 2 };
const LEVEL_RANK = { A: 0, AA: 1, AAA: 2 };

/** True when results scanned with `scanned` contain everything `next` needs (only local filtering required). */
export function standardCovers(scanned, next) {
  if (!scanned || !next) return false;
  if (scanned.profile !== next.profile) return false;
  return VERSION_RANK[next.version] <= VERSION_RANK[scanned.version] && LEVEL_RANK[next.level] <= LEVEL_RANK[scanned.level] && (!next.bestPractices || scanned.bestPractices);
}

/** Criteria of a finding other than the one it is grouped under ("also" chips in the WCAG grouping). */
export function otherCriteria(f) {
  return criteriaOf(f).filter((c) => c !== f.wcag);
}

/** Select value <-> standard. */
export function standardValue(st) {
  return st.profile === "wcag" ? `wcag:${st.version}:${st.level}` : st.profile;
}

export function standardFromValue(v, base) {
  const [profile, version, level] = String(v).split(":");
  return R.normalizeStandard({ ...base, profile, version, level });
}

// ── Page-side expressions (evaluated with chrome.devtools.inspectedWindow.eval) ─────────────────

const PROBE_EXPR = '(function(){try{var a=window.__PERF_INTEL_A11Y__;return a&&typeof a.run==="function"?String(a.version):null}catch(e){return null}})()';
// getEventListeners is a DevTools Console Utility, available in inspectedWindow.eval scope.
const RUN_EXPR = 'window.__PERF_INTEL_A11Y__.run({listeners: typeof getEventListeners === "function" ? getEventListeners : undefined})';
const WATCH_EXPR = '(function(){var a=window.__PERF_INTEL_A11Y__;return a?a.watch():null})()';
const UNWATCH_EXPR = '(function(){var a=window.__PERF_INTEL_A11Y__;if(a)a.unwatch();return true})()';
const DIRTY_EXPR = '(function(){var a=window.__PERF_INTEL_A11Y__;return a?a.consumeDirty():null})()';
const startExpr = (engine, standard) => `(function(){var a=window.__PERF_INTEL_A11Y__;return a&&a.start?a.start(${JSON.stringify(engine)},${JSON.stringify({ standard })}):""})()`;
const pollExpr = (token) => `(function(){var a=window.__PERF_INTEL_A11Y__;return a&&a.poll?a.poll(${JSON.stringify(token)}):{state:"unknown"}})()`;
const cancelExpr = (token) => `(function(){var a=window.__PERF_INTEL_A11Y__;return a&&a.cancel?a.cancel(${JSON.stringify(token)}):false})()`;
// find() resolves the finding's node key (the exact element), else its CSS selector / XPath.
const inspectExpr = (sel, node) => `(function(){var a=window.__PERF_INTEL_A11Y__,s=${JSON.stringify(sel)};var e=a&&a.find?a.find(s,${JSON.stringify(node || "")}):document.querySelector(s);if(!e)return false;inspect(e);return true})()`;
const highlightExpr = (sel, node) => `(function(){var a=window.__PERF_INTEL_A11Y__;return a?a.highlight(${JSON.stringify(sel)},${JSON.stringify(node || "")}):false})()`;

function defaultEvalInPage(code) {
  return new Promise((resolve, reject) => {
    const iw = globalThis.chrome?.devtools?.inspectedWindow;
    if (!iw || typeof iw.eval !== "function") return reject(new Error("The DevTools inspectedWindow API is not available."));
    try {
      iw.eval(code, (result, exc) => {
        if (exc && (exc.isError || exc.isException)) reject(new Error(String(exc.value || exc.description || exc.code || "Evaluation failed")));
        else resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

const extUrl = (path) => (globalThis.chrome?.runtime?.getURL ? chrome.runtime.getURL(path) : `../../${path}`);

async function fetchText(path) {
  const res = await fetch(extUrl(path));
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status}).`);
  return res.text();
}

function defaultSubscribeNavigation(cb) {
  try {
    const ev = globalThis.chrome?.devtools?.network?.onNavigated;
    if (!ev) return () => {};
    ev.addListener(cb);
    return () => ev.removeListener(cb);
  } catch {
    return () => {};
  }
}

function ensureStyles() {
  try {
    const href = new URL("../a11y.css", import.meta.url).href;
    if ([...document.querySelectorAll("link[rel=stylesheet]")].some((l) => l.href === href)) return;
    document.head.appendChild(h("link", { rel: "stylesheet", href }));
  } catch {
    /* styles are optional */
  }
}

function loadStandard() {
  try {
    const raw = globalThis.localStorage?.getItem(STANDARD_KEY);
    return R.normalizeStandard(raw ? JSON.parse(raw) : null);
  } catch {
    return R.normalizeStandard(null);
  }
}

function saveStandard(st) {
  try {
    globalThis.localStorage?.setItem(STANDARD_KEY, JSON.stringify(st));
  } catch {
    /* optional */
  }
}

// ── Local glyphs (dom.js has no accessibility icons) ────────────────────────────────────────────

function glyph(name, size = 16) {
  const paths = {
    person: [["circle", { cx: 8, cy: 3, r: 1.4, fill: "currentColor", stroke: "none" }], ["path", { d: "M3 5.8c1.7.5 3.3.7 5 .7s3.3-.2 5-.7M8 6.5v3.2M8 9.7 5.6 14M8 9.7l2.4 4.3" }]],
    inspect: [["path", { d: "M3 3h6.5M3 3v6.5M3 13h2M13 3v2" }], ["path", { d: "m7.5 7.5 6 2.3-2.6.9-.9 2.6z", fill: "currentColor" }]],
    target: [["circle", { cx: 8, cy: 8, r: 5 }], ["circle", { cx: 8, cy: 8, r: 1.8, fill: "currentColor", stroke: "none" }], ["path", { d: "M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" }]],
    external: [["path", { d: "M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" }]],
  };
  const svg = s("svg", { class: "icon", width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" });
  for (const [tag, attrs] of paths[name] || []) svg.appendChild(s(tag, attrs));
  return svg;
}

// ── View ────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} ctx  panel context ({ store, actions, statusEmpty }); only optional parts are used.
 * @param {{evalInPage?: (code: string) => Promise<any>, loadAuditSource?: () => Promise<string>, loadEngineSource?: (name: "ibm"|"axe") => Promise<string>, subscribeNavigation?: (cb: () => void) => () => void}} [deps]
 */
export function createAccessibilityView(ctx = {}, deps = {}) {
  const evalInPage = deps.evalInPage || defaultEvalInPage;
  const loadAuditSource = deps.loadAuditSource || (() => fetchText(AUDIT_PATH));
  const loadEngineSource = deps.loadEngineSource || ((name) => fetchText(ENGINE_FILES[name]));
  const subscribeNavigation = deps.subscribeNavigation || defaultSubscribeNavigation;
  ensureStyles();

  const st = {
    report: null,
    parts: {},
    scanning: false,
    scanStart: 0,
    scanStandard: null,
    incomplete: false,
    cancelled: false,
    queued: false,
    error: null,
    stale: false,
    live: false,
    standard: loadStandard(),
    view: "issues",
    filters: { kind: "all", impact: "all", level: "all", search: "", rule: "", criterion: "" },
    groupBy: "rule",
    selectedId: null,
    collapsed: new Set(),
    expanded: new Set(), // groups showing all rows (see GROUP_PAGE)
    notice: null,
    autoScanned: false,
    touchedDuringScan: false,
  };
  const rank = new Map(); // finding id -> first-seen position (stable order while results refine)
  let scanGen = 0;
  let auditSourcePromise = null;
  const engineSource = {};
  let liveTimer = 0;
  let navTimer = 0;
  let noticeTimer = 0;
  let tickTimer = 0;
  let lastDetailKey = "";

  // Imported bundle (read-only): show its audit, if it has one, and never touch the live page.
  const importedData = () => (ctx.store && ctx.store.readOnly ? ctx.store.state.imported : null);
  let importedCache = { src: null, report: null };
  const shownReport = () => {
    const imp = importedData();
    if (!imp) return st.report;
    if (!imp.a11y) return null;
    if (importedCache.src !== imp.a11y) {
      // Older exports carry engine-level findings: fold them into the unified rules (idempotent for new ones).
      let report = imp.a11y;
      try {
        report = { ...R.mergeA11yReports([imp.a11y], { standard: imp.a11y.standard }), url: imp.a11y.url, title: imp.a11y.title, timestamp: imp.a11y.timestamp, durationMs: imp.a11y.durationMs, elementsScanned: imp.a11y.elementsScanned };
      } catch {
        /* show as imported */
      }
      importedCache = { src: imp.a11y, report };
    }
    return importedCache.report;
  };
  const shownStandard = () => shownReport()?.standard || st.standard;

  // ── Header ──
  const ringHost = h("div", { class: "a11y-ring-host" });
  const countsEl = h("div", { class: "a11y-counts" });
  const metaEl = h("p", { class: "a11y-meta caption" });
  const pageEl = h("p", { class: "a11y-page" });
  const liveBtn = h(
    "button",
    { type: "button", class: "pill-toggle a11y-live", "aria-pressed": "false", title: "Re-audit automatically when the page DOM changes", onClick: () => setLive(!st.live) },
    h("span", { class: "a11y-live-dot", "aria-hidden": "true" }),
    h("span", { text: "Live" }),
  );
  const cancelBtn = h("button", { type: "button", class: "btn a11y-cancel", hidden: true, onClick: () => cancelScan() }, h("span", { text: "Cancel" }));
  const rescanBtn = h("button", { type: "button", class: "btn btn-accent a11y-rescan", onClick: () => scan({ reset: true }) }, icon("refresh", 14), h("span", { text: "Run audit" }));
  const header = h(
    "header",
    { class: "a11y-head" },
    ringHost,
    h("div", { class: "a11y-summary" }, pageEl, countsEl, metaEl),
    h("span", { class: "spacer" }),
    h("div", { class: "a11y-actions" }, liveBtn, cancelBtn, rescanBtn),
  );
  const progress = h("div", { class: "a11y-progress", role: "progressbar", "aria-label": "Scanning page", hidden: true }, h("span", { class: "a11y-progress-bar" }));

  // ── Standard bar (all sub-views) ──
  const viewControl = segmented({
    label: "Accessibility view",
    value: "issues",
    className: "a11y-subviews",
    options: [
      { value: "issues", label: "Issues" },
      { value: "wcag", label: "WCAG" },
      { value: "rules", label: "Rules" },
    ],
    onChange: (v) => {
      st.view = v;
      render("ui");
    },
  });
  const standardSelect = h(
    "select",
    { class: "select a11y-standard", "aria-label": "Standard", title: "Standard to audit against", onChange: (e) => setStandard(standardFromValue(e.target.value, st.standard)) },
    ["2.2", "2.1", "2.0"].map((v) => h("optgroup", { label: `WCAG ${v}` }, ["A", "AA", "AAA"].map((l) => h("option", { value: `wcag:${v}:${l}`, text: `WCAG ${v} · ${l}` })))),
    h("optgroup", { label: "Regulations" }, h("option", { value: "section508", text: "Section 508" }), h("option", { value: "en301549", text: "EN 301 549" })),
  );
  const bpToggle = h("button", { type: "button", class: "pill-toggle a11y-toggle", "aria-pressed": "true", title: "Include rules that are not tied to a WCAG success criterion", onClick: () => setStandard({ ...st.standard, bestPractices: !st.standard.bestPractices }) }, h("span", { text: "Best practices" }));
  const reviewToggle = h("button", { type: "button", class: "pill-toggle a11y-toggle", "aria-pressed": "true", title: "Include possible issues that a person needs to confirm", onClick: () => setStandard({ ...st.standard, includeReview: !st.standard.includeReview }) }, h("span", { text: "Needs review" }));
  const standardBar = h("div", { class: "a11y-standardbar" }, viewControl.el, h("span", { class: "spacer" }), standardSelect, bpToggle, reviewToggle);

  // ── Issue filters ──
  const setFilter = (patch) => {
    Object.assign(st.filters, patch);
    render("ui");
  };
  const kindControl = segmented({
    label: "Finding kind",
    value: "all",
    options: [
      { value: "all", label: "All" },
      { value: "error", label: "Errors" },
      { value: "review", label: "Needs review" },
      { value: "warning", label: "Warnings" },
    ],
    onChange: (v) => setFilter({ kind: v }),
  });
  const impactSelect = h(
    "select",
    { class: "select", "aria-label": "Impact filter", onChange: (e) => setFilter({ impact: e.target.value }) },
    h("option", { value: "all", text: "All impacts" }),
    IMPACTS.map((i) => h("option", { value: i, text: IMPACT_LABEL[i] })),
  );
  const levelSelect = h(
    "select",
    { class: "select", "aria-label": "WCAG level filter", onChange: (e) => setFilter({ level: e.target.value }) },
    h("option", { value: "all", text: "All levels" }),
    ["A", "AA", "AAA"].map((l) => h("option", { value: l, text: `Level ${l}` })),
    h("option", { value: "bp", text: "Best practices" }),
  );
  const groupControl = segmented({
    label: "Group findings",
    value: "rule",
    className: "a11y-group-toggle",
    options: [
      { value: "rule", label: "By rule" },
      { value: "wcag", label: "By WCAG" },
    ],
    onChange: (v) => {
      st.groupBy = v;
      render("ui");
    },
  });
  const search = searchField({ placeholder: "Filter findings", label: "Filter findings", onInput: (v) => setFilter({ search: v }) });
  const scopeChipHost = h("span", { class: "a11y-scope-host" });
  const filterbar = h("div", { class: "filterbar a11y-filterbar" }, kindControl.el, impactSelect, levelSelect, scopeChipHost, groupControl.el, search.el);

  // ── Body ──
  const listStatus = h("div", { class: "list-status caption", role: "status" });
  const groupsEl = h("div", { class: "a11y-groups" });
  const listWrap = h("div", { class: "pane pane-list a11y-list" });
  const detail = h("div", { class: "pane pane-detail a11y-detail-pane", "aria-live": "polite" });
  const split = h("div", { class: "split a11y-split" }, listWrap, detail);
  const issuesEl = h("div", { class: "a11y-issues" }, filterbar, split);
  const coverageEl = h("div", { class: "a11y-coverage" });
  const noticeHost = h("div", { class: "a11y-notice-host" });
  const body = h("div", { class: "a11y-body" });
  const creditsLink = h("a", { class: "btn-link a11y-credits", href: extUrl(NOTICES_PATH), target: "_blank", rel: "noopener noreferrer", title: "Licenses of the open-source projects this audit is built on" }, h("span", { text: "Open-source credits" }));
  const footer = h("footer", { class: "a11y-footer caption" }, h("span", { class: "a11y-footer-note", text: "Automated checks find only part of the barriers — also test with a keyboard and a screen reader." }), h("span", { class: "spacer" }), creditsLink);
  const el = h("section", { class: "view view-a11y", "aria-label": "Accessibility" }, header, progress, noticeHost, standardBar, body, footer);

  listKeyNav(groupsEl, {
    itemSelector: "li[role=option]",
    onMove: (li) => select(li.dataset.id),
    onActivate: (li) => select(li.dataset.id),
  });

  const unsubscribeNav = subscribeNavigation(() => onNavigated());

  // ── Page interaction ──

  async function ensureInstalled() {
    const v = await evalInPage(PROBE_EXPR);
    if (v === R.A11Y_ENGINE_VERSION) return;
    if (!auditSourcePromise) auditSourcePromise = loadAuditSource().catch((e) => ((auditSourcePromise = null), Promise.reject(e)));
    await evalInPage(await auditSourcePromise);
    const again = await evalInPage(PROBE_EXPR);
    if (typeof again !== "string" || !again) throw new Error("The audit script could not be installed in this page.");
  }

  /** Injects a vendored engine (cached source, private global) unless the same version is already there. */
  async function ensureEngine(name) {
    const versions = await evalInPage(R.ENGINES_PROBE_EXPR);
    const want = name === "ibm" ? R.IBM_ACE_VERSION : R.AXE_CORE_VERSION;
    if (versions && versions[name === "ibm" ? "ace" : "axe"] === want) return;
    if (!engineSource[name]) engineSource[name] = loadEngineSource(name).catch((e) => ((engineSource[name] = null), Promise.reject(e)));
    const src = await engineSource[name];
    await evalInPage(name === "ibm" ? R.wrapAceSource(src, want) : R.wrapAxeSource(src, want));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runEngine(name, gen) {
    await ensureEngine(name);
    if (gen !== scanGen) return null;
    const token = await evalInPage(startExpr(name, st.scanStandard));
    if (typeof token !== "string" || !token) throw new Error("unavailable");
    const t0 = Date.now();
    for (;;) {
      await sleep(ENGINE_POLL_MS);
      if (gen !== scanGen || Date.now() - t0 > ENGINE_TIMEOUT_MS) {
        evalInPage(cancelExpr(token)).catch(() => null);
        return null;
      }
      const p = await evalInPage(pollExpr(token)); // blocks while the page is busy scanning
      if (gen !== scanGen) {
        evalInPage(cancelExpr(token)).catch(() => null);
        return null;
      }
      if (!p || p.state === "unknown") throw new Error("lost");
      if (p.state === "running") continue;
      if (p.state === "error") throw new Error(String(p.error || "failed"));
      const r = validateReport(p.report);
      if (!r || (r.error && !r.findings.length)) throw new Error(r?.error || "failed");
      return r;
    }
  }

  function remerge() {
    const parts = ["a11yinspect", "axe", "ibm"].map((k) => st.parts[k]).filter(Boolean);
    if (!parts.length) return;
    const merged = R.mergeA11yReports(parts, { standard: st.standard, maxFindings: MAX_FINDINGS });
    const first = st.parts.a11yinspect || parts[0];
    merged.url = first.url;
    merged.title = first.title;
    merged.timestamp = first.timestamp;
    merged.elementsScanned = Math.max(...parts.map((p) => p.elementsScanned || 0));
    for (const f of merged.findings) if (!rank.has(f.id)) rank.set(f.id, rank.size);
    st.report = merged;
    if (st.selectedId && !merged.findings.some((f) => f.id === st.selectedId)) st.selectedId = null;
  }

  async function scan({ reset = false } = {}) {
    if (importedData()) return;
    if (st.scanning) {
      st.queued = true;
      return;
    }
    clearTimeout(navTimer);
    const gen = ++scanGen;
    st.scanning = true;
    st.cancelled = false;
    st.autoScanned = true;
    st.scanStart = Date.now();
    st.scanStandard = { ...st.standard };
    st.incomplete = false;
    if (reset) rank.clear();
    startTicker();
    render("status");
    try {
      await ensureInstalled();
      const raw = await evalInPage(RUN_EXPR);
      const report = validateReport(raw);
      if (!report) throw new Error("The page returned an unexpected result.");
      if (report.error && report.findings.length === 0) throw new Error(report.error);
      if (gen !== scanGen) return;
      // Keep the other parts until they are refreshed (a rescan should refine, not blink).
      if (st.stale || !st.report || st.report.url !== report.url) st.parts = {};
      st.parts.a11yinspect = report;
      st.error = null;
      st.stale = false;
      remerge();
      render("data");
      if (st.live) evalInPage(WATCH_EXPR).catch(() => null);
      for (const name of ["axe", "ibm"]) {
        if (gen !== scanGen) return;
        try {
          const r = await runEngine(name, gen);
          if (gen !== scanGen) return;
          if (r) {
            st.parts[name] = r;
            remerge();
            render("data");
          }
        } catch {
          if (gen !== scanGen) return;
          delete st.parts[name];
          st.incomplete = true;
          remerge();
        }
      }
    } catch (e) {
      if (gen === scanGen) st.error = friendlyError(e);
    } finally {
      if (gen === scanGen) finishScan();
    }
  }

  function finishScan() {
    st.scanning = false;
    // Order stayed stable while results refined; settle once into severity order unless the user
    // already picked a finding during the scan (then nothing moves under them).
    if (!st.touchedDuringScan && st.report) {
      rank.clear();
      for (const f of st.report.findings) rank.set(f.id, rank.size);
    }
    st.touchedDuringScan = false;
    stopTicker();
    render("data");
    if (st.queued) {
      st.queued = false;
      scan();
    }
  }

  function cancelScan() {
    if (!st.scanning) return;
    scanGen++; // in-flight engine runs see the new generation, cancel their page job and drop the result
    st.cancelled = true;
    st.queued = false;
    finishScan();
  }

  function startTicker() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => renderHeader(), 200);
  }

  function stopTicker() {
    clearInterval(tickTimer);
    tickTimer = 0;
  }

  function setStandard(next) {
    if (importedData()) return;
    const prev = st.standard;
    st.standard = R.normalizeStandard(next);
    saveStandard(st.standard);
    remerge(); // instant: re-filter what we have
    render("data");
    if (st.report && !st.scanning && !standardCovers(st.scanStandard || prev, st.standard)) scan();
  }

  function friendlyError(e) {
    const msg = e && e.message ? String(e.message) : String(e || "Unknown error");
    return msg.slice(0, 300);
  }

  function setLive(on) {
    if (on && importedData()) return;
    st.live = on;
    clearInterval(liveTimer);
    liveTimer = 0;
    if (on) {
      evalInPage(WATCH_EXPR).catch(() => null);
      liveTimer = setInterval(pollLive, LIVE_POLL_MS);
      if (!st.report) scan();
    } else {
      evalInPage(UNWATCH_EXPR).catch(() => null);
    }
    render("ui");
  }

  async function pollLive() {
    if (!st.live || st.scanning) return;
    let dirty = null;
    try {
      dirty = await evalInPage(DIRTY_EXPR);
    } catch {
      return; // page busy / navigating; try again on the next tick
    }
    if (dirty === true || dirty === null) scan(); // null: audit script gone (navigation) -> reinstall + rescan
  }

  function onNavigated() {
    if (st.scanning) cancelScan();
    st.stale = !!st.report;
    st.selectedId = null;
    lastDetailKey = "";
    rank.clear();
    clearTimeout(navTimer);
    if (st.live || isShown()) navTimer = setTimeout(() => scan(), NAV_RESCAN_DELAY_MS);
    else st.autoScanned = false; // rescan when the view is next shown
    render("status");
  }

  function isShown() {
    return el.isConnected && !el.closest("[hidden]");
  }

  function flash(text, tone = "info") {
    st.notice = { text, tone };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      st.notice = null;
      renderNotice();
    }, 4000);
    renderNotice();
  }

  async function inspectFinding(f) {
    try {
      const found = await evalInPage(inspectExpr(f.selector || f.xpath, f.node));
      if (found === false) flash("That element is no longer on the page. Run the audit again to refresh the findings.", "warn");
    } catch (e) {
      flash(`Could not open the Elements panel: ${friendlyError(e)}`, "warn");
    }
  }

  async function highlightFinding(f) {
    try {
      const ok = await evalInPage(highlightExpr(f.selector || f.xpath, f.node));
      if (ok !== true) flash("That element is no longer on the page. Run the audit again to refresh the findings.", "warn");
    } catch (e) {
      flash(`Could not highlight: ${friendlyError(e)}`, "warn");
    }
  }

  function select(id) {
    if (st.scanning) st.touchedDuringScan = true;
    st.selectedId = id;
    render("ui");
  }

  function showIssues(patch) {
    st.view = "issues";
    Object.assign(st.filters, { kind: "all", impact: "all", level: "all", search: "", rule: "", criterion: "" }, patch);
    render("ui");
  }

  // ── Rendering ──

  function renderNotice() {
    const imp = importedData();
    const n = imp
      ? imp.a11y
        ? { text: "Imported audit (read-only). Accessibility audits run live — return to live to scan.", tone: "info" }
        : null
      : st.notice || (st.stale && !st.scanning ? { text: "Page navigated — these findings are from the previous page.", tone: "info", stale: true } : null);
    if (!n) return replaceChildren(noticeHost);
    replaceChildren(
      noticeHost,
      h(
        "div",
        { class: `banner banner-${n.tone === "warn" ? "warn" : "info"} a11y-notice`, role: "status" },
        icon(n.tone === "warn" ? "warning" : "info", 14),
        ellipsis(n.text),
        h("span", { class: "spacer" }),
        n.stale ? h("button", { type: "button", class: "btn btn-small", text: "Run audit", onClick: () => scan({ reset: true }) }) : null,
      ),
    );
  }

  function renderHeader() {
    const r = shownReport();
    const imported = !!importedData();
    const score = r ? r.score : null;
    replaceChildren(ringHost, scoreRing(score, st.scanning));
    setText(pageEl, r ? r.title || r.url || "Inspected page" : "Accessibility audit");
    pageEl.title = r?.url || "";
    const elapsed = st.scanning ? `${((Date.now() - st.scanStart) / 1000).toFixed(1)} s` : "";
    if (r) {
      replaceChildren(
        countsEl,
        countPill("error", r.counts.errors, "Errors", "Error"),
        countPill("review", r.counts.reviews ?? 0, "Need review", "Needs review"),
        countPill("warning", r.counts.warnings, "Warnings", "Warning"),
        h("span", { class: "a11y-count-sep", "aria-hidden": "true" }),
        IMPACTS.map((i) => h("span", { class: `a11y-impact-count impact-${i}`, title: `${IMPACT_LABEL[i]} impact` }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "num", text: String(r.counts.byImpact[i]) }), h("span", { class: "a11y-impact-name", text: ` ${IMPACT_LABEL[i]}` }))),
      );
      const bits = st.scanning
        ? [`Scanning page… ${elapsed}`]
        : [`${imported ? "Imported · scanned" : "Scanned"} ${formatClock(r.timestamp)}`, formatMs(r.durationMs), `${formatCount(r.elementsScanned)} elements`, `${r.rulesChecked ? r.rulesChecked.length : r.rulesRun || RULE_COUNT} rules checked`];
      if (!st.scanning) bits.push(R.standardLabel(shownStandard()));
      if (!st.scanning && st.cancelled && !imported) bits.push("partial (cancelled)");
      else if (!st.scanning && st.incomplete && !imported) bits.push("some checks could not run");
      if (r.truncated) bits.push(r.droppedFindings ? `truncated (+${r.droppedFindings} findings not shown)` : "truncated by time budget");
      setText(metaEl, bits.join(" · "));
    } else {
      replaceChildren(countsEl);
      setText(metaEl, imported ? "Imported bundle" : st.scanning ? `Scanning page… ${elapsed}` : `${RULE_COUNT} rules on the live DOM`);
    }
    rescanBtn.disabled = st.scanning || imported;
    liveBtn.disabled = imported;
    cancelBtn.hidden = !st.scanning;
    progress.hidden = !st.scanning;
    replaceChildren(rescanBtn, st.scanning ? h("span", { class: "spinner a11y-btn-spinner", "aria-hidden": "true" }) : icon("refresh", 14), h("span", { text: st.scanning ? "Scanning page…" : "Run audit" }));
    liveBtn.setAttribute("aria-pressed", st.live ? "true" : "false");
    liveBtn.classList.toggle("is-live", st.live);
  }

  function renderStandardBar() {
    const imported = !!importedData();
    const std = shownStandard();
    standardSelect.value = standardValue(std);
    standardSelect.disabled = imported;
    bpToggle.setAttribute("aria-pressed", std.bestPractices ? "true" : "false");
    reviewToggle.setAttribute("aria-pressed", std.includeReview ? "true" : "false");
    bpToggle.disabled = imported;
    reviewToggle.disabled = imported;
    viewControl.set(st.view);
  }

  function render(topic) {
    const imported = !!importedData();
    if (!imported && !st.autoScanned && !st.scanning && isShown()) {
      // First time the view is shown (or first show after a navigation): audit automatically.
      queueMicrotask(() => scan());
      st.autoScanned = true;
    }
    renderHeader();
    renderNotice();
    renderStandardBar();
    const r = shownReport();

    if (!r) {
      header.classList.toggle("is-empty", true);
      standardBar.hidden = imported;
      if (imported) return replaceChildren(body, importedState());
      if (st.error) return replaceChildren(body, errorState());
      if (st.scanning) return replaceChildren(body, h("div", { class: "empty", role: "status" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "empty-title", text: "Scanning page…" }), h("p", { class: "empty-body", text: `Checking ${RULE_COUNT} accessibility rules against the live DOM.` })));
      return replaceChildren(body, introState());
    }
    standardBar.hidden = false;
    header.classList.toggle("is-empty", false);
    if (st.error && !st.scanning && !imported) flashOnce(st.error);
    if (st.view === "wcag") return renderWcagView(r);
    if (st.view === "rules") return renderRulesView(r);
    renderIssues(r, topic);
  }

  function renderIssues(r, topic) {
    if (!body.contains(issuesEl)) replaceChildren(body, issuesEl);
    const f = st.filters;
    kindControl.set(f.kind);
    groupControl.set(st.groupBy);
    impactSelect.value = f.impact;
    levelSelect.value = f.level;
    search.set(f.search);
    replaceChildren(scopeChipHost, scopeChip());

    if (r.findings.length === 0) {
      replaceChildren(
        listWrap,
        emptyState({
          iconName: "check",
          title: st.scanning ? "No issues so far" : "No issues found",
          body: `${pluralize(r.rulesChecked ? r.rulesChecked.length : r.rulesRun || RULE_COUNT, "rule")} passed on ${formatCount(r.elementsScanned)} elements (${R.standardLabel(shownStandard())}). Automated checks find only part of the barriers — also try the page with a keyboard and a screen reader.`,
        }),
      );
      replaceChildren(detail, placeholder("Nothing to fix here."));
      lastDetailKey = "";
      return;
    }

    const visible = filterFindings(r.findings, f);
    const hidden = r.findings.length - visible.length;
    setText(listStatus, (hidden ? `${visible.length} of ${pluralize(r.findings.length, "finding")} shown` : pluralize(r.findings.length, "finding")) + (st.scanning ? " · refining…" : ""));
    if (visible.length === 0) {
      replaceChildren(
        listWrap,
        listStatus,
        emptyState({
          iconName: "search",
          title: "No matching findings",
          body: `Filters hide ${pluralize(hidden, "finding")}.`,
          action: h("button", { type: "button", class: "btn", text: "Clear filters", onClick: () => setFilter({ kind: "all", impact: "all", level: "all", search: "", rule: "", criterion: "" }) }),
        }),
      );
    } else {
      if (!listWrap.contains(groupsEl)) replaceChildren(listWrap, listStatus, groupsEl);
      renderGroups(groupFindings(visible, st.groupBy, importedData() ? null : rank));
    }

    const sel = st.selectedId ? r.findings.find((x) => x.id === st.selectedId) : null;
    const key = sel ? `${sel.id}|${r.timestamp}|${sel.kind}|${sel.impact}` : `none|${r.timestamp}`;
    if (key !== lastDetailKey || topic === "data") {
      lastDetailKey = key;
      if (sel) renderDetail(sel);
      else replaceChildren(detail, placeholder("Select a finding to see how to fix it."));
    }
  }

  function scopeChip() {
    const f = st.filters;
    if (!f.rule && !f.criterion) return null;
    const label = f.rule ? R.unifiedRule(f.rule)?.title || f.rule : `${f.criterion} ${wcagTitle(f.criterion)}`;
    return h(
      "button",
      { type: "button", class: "chip chip-button a11y-scope-chip", title: "Remove this filter", onClick: () => setFilter({ rule: "", criterion: "" }) },
      h("span", { class: "ellipsis", text: label }),
      icon("close", 10),
    );
  }

  let lastFlashed = "";
  function flashOnce(msg) {
    if (msg === lastFlashed) return;
    lastFlashed = msg;
    flash(`Audit failed: ${msg}`, "warn");
  }

  function groupTitle(g) {
    if (st.groupBy === "wcag") return g.key === "other" ? "Best practices" : `${g.key} ${wcagTitle(g.key)}`;
    return R.unifiedRule(g.key)?.title || g.key;
  }

  function renderGroups(groups) {
    reconcile(
      groupsEl,
      groups,
      (g) => `${st.groupBy}:${g.key}`,
      () => {
        const toggle = h("button", { type: "button", class: "a11y-group-head" });
        const list = h("ul", { class: "a11y-items", role: "listbox" });
        const more = h("button", { type: "button", class: "btn-link a11y-show-all", hidden: true });
        const sec = h("section", { class: "a11y-group" }, toggle, list, more);
        toggle.addEventListener("click", () => {
          const k = sec.dataset.key;
          if (st.collapsed.has(k)) st.collapsed.delete(k);
          else st.collapsed.add(k);
          render("ui");
        });
        more.addEventListener("click", () => {
          st.expanded.add(sec.dataset.key);
          render("ui");
          // Keyboard users continue at the first row that was hidden.
          sec.querySelectorAll("li[role=option]")[GROUP_PAGE]?.focus();
        });
        return sec;
      },
      (sec, g) => {
        const k = `${st.groupBy}:${g.key}`;
        sec.dataset.key = k;
        const collapsed = st.collapsed.has(k);
        const toggle = sec.querySelector(".a11y-group-head");
        const list = sec.querySelector(".a11y-items");
        const more = sec.querySelector(".a11y-show-all");
        const title = groupTitle(g);
        const level = st.groupBy === "wcag" ? R.wcagCriterion(g.key)?.level : null;
        const worst = IMPACTS[g.worst];
        replaceChildren(
          toggle,
          h("span", { class: `a11y-chevron${collapsed ? " is-collapsed" : ""}`, "aria-hidden": "true" }, icon("chevronDown", 12)),
          h("span", { class: `a11y-dot impact-${worst}`, title: `Worst impact: ${IMPACT_LABEL[worst]}`, "aria-hidden": "true" }),
          ellipsis(title, "a11y-group-title"),
          st.groupBy === "rule" ? h("span", { class: "a11y-group-id mono", text: g.key }) : null,
          level ? h("span", { class: "chip chip-tiny", text: level }) : null,
          h("span", { class: "segment-count a11y-group-count", text: String(g.items.length) }),
        );
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        toggle.setAttribute("aria-label", `${title}, ${pluralize(g.items.length, "finding")}${collapsed ? ", collapsed" : ""}`);
        list.setAttribute("aria-label", title);
        list.hidden = collapsed;
        // Large groups show the first GROUP_PAGE rows (plus the selected one) until "Show all".
        const selIdx = st.selectedId ? g.items.findIndex((f) => f.id === st.selectedId) : -1;
        const capped = !st.expanded.has(k) && g.items.length > GROUP_PAGE && selIdx < GROUP_PAGE;
        const rows = capped ? g.items.slice(0, GROUP_PAGE) : g.items;
        more.hidden = collapsed || !capped;
        setText(more, capped ? `Show all ${g.items.length}` : "");
        more.setAttribute("aria-label", capped ? `Show all ${pluralize(g.items.length, "finding")} for ${title}` : "");
        if (collapsed) return;
        reconcile(
          list,
          rows,
          (f) => f.id,
          () => {
            const li = h("li", { role: "option", class: "a11y-item" });
            li.append(
              h("span", { class: "sev-bar", "aria-hidden": "true" }),
              h(
                "div",
                { class: "item-main" },
                h("div", { class: "item-row" }, h("span", { class: "item-title ellipsis" }), h("span", { class: "a11y-item-badges" })),
                h("div", { class: "item-row a11y-item-where" }, h("span", { class: "a11y-item-name ellipsis" }), h("span", { class: "item-source ellipsis mono" })),
              ),
            );
            li.addEventListener("click", () => select(li.dataset.id));
            return li;
          },
          (li, f) => updateItem(li, f),
        );
      },
    );
    // Roving tab stop.
    const items = groupsEl.querySelectorAll("li[role=option]");
    let stop = false;
    for (const li of items) {
      const on = li.dataset.id === st.selectedId;
      li.tabIndex = on ? 0 : -1;
      stop ||= on;
    }
    if (!stop && items[0]) items[0].tabIndex = 0;
  }

  const findingTitle = (f) => (st.groupBy === "rule" ? f.snippet || f.selector : cleanMessage(f.message) || f.ruleId);

  function updateItem(li, f) {
    li.dataset.id = f.id;
    li.className = `a11y-item impact-${f.impact} kind-${f.kind}`;
    li.setAttribute("aria-selected", f.id === st.selectedId ? "true" : "false");
    const title = li.querySelector(".item-title");
    const msg = cleanMessage(f.message) || f.ruleId;
    const text = findingTitle(f);
    setText(title, text);
    title.title = text;
    title.classList.toggle("mono", st.groupBy === "rule");
    const badges = li.querySelector(".a11y-item-badges");
    const also = st.groupBy === "wcag" ? otherCriteria(f) : [];
    replaceChildren(
      badges,
      also.length ? h("span", { class: "chip chip-tiny a11y-also", title: also.map((c) => `${c} ${wcagTitle(c)}`).join("\n"), text: `also ${also.join(", ")}` }) : null,
      f.count > 1 ? h("span", { class: "a11y-badge num", text: `×${f.count}` }) : null,
      h("span", { class: `a11y-kind kind-${f.kind}`, text: KIND_LABEL[f.kind] }),
    );
    // Row differentiator: what the element says (identical snippets for different elements, e.g.
    // 200 low-contrast links), then its selector.
    const nameEl = li.querySelector(".a11y-item-name");
    const name = f.name ? `“${f.name}”` : "";
    setText(nameEl, name);
    nameEl.hidden = !name;
    nameEl.title = f.name || "";
    const src = li.querySelector(".item-source");
    const where = f.selector || f.xpath;
    setText(src, where);
    src.title = where;
    li.setAttribute("aria-label", `${IMPACT_LABEL[f.impact]} ${KIND_LABEL[f.kind].toLowerCase()}: ${msg}.${f.name ? ` ${f.name}.` : ""} ${where}${also.length ? `. Also WCAG ${also.join(", ")}` : ""}`);
  }

  function renderDetail(f) {
    const readOnly = !!importedData();
    const rule = R.unifiedRule(f.ruleId);
    const crits = criteriaOf(f);
    const where = f.selector || f.xpath;
    replaceChildren(
      detail,
      h(
        "div",
        { class: "detail a11y-detail" },
        h(
          "header",
          { class: "detail-head" },
          h("h2", { class: "detail-title", text: cleanMessage(f.message) || rule?.title || f.ruleId }),
          h(
            "div",
            { class: "chips" },
            h("span", { class: `chip a11y-impact-chip impact-${f.impact}`, text: IMPACT_LABEL[f.impact] }),
            h("span", { class: `chip a11y-kind-chip kind-${f.kind}`, text: KIND_LABEL[f.kind] }),
            crits.map((c) => h("span", { class: "chip", title: wcagTitle(c), text: `WCAG ${c} · ${R.wcagCriterion(c)?.level || ""}` })),
            f.bestPractice ? h("span", { class: "chip", text: "Best practice" }) : null,
            f.count > 1 ? h("span", { class: "chip", text: `${f.count}× on this element` }) : null,
          ),
        ),
        f.kind === "review" ? h("p", { class: "caption a11y-review-note", text: "Possible issue: automated checks can't decide this one. Look at the element and confirm whether it meets the requirement." }) : null,
        h(
          "div",
          { class: "block" },
          h("h3", { text: "How to fix" }),
          h("p", { class: "a11y-help", text: f.help || rule?.help || "—" }),
          rule?.description ? h("p", { class: "caption muted a11y-rule-desc", text: rule.description }) : null,
          f.detail ? h("p", { class: "caption a11y-detail-note" }, h("span", { class: "muted", text: "Detail: " }), h("span", { class: "mono", text: f.detail })) : null,
        ),
        crits.length
          ? h(
              "div",
              { class: "block" },
              h("h3", { text: "WCAG" }),
              h(
                "ul",
                { class: "a11y-wcag-links" },
                crits.map((c) =>
                  h("li", null, h("a", { class: "btn-link a11y-wcag-link", href: wcagUrl(c), target: "_blank", rel: "noopener noreferrer" }, h("span", { text: `Understanding ${c} ${wcagTitle(c)} (Level ${R.wcagCriterion(c)?.level || "?"})` }), glyph("external", 12))),
                ),
              ),
            )
          : null,
        h(
          "div",
          { class: "block" },
          h("h3", { text: "Element" }),
          f.name ? h("p", { class: "caption a11y-detail-name" }, h("span", { class: "muted", text: "Text: " }), h("span", { text: `“${f.name}”` })) : null,
          h("pre", { class: "code a11y-snippet" }, h("code", { text: f.snippet || "—" })),
        ),
        h(
          "div",
          { class: "block" },
          h("h3", { text: "Selector" }),
          h("div", { class: "a11y-selector" }, h("code", { class: "mono a11y-selector-text", title: where, text: where })),
          h(
            "div",
            { class: "detail-actions" },
            h("button", { type: "button", class: "btn btn-accent", disabled: readOnly, title: readOnly ? "Not available for an imported bundle" : null, onClick: () => inspectFinding(f) }, glyph("inspect", 14), h("span", { text: "Inspect in Elements" })),
            h("button", { type: "button", class: "btn", disabled: readOnly, title: readOnly ? "Not available for an imported bundle" : null, onClick: () => highlightFinding(f) }, glyph("target", 14), h("span", { text: "Highlight on page" })),
          ),
        ),
        h("div", { class: "block block-meta" }, h("h3", { text: "Rule" }), h("dl", { class: "kv" }, kv("Rule", f.ruleId), kv("Requirement", rule?.title || f.message), kv("Finding id", f.id))),
      ),
    );
  }

  // ── WCAG coverage view ──

  const STATUS_LABEL = { failing: "Failing", review: "Needs review", passed: "Passed (automated)", untested: "No automated check", unchecked: "Not checked" };

  function renderWcagView(r) {
    const std = shownStandard();
    const cov = R.criteriaCoverage(r, std);
    const n = (st2) => cov.filter((c) => c.status === st2).length;
    const summary = h(
      "div",
      { class: "a11y-cov-summary" },
      h("h2", { class: "a11y-cov-title", text: `${R.standardLabel(std)} · ${pluralize(cov.length, "success criterion", "success criteria")}` }),
      h(
        "div",
        { class: "a11y-cov-stats" },
        stat("failing", n("failing"), "failing"),
        stat("review", n("review"), "need review"),
        stat("passed", n("passed"), "passed automated checks"),
        stat("untested", n("untested"), "have no automated check"),
      ),
      h("p", { class: "caption muted", text: "“Passed” means no automated rule found a problem — it does not prove conformance. Criteria without automated checks need manual testing." }),
    );
    const rows = cov.map((c) =>
      h(
        "li",
        { class: `a11y-cov-row status-${c.status}` },
        h(
          "button",
          { type: "button", class: "a11y-cov-btn", disabled: c.errors + c.reviews === 0, title: c.errors + c.reviews ? "Show the findings for this criterion" : null, onClick: () => showIssues({ criterion: c.num }) },
          h("span", { class: `a11y-status-dot status-${c.status}`, "aria-hidden": "true" }),
          h("span", { class: "a11y-cov-num mono", text: c.num }),
          ellipsis(c.name, "a11y-cov-name"),
          h("span", { class: "chip chip-tiny", text: c.level }),
          c.version !== "2.0" ? h("span", { class: "chip chip-tiny a11y-cov-ver", text: `new in ${c.version}` }) : null,
          h("span", { class: "spacer" }),
          h("span", { class: `a11y-status status-${c.status}`, text: c.status === "failing" ? `Failing · ${c.errors}` : c.status === "review" ? `Needs review · ${c.reviews}` : STATUS_LABEL[c.status] }),
          h("span", { class: "a11y-cov-rules caption muted", text: c.rules.length ? pluralize(c.rules.length, "rule") : "" }),
        ),
      ),
    );
    replaceChildren(coverageEl, summary, h("ul", { class: "a11y-cov-list", "aria-label": "Success criteria" }, rows));
    if (!body.contains(coverageEl)) replaceChildren(body, coverageEl);
  }

  function renderRulesView(r) {
    const std = shownStandard();
    const rules = R.rulesCoverage(r, std);
    const n = (x) => rules.filter((c) => c.status === x).length;
    const summary = h(
      "div",
      { class: "a11y-cov-summary" },
      h("h2", { class: "a11y-cov-title", text: `${pluralize(rules.length, "rule")} in ${R.standardLabel(std)}${std.bestPractices ? " (with best practices)" : ""} · ${RULE_COUNT} in total` }),
      h("div", { class: "a11y-cov-stats" }, stat("failing", n("failing"), "failing"), stat("review", n("review"), "need review"), stat("passed", n("passed"), "passed"), stat("unchecked", n("unchecked"), "not checked on this page")),
    );
    const rows = rules.map(({ rule, status, findings }) =>
      h(
        "li",
        { class: `a11y-cov-row status-${status}` },
        h(
          "button",
          { type: "button", class: "a11y-cov-btn a11y-rule-btn", disabled: findings === 0, title: rule.description, onClick: () => showIssues({ rule: rule.id }) },
          h("span", { class: `a11y-status-dot status-${status}`, "aria-hidden": "true" }),
          h("span", { class: "a11y-rule-main" }, ellipsis(rule.title, "a11y-cov-name"), h("span", { class: "a11y-rule-id mono caption muted", text: rule.id })),
          h("span", { class: "spacer" }),
          rule.wcag.length ? rule.wcag.map((w) => h("span", { class: "chip chip-tiny", title: wcagTitle(w.criterion), text: `${w.criterion} ${w.level}` })) : h("span", { class: "chip chip-tiny", text: "Best practice" }),
          h("span", { class: `a11y-status status-${status}`, text: status === "failing" || status === "review" ? `${STATUS_LABEL[status]} · ${findings}` : STATUS_LABEL[status] }),
        ),
      ),
    );
    replaceChildren(coverageEl, summary, h("ul", { class: "a11y-cov-list", "aria-label": "Rules" }, rows));
    if (!body.contains(coverageEl)) replaceChildren(body, coverageEl);
  }

  function introState() {
    return emptyState({
      iconName: "check",
      title: "Audit this page for accessibility",
      body: `Checks ${RULE_COUNT} accessibility rules against the live DOM — computed names, real visibility, focusability and color contrast — for ${R.standardLabel(st.standard)}. Form values never leave the page.`,
      action: h("button", { type: "button", class: "btn btn-accent", onClick: () => scan({ reset: true }) }, icon("play", 14), h("span", { text: "Run audit" })),
    });
  }

  function importedState() {
    return emptyState({
      iconName: "import",
      title: "Accessibility audits run live — return to live to scan",
      body: "This imported bundle doesn't include accessibility results.",
      action: ctx.store ? h("button", { type: "button", class: "btn", text: "Return to live", onClick: () => ctx.store.clearImported() }) : null,
    });
  }

  function errorState() {
    return emptyState({
      iconName: "warning",
      title: "Couldn't audit this page",
      body: h(
        "div",
        { class: "empty-body" },
        h("p", { class: "mono a11y-error-text", text: st.error }),
        h("p", { class: "caption muted", text: "DevTools can't run scripts on chrome:// pages, the Chrome Web Store or other extensions' pages. Reload the page and try again." }),
      ),
      action: h("button", { type: "button", class: "btn btn-accent", onClick: () => scan({ reset: true }) }, icon("refresh", 14), h("span", { text: "Try again" })),
    });
  }

  function destroy() {
    clearInterval(liveTimer);
    clearTimeout(navTimer);
    clearTimeout(noticeTimer);
    stopTicker();
    scanGen++;
    try {
      unsubscribeNav();
    } catch {
      /* ignore */
    }
    if (st.live) evalInPage(UNWATCH_EXPR).catch(() => null);
  }

  return {
    el,
    render,
    rescan: () => scan({ reset: true }),
    cancel: () => cancelScan(),
    onNavigated,
    destroy,
    /** Latest live unified audit report (with hidden sources, standard and engine timings), or null. Included in Export. */
    getReport: () => st.report,
    focusSearch: () => {
      if (body.contains(issuesEl)) search.input.focus();
    },
    clearSearch: () => setFilter({ search: "" }),
    /** For tests: current state snapshot. */
    get state() {
      return { report: st.report, scanning: st.scanning, error: st.error, live: st.live, selectedId: st.selectedId, stale: st.stale, standard: st.standard, view: st.view, parts: Object.keys(st.parts) };
    },
    setStandard,
    select,
  };
}

// ── Small render helpers ─────────────────────────────────────────────────────────────────────────

function scoreRing(score, busy) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const grade = busy && score === null ? "none" : gradeForScore(score);
  return s(
    "svg",
    { class: `score-ring a11y-ring grade-${grade}`, viewBox: "0 0 64 64", width: 64, height: 64, role: "img", "aria-label": `Accessibility score ${score ?? "not available"}` },
    s("circle", { class: "ring-track", cx: 32, cy: 32, r, fill: "none", "stroke-width": 6 }),
    score === null || score === 0 ? null : s("circle", { class: "ring-value", cx: 32, cy: 32, r, fill: "none", "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": `${(score / 100) * c} ${c}`, transform: "rotate(-90 32 32)" }),
    s("text", { class: "ring-text a11y-ring-text", x: 32, y: 37, "text-anchor": "middle", text: score === null ? "—" : String(score) }),
  );
}

function countPill(kind, n, many, one) {
  return h("span", { class: `a11y-count kind-${kind}` }, h("strong", { class: "num", text: String(n) }), h("span", { text: ` ${n === 1 ? one : many}` }));
}

function stat(status, n, label) {
  return h("span", { class: `a11y-stat status-${status}` }, h("span", { class: `a11y-status-dot status-${status}`, "aria-hidden": "true" }), h("strong", { class: "num", text: String(n) }), h("span", { text: ` ${label}` }));
}

function placeholder(text) {
  return h("div", { class: "detail-placeholder" }, glyph("person", 24), h("p", { text }), h("p", { class: "caption muted", text: "↑/↓ to move · Enter to select · / to search" }));
}

function kv(k, v) {
  return [h("dt", { text: k }), h("dd", { title: v }, ellipsis(v, k === "Requirement" ? "" : "mono"))];
}
