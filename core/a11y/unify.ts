// Unification: folds engine-level reports (A11yInspect port, IBM Equal Access, axe-core) into ONE
// report over the unified rule set (catalog/unified.ts). DOM-free (works in the DevTools panel on
// validated page results):
//   - each source finding -> its unified rule (refined by the element's tag/role from the snippet)
//   - one finding per element + unified rule; kind = most severe (error > review > warning),
//     impact = most severe; the source results are kept in the hidden `sources` field
//   - filtered by the standard (WCAG version x level / Section 508 / EN 301 549, best practices,
//     needs review), then counts and score are recomputed.
import { FALLBACK_RULE, NESTED_INTO, NESTED_POLICY, NOTICE_RULES, PAGE_RULES, SUBSUMED_BY, UNIFIED_RULES, refineRule, ruleInStandard, sourceKey, unifiedRule, unifiedRuleForSource, type UnifiedRule } from "./catalog/unified.js";
import { computeScore, countFindings } from "./score.js";
import { A11Y_ENGINE_VERSION } from "./version.js";
import { IMPACT_RANK, KIND_RANK, SEVERITY_FOR_IMPACT, comparePositions, fnv1a, positionContains } from "./sourceUtil.js";
import type { A11yEngineId, A11yEngineRun, A11yFinding, A11yReport, A11ySource } from "./types.js";
import { criteriaForStandard, criterionInStandard, normalizeStandard, wcagCriterion, type A11yStandard } from "./wcag.js";

export interface MergeOptions {
  standard?: Partial<A11yStandard>;
  /** Default 2000. */
  maxFindings?: number;
}

/** Tag / role / type parsed from a (redacted) opening-tag snippet. */
export interface ElementShape {
  tag: string;
  role: string;
  type: string;
  href: boolean;
}

export function shapeFromSnippet(snippet: string): ElementShape {
  const s = String(snippet || "");
  const tag = (/^<\s*([a-zA-Z][\w:-]*)/.exec(s)?.[1] || "").toLowerCase();
  const attr = (name: string) => (new RegExp(`\\s${name}="([^"]*)"`, "i").exec(s)?.[1] || "").trim().toLowerCase();
  return { tag, role: attr("role").split(/\s+/)[0] || "", type: attr("type"), href: /\shref(=|\s|>)/i.test(s) };
}

/** Matches an element shape like Element.matches would for the few selectors refinement uses. */
function shapeElement(shape: ElementShape): Element {
  const matches = (sel: string): boolean =>
    sel.split(",").some((part) => {
      const p = part.trim();
      const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(p);
      if (!m) return false;
      if (m[1] && m[1].toLowerCase() !== shape.tag) return false;
      for (const a of m[2].match(/\[[^\]]+\]/g) || []) {
        const am = /^\[([\w-]+)(?:="([^"]*)"(?:\s+i)?)?\]$/.exec(a);
        if (!am) return false;
        const [, name, val] = am;
        const actual = name === "role" ? shape.role : name === "type" ? shape.type : name === "href" ? (shape.href ? "x" : "") : "";
        if (val === undefined ? !actual : actual !== val.toLowerCase()) return false;
      }
      return true;
    });
  return { matches, localName: shape.tag } as unknown as Element;
}

const SOURCE_RULE_INDEX = (() => {
  // "engine:rule" -> unified rule ids (A11yInspect keys are per check; index them by rule too).
  const m = new Map<string, Set<string>>();
  for (const r of UNIFIED_RULES)
    for (const s of r.sources) {
      const k = s.startsWith("a11yinspect:") ? s.slice(0, s.indexOf("/")) : s;
      let set = m.get(k);
      if (!set) m.set(k, (set = new Set()));
      set.add(r.id);
    }
  return m;
})();

/** Unified rule ids whose sources ran in these engine reports. */
export function checkedRuleIds(reports: readonly A11yReport[]): Set<string> {
  const out = new Set<string>();
  for (const rep of reports) {
    if (!rep || rep.error) continue;
    const engine: A11yEngineId = rep.engine ?? "a11yinspect";
    for (const rule of rep.sourceRules ?? []) for (const id of SOURCE_RULE_INDEX.get(`${engine}:${rule}`) ?? []) out.add(id);
  }
  return out;
}

interface Acc {
  rule: UnifiedRule;
  f: A11yFinding;
  order: number;
  /** Where the finding is: "page", "n:<node key>" (the live element) or "s:<selector>" (no node key). */
  loc: string;
}

/** Tags a page-level rule may be anchored on (engines pick different ones for "the page"). */
const PAGE_TAGS = new Set(["html", "head", "body"]);
const RULE_ORDER = new Map<string, number>(UNIFIED_RULES.map((r, i) => [r.id, i]));

interface NodeInfo {
  selector: string;
  xpath?: string;
  pos?: string;
  name?: string;
  ts: number;
}

interface NodeIndex {
  byNode: Map<string, NodeInfo>;
  /** Canonical selector -> node key (for findings without a node key, e.g. older imports). */
  bySelector: Map<string, string>;
  /** Node key of an older run -> the newer node now at the same selector (re-rendered element). */
  alias: Map<string, string>;
}

/**
 * Canonical selector / position per node key: the one from the most recent engine run (the DOM can
 * change between runs), so every finding of an element shows the same selector. Within one run
 * selectors are unique; the same selector under two node keys from DIFFERENT runs means the page
 * replaced the element in place (a rescan merging a fresh part with older ones): the older key
 * becomes an alias of the newer, so the element is not listed twice while the parts refresh.
 */
function indexNodes(reports: readonly A11yReport[]): NodeIndex {
  const byNode = new Map<string, NodeInfo>();
  for (const rep of reports) {
    const ts = Number(rep.timestamp) || 0;
    for (const f of rep.findings || []) {
      if (!f || typeof f.node !== "string" || !f.node || !f.selector) continue;
      const cur = byNode.get(f.node);
      if (!cur || ts > cur.ts) byNode.set(f.node, { selector: f.selector, xpath: f.xpath, pos: f.pos, name: f.name ?? cur?.name, ts });
      else if (!cur.name && f.name) cur.name = f.name;
    }
  }
  const bySelector = new Map<string, string>();
  const alias = new Map<string, string>();
  const newestFirst = [...byNode].sort((a, b) => b[1].ts - a[1].ts);
  for (const [k, v] of newestFirst) {
    const owner = bySelector.get(v.selector);
    if (owner === undefined) bySelector.set(v.selector, k);
    else if (byNode.get(owner)!.ts > v.ts) alias.set(k, owner);
  }
  return { byNode, bySelector, alias };
}

function addSource(f: A11yFinding, s: A11ySource): void {
  const sources = f.sources!;
  if (sources.length < 12 && !sources.some((x) => x.engine === s.engine && x.rule === s.rule && x.check === s.check && x.kind === s.kind)) sources.push(s);
}

function mergeSeverity(f: A11yFinding, kind: A11yFinding["kind"], impact: A11yFinding["impact"]): void {
  if (KIND_RANK[kind] < KIND_RANK[f.kind]) f.kind = kind;
  if (IMPACT_RANK[impact] < IMPACT_RANK[f.impact]) {
    f.impact = impact;
    f.severity = SEVERITY_FOR_IMPACT[impact];
  }
}

function mergeDetail(f: A11yFinding, detail: string | undefined): void {
  if (!detail) return;
  const parts = f.detail ? f.detail.split("; ") : [];
  for (const d of detail.split("; ")) if (d && !parts.includes(d) && parts.length < 4) parts.push(d);
  if (parts.length) f.detail = parts.join("; ").slice(0, 300);
}

const isHtmlSnippet = (s: string | undefined) => /^<html[\s>]/.test(s || "");

function mergeSource(acc: Acc, src: A11yFinding, engine: A11yEngineId): void {
  const f = acc.f;
  mergeSeverity(f, src.kind, src.impact);
  const c = Math.max(f.count ?? 1, src.count ?? 1);
  if (c > 1) f.count = c;
  if (acc.loc === "page" && !isHtmlSnippet(f.snippet) && isHtmlSnippet(src.snippet)) {
    // A page-level finding shows <html> once any engine anchored it there.
    f.snippet = src.snippet;
    f.selector = "html";
    f.pos = "1";
  } else if (!f.snippet && src.snippet) f.snippet = src.snippet;
  mergeDetail(f, src.detail);
  addSource(f, { engine, rule: src.ruleId, check: src.check || undefined, kind: src.kind });
}

/** Folds `from` into `into` (the same problem reported twice): most severe kind / impact, all sources. */
function absorb(into: Acc, from: Acc): void {
  const f = into.f;
  mergeSeverity(f, from.f.kind, from.f.impact);
  mergeDetail(f, from.f.detail);
  for (const s of from.f.sources ?? []) addSource(f, s);
}

/**
 * Collapses one problem reported twice: under two rules on one element (SUBSUMED_BY), as an icon
 * inside an unnamed control (NESTED_INTO), or under one rule on an element and its descendant
 * (NESTED_POLICY); see catalog/unified.ts. Returns the accumulators that stay.
 */
function collapse(accs: Acc[]): Acc[] {
  const gone = new Set<Acc>();
  const byLoc = new Map<string, Map<string, Acc>>();
  for (const a of accs) {
    let m = byLoc.get(a.loc);
    if (!m) byLoc.set(a.loc, (m = new Map()));
    m.set(a.rule.id, a);
  }
  for (const a of accs) {
    const by = SUBSUMED_BY[a.rule.id];
    if (!by) continue;
    const m = byLoc.get(a.loc)!;
    const into = by.map((id) => m.get(id)).find((x): x is Acc => !!x && !gone.has(x));
    if (!into) continue;
    absorb(into, a);
    gone.add(a);
  }
  // An icon finding inside a control flagged for its missing name.
  const byRulePos = new Map<string, Acc>();
  for (const a of accs) if (a.f.pos && !gone.has(a)) byRulePos.set(`${a.rule.id}|${a.f.pos}`, a);
  for (const a of accs) {
    const into = NESTED_INTO[a.rule.id];
    if (!into || !a.f.pos || gone.has(a)) continue;
    const steps = a.f.pos.split(".");
    let target: Acc | undefined;
    for (let n = steps.length - 1; n > 0 && !target; n--) {
      const p = steps.slice(0, n).join(".");
      for (const id of into) {
        const t = byRulePos.get(`${id}|${p}`);
        if (t && !gone.has(t)) {
          target = t;
          break;
        }
      }
    }
    if (!target) continue;
    absorb(target, a);
    gone.add(a);
  }
  const byRule = new Map<string, Acc[]>();
  for (const a of accs) {
    if (gone.has(a) || !NESTED_POLICY[a.rule.id] || !a.f.pos) continue;
    let l = byRule.get(a.rule.id);
    if (!l) byRule.set(a.rule.id, (l = []));
    l.push(a);
  }
  for (const [ruleId, list] of byRule) {
    if (list.length < 2) continue;
    list.sort((x, y) => comparePositions(x.f.pos, y.f.pos));
    if (NESTED_POLICY[ruleId] === "outer") {
      // Keep the outermost element; findings on its descendants fold into it.
      let top: Acc | null = null;
      for (const a of list) {
        if (top && positionContains(top.f.pos, a.f.pos)) {
          absorb(top, a);
          gone.add(a);
        } else top = a;
      }
    } else {
      // Keep the innermost element: an ancestor folds into its first flagged descendant (in
      // document order, descendants directly follow their ancestor).
      const into = new Map<Acc, Acc>();
      for (let i = list.length - 2; i >= 0; i--) {
        const a = list[i];
        const next = list[i + 1];
        if (!positionContains(a.f.pos, next.f.pos)) continue;
        const target = into.get(next) ?? next;
        absorb(target, a);
        into.set(a, target);
        gone.add(a);
      }
    }
  }
  return accs.filter((a) => !gone.has(a));
}

/**
 * Merges engine-level reports into one unified report (see file comment). Findings are keyed by the
 * element (`node`, the per-page identity every adapter records) + unified rule, so one element
 * described in three selector formats is one finding with one canonical selector. Reports that are
 * already unified (findings carrying `sources`) are expanded back into their sources first, so
 * merging is idempotent and a unified report can be re-filtered with another standard. Findings are
 * ordered by impact, kind, rule (catalog order), then document order.
 */
export function mergeA11yReports(reports: ReadonlyArray<A11yReport | null | undefined>, options: MergeOptions = {}): A11yReport {
  const standard = normalizeStandard(options.standard);
  const maxFindings = Math.max(1, Math.floor(options.maxFindings ?? 2000));
  const list = reports.filter((r): r is A11yReport => !!r && typeof r === "object");
  const accs = new Map<string, Acc>();
  let order = 0;
  let dropped = 0;
  const runs: A11yEngineRun[] = [];
  const engineReports: A11yReport[] = [];
  for (const rep of list) engineReports.push(...expandUnified(rep));
  const nodes = indexNodes(engineReports);

  for (const er of engineReports) {
    const engine: A11yEngineId = er.engine ?? "a11yinspect";
    let n = 0;
    for (let src of er.findings || []) {
      if (!src || typeof src !== "object") continue;
      const eng: A11yEngineId = src.engine ?? engine;
      const shape = shapeFromSnippet(src.snippet);
      // A source expanded from a unified finding stays with that finding's rule (it may have been
      // folded into it from another rule / a descendant; see collapse()).
      const merged = EXPANDED_RULE.get(src);
      const rule = (merged && unifiedRule(merged)) || refineRule(unifiedRuleForSource(eng, src.ruleId, src.check) ?? FALLBACK_RULE, shapeElement(shape));
      if (!ruleInStandard(rule, standard) && !(rule === FALLBACK_RULE && fallbackInStandard(src, standard))) continue;
      if (src.kind === "review" && !standard.includeReview) continue;
      n++;
      if (NOTICE_RULES.has(rule.id)) src = { ...src, impact: "info" };
      const where = src.selector || src.xpath || "";
      const rawK = (typeof src.node === "string" && src.node) || (where ? nodes.bySelector.get(where) : undefined) || "";
      const nodeK = nodes.alias.get(rawK) ?? rawK;
      // Page-level rule on the TOP document's html/head/body (position "1", "1.x"); a frame's
      // document is another page and keeps its own finding.
      const page = PAGE_RULES.has(rule.id) && (src.pos ? PAGE_TAGS.has(shape.tag) && src.pos.split(".").length <= 2 : PAGE_TAGS.has(where));
      const loc = page ? "page" : nodeK ? `n:${nodeK}` : `s:${where}`;
      const key = `${rule.id}|${loc}`;
      const acc = accs.get(key);
      if (acc) {
        mergeSource(acc, src, eng);
        continue;
      }
      if (accs.size >= maxFindings) {
        dropped++;
        continue;
      }
      const info = !page && nodeK ? nodes.byNode.get(nodeK) : undefined;
      const selector = page ? (isHtmlSnippet(src.snippet) ? "html" : where) : info?.selector || where;
      const xpath = page ? undefined : info ? info.xpath : src.xpath;
      const pos = page ? (isHtmlSnippet(src.snippet) ? "1" : src.pos) : info?.pos || src.pos;
      const criteria = rule === FALLBACK_RULE ? (src.wcag ? [src.wcag] : []) : rule.wcag.map((w) => w.criterion);
      const primary = criteria.find((c) => criterionInStandard(c, standard)) || criteria[0] || "";
      const f: A11yFinding = {
        id: "",
        ruleId: rule.id,
        check: src.check || "",
        kind: src.kind,
        impact: src.impact,
        severity: SEVERITY_FOR_IMPACT[src.impact],
        wcag: primary,
        level: primary ? wcagCriterion(primary)?.level ?? null : null,
        message: rule.title,
        help: rule.help,
        selector,
        snippet: src.snippet,
        criteria,
        sources: [{ engine: eng, rule: src.ruleId, check: src.check || undefined, kind: src.kind }],
      };
      if (!criteria.length) f.bestPractice = true;
      if (src.detail) f.detail = src.detail;
      if (src.count && src.count > 1) f.count = src.count;
      if (xpath) f.xpath = xpath;
      if (nodeK && !page) f.node = nodeK;
      const name = page ? "" : info?.name || src.name;
      if (name) f.name = name;
      if (pos) f.pos = pos;
      accs.set(key, { rule, f, order: order++, loc });
    }
    runs.push({ engine, version: String(er.engineVersion || ""), durationMs: Number(er.durationMs) || 0, findings: n, ...(er.error ? { error: er.error } : {}), ...(er.truncated ? { truncated: true } : {}) });
  }

  const all = collapse([...accs.values()]);
  all.sort(
    (a, b) =>
      IMPACT_RANK[a.f.impact] - IMPACT_RANK[b.f.impact] ||
      KIND_RANK[a.f.kind] - KIND_RANK[b.f.kind] ||
      (RULE_ORDER.get(a.rule.id) ?? RULE_ORDER.size) - (RULE_ORDER.get(b.rule.id) ?? RULE_ORDER.size) ||
      comparePositions(a.f.pos, b.f.pos) ||
      (a.f.selector < b.f.selector ? -1 : a.f.selector > b.f.selector ? 1 : 0) ||
      a.order - b.order,
  );
  // Ids are stable across rescans while the element's selector is (hash of rule + canonical selector).
  const ids = new Set<string>();
  for (const a of all) {
    const baseId = "a11y-" + fnv1a(`${a.rule.id}|${a.f.selector}`);
    let id = baseId;
    for (let i = 2; ids.has(id); i++) id = `${baseId}-${i}`;
    ids.add(id);
    a.f.id = id;
  }
  const findings = all.map((a) => a.f);
  const checkedSet = checkedRuleIds(engineReports);
  // Unified inputs (imports, re-filtering) keep the rules that were checked when they were scanned.
  for (const rep of list) if (!rep.engine && Array.isArray(rep.rulesChecked)) for (const id of rep.rulesChecked) checkedSet.add(id);
  const checked = [...checkedSet].filter((id) => {
    const r = UNIFIED_RULES.find((x) => x.id === id);
    return !!r && ruleInStandard(r, standard);
  });
  const first = list[0];
  const ok = engineReports.filter((r) => !r.error);
  const report: A11yReport = {
    url: first?.url ?? "",
    title: first?.title ?? "",
    timestamp: first?.timestamp ?? Date.now(),
    durationMs: Math.round(engineReports.reduce((s, r) => s + (Number(r.durationMs) || 0), 0) * 10) / 10,
    rulesRun: checked.length,
    elementsScanned: engineReports.reduce((m, r) => Math.max(m, Number(r.elementsScanned) || 0), 0),
    findings,
    counts: countFindings(findings),
    score: computeScore(findings),
    truncated: dropped > 0 || engineReports.some((r) => r.truncated),
    droppedFindings: dropped + engineReports.reduce((s, r) => s + (Number(r.droppedFindings) || 0), 0),
    engineVersion: A11Y_ENGINE_VERSION,
    standard,
    rulesChecked: checked.sort(),
    engines: runs,
  };
  if (!ok.length && engineReports.length) report.error = engineReports.find((r) => r.error)?.error || "Audit failed";
  return report;
}

function fallbackInStandard(src: A11yFinding, s: A11yStandard): boolean {
  return src.wcag ? criterionInStandard(src.wcag, s) : s.bestPractices;
}

/** Expanded source finding -> the unified rule of the finding it came from. */
const EXPANDED_RULE = new WeakMap<A11yFinding, string>();

/** A unified report back to per-engine source reports (for re-merging with another standard). */
function expandUnified(rep: A11yReport): A11yReport[] {
  const isUnified = !rep.engine && (rep.findings || []).some((f) => Array.isArray(f.sources) && f.sources.length);
  if (!isUnified) return [rep];
  const byEngine = new Map<A11yEngineId, A11yFinding[]>();
  for (const f of rep.findings) {
    for (const s of f.sources ?? []) {
      let arr = byEngine.get(s.engine);
      if (!arr) byEngine.set(s.engine, (arr = []));
      const src: A11yFinding = { ...f, ruleId: s.rule, check: s.check ?? "", kind: s.kind, engine: s.engine, sources: undefined };
      EXPANDED_RULE.set(src, f.ruleId);
      arr.push(src);
    }
  }
  return [...byEngine].map(([engine, findings]) => {
    const run = rep.engines?.find((e) => e.engine === engine);
    return { ...rep, engine, findings, durationMs: run?.durationMs ?? 0, engineVersion: run?.version ?? "", sourceRules: [], engines: undefined };
  });
}

// ── Coverage views ──

export type CriterionStatus = "failing" | "review" | "passed" | "untested";

export interface CriterionCoverage {
  num: string;
  name: string;
  level: "A" | "AA" | "AAA";
  version: "2.0" | "2.1" | "2.2";
  status: CriterionStatus;
  errors: number;
  /** Warnings + needs-review findings. */
  reviews: number;
  /** Unified rules checking this criterion that ran. */
  rules: string[];
}

/** Every success criterion of the report's standard with its automated status. */
export function criteriaCoverage(report: A11yReport | null, standard?: Partial<A11yStandard>): CriterionCoverage[] {
  const s = normalizeStandard(standard ?? report?.standard);
  const checked = new Set(report?.rulesChecked ?? []);
  const errors = new Map<string, number>();
  const reviews = new Map<string, number>();
  for (const f of report?.findings ?? []) {
    for (const c of f.criteria ?? (f.wcag ? [f.wcag] : [])) {
      const m = f.kind === "error" ? errors : reviews;
      m.set(c, (m.get(c) || 0) + 1);
    }
  }
  return criteriaForStandard(s).map((c) => {
    const rules = UNIFIED_RULES.filter((r) => checked.has(r.id) && r.wcag.some((w) => w.criterion === c.num)).map((r) => r.id);
    const e = errors.get(c.num) || 0;
    const r = reviews.get(c.num) || 0;
    const status: CriterionStatus = e ? "failing" : r ? "review" : rules.length ? "passed" : "untested";
    return { num: c.num, name: c.name, level: c.level, version: c.version, status, errors: e, reviews: r, rules };
  });
}

export type RuleStatus = "failing" | "review" | "passed" | "unchecked";

export interface RuleCoverage {
  rule: UnifiedRule;
  status: RuleStatus;
  findings: number;
}

/** Unified rules of the standard with their status in the report. */
export function rulesCoverage(report: A11yReport | null, standard?: Partial<A11yStandard>): RuleCoverage[] {
  const s = normalizeStandard(standard ?? report?.standard);
  const checked = new Set(report?.rulesChecked ?? []);
  const errors = new Map<string, number>();
  const other = new Map<string, number>();
  for (const f of report?.findings ?? []) {
    const m = f.kind === "error" ? errors : other;
    m.set(f.ruleId, (m.get(f.ruleId) || 0) + 1);
  }
  return UNIFIED_RULES.filter((r) => ruleInStandard(r, s)).map((rule) => {
    const e = errors.get(rule.id) || 0;
    const o = other.get(rule.id) || 0;
    const status: RuleStatus = e ? "failing" : o ? "review" : checked.has(rule.id) ? "passed" : "unchecked";
    return { rule, status, findings: e + o };
  });
}

export { sourceKey };
export type { A11ySource };
