// Adapter for the IBM Equal Access engine (accessibility-checker-engine, Apache-2.0), shipped
// unchanged as extension/vendor/ibm-ace.js. The `ace` object is passed in, so core has no runtime
// dependency on the package. Produces an engine-level A11yReport (source rule ids); the unified
// rule set is applied by mergeA11yReports (unify.ts).
//
// Result mapping (value = [policy, confidence]):
//   VIOLATION + FAIL           -> error    impact critical (IBM toolkit level 1) / major
//   VIOLATION + POTENTIAL      -> review   impact major (toolkit level 1) / minor
//   RECOMMENDATION + FAIL      -> warning  impact minor
//   RECOMMENDATION + POTENTIAL -> warning  impact info
//   INFORMATION + FAIL/POTENTIAL -> warning impact info
//   * + MANUAL                 -> dropped (includeManual: review, impact info)
//   * + PASS                   -> dropped
// NOTE: ace's check() is synchronous internally (the promise resolves after the whole scan).
import { DomCache, snippet, snippetFromMarkup } from "./dom.js";
import { countFindings, computeScore, emptyCounts } from "./score.js";
import { IBM_ACE_VERSION } from "./loaders.js";
import { IMPACT_RANK, KIND_RANK, canonicalSelector, docOf, elementPosition, fnv1a, isElement, namePreview, nodeKey, type PositionMemo, nowMs, pageTitle, pageUrl, resolveXPath, SEVERITY_FOR_IMPACT } from "./sourceUtil.js";
import type { A11yFinding, A11yImpact, A11yKind, A11yLevel, A11yReport } from "./types.js";
import { normalizeStandard, type A11yStandard } from "./wcag.js";

export interface IbmResult {
  ruleId: string;
  reasonId?: string | number;
  value: [string, string] | string[];
  path?: { dom?: string; aria?: string };
  message?: string;
  messageArgs?: unknown[];
  snippet?: string;
  node?: unknown;
}

export interface IbmReportLike {
  results: IbmResult[];
  numExecuted?: number;
}

export interface IbmCheckpoint {
  num: string;
  wcagLevel?: string;
  rules?: Array<{ id: string; level?: string; toolkitLevel?: string }>;
}

export interface IbmGuideline {
  id: string;
  checkpoints: IbmCheckpoint[];
}

export interface IbmChecker {
  check(root: Document | Element, rulesets: string[]): Promise<IbmReportLike>;
  getGuidelines(): IbmGuideline[];
  rulesetRules?: Record<string, string[]>;
}

export interface AceLike {
  Checker: new () => IbmChecker;
}

export interface IbmMapOptions {
  /** Document used to resolve result paths when results carry no live node. */
  doc?: Document | null;
  /** Guidelines (checker.getGuidelines()) for WCAG / toolkit-level metadata. */
  guidelines?: IbmGuideline[];
  /** Map MANUAL results to "review" instead of dropping them. Default false. */
  includeManual?: boolean;
  /** Default 1000. */
  maxFindings?: number;
}

export interface IbmAuditOptions extends Omit<IbmMapOptions, "doc" | "guidelines"> {
  standard?: Partial<A11yStandard>;
  /** Engine version reported in engineVersion (default: the vendored version). */
  version?: string;
}

/** IBM ruleset for a standard: the WCAG version's ruleset, or IBM_Accessibility (superset) for best practices / 508 / EN. */
export function ibmRulesetFor(standard: Partial<A11yStandard> | undefined): string {
  const s = normalizeStandard(standard);
  if (s.profile !== "wcag" || s.bestPractices) return "IBM_Accessibility";
  return s.version === "2.0" ? "WCAG_2_0" : s.version === "2.1" ? "WCAG_2_1" : "WCAG_2_2";
}

interface RuleMeta {
  wcag: string;
  level: A11yLevel | null;
  toolkitLevel: number;
}

function ruleMetaIndex(guidelines: IbmGuideline[] | undefined): Map<string, RuleMeta> {
  const out = new Map<string, RuleMeta>();
  if (!guidelines) return out;
  const order = ["WCAG_2_2", "IBM_Accessibility", "WCAG_2_1", "WCAG_2_0"];
  const rank = (id: string) => (order.indexOf(id) < 0 ? 99 : order.indexOf(id));
  const sorted = [...guidelines].sort((a, b) => rank(a.id) - rank(b.id));
  for (const g of sorted) {
    for (const cp of g.checkpoints || []) {
      const numeric = /^\d+\.\d+\.\d+$/.test(cp.num);
      for (const r of cp.rules || []) {
        const tk = Number(r.toolkitLevel) || 4;
        const cur = out.get(r.id);
        if (!cur) {
          const lv = cp.wcagLevel === "A" || cp.wcagLevel === "AA" || cp.wcagLevel === "AAA" ? cp.wcagLevel : null;
          out.set(r.id, { wcag: numeric ? cp.num : "", level: numeric ? lv : null, toolkitLevel: tk });
        } else {
          cur.toolkitLevel = Math.min(cur.toolkitLevel, tk);
          if (!cur.wcag && numeric) {
            cur.wcag = cp.num;
            cur.level = cp.wcagLevel === "A" || cp.wcagLevel === "AA" || cp.wcagLevel === "AAA" ? cp.wcagLevel : null;
          }
        }
      }
    }
  }
  return out;
}

/** Kind + impact for an IBM result value, or null when the result is dropped. */
export function classifyIbmValue(value: readonly string[], toolkitLevel = 4, includeManual = false): { kind: A11yKind; impact: A11yImpact } | null {
  const policy = String(value?.[0] || "").toUpperCase();
  const conf = String(value?.[1] || "").toUpperCase();
  if (conf === "PASS" || !conf) return null;
  if (conf === "MANUAL") return includeManual ? { kind: "review", impact: "info" } : null;
  if (policy === "VIOLATION") {
    if (conf === "FAIL") return { kind: "error", impact: toolkitLevel <= 1 ? "critical" : "major" };
    if (conf === "POTENTIAL") return { kind: "review", impact: toolkitLevel <= 1 ? "major" : "minor" };
    return null;
  }
  if (policy === "RECOMMENDATION") {
    if (conf === "FAIL") return { kind: "warning", impact: "minor" };
    if (conf === "POTENTIAL") return { kind: "warning", impact: "info" };
    return null;
  }
  if (conf === "FAIL" || conf === "POTENTIAL") return { kind: "warning", impact: "info" };
  return null;
}

/** Non-PII detail for results whose arguments are measurements (contrast). */
function detailFor(r: IbmResult): string | undefined {
  if (r.ruleId === "text_contrast_sufficient" && Array.isArray(r.messageArgs)) {
    const [ratio, size, weight] = r.messageArgs;
    const n = Number(ratio);
    if (Number.isFinite(n)) {
      const extra = typeof size === "number" && typeof weight === "number" ? ` · ${size}px, weight ${weight}` : "";
      return `contrast ${n}:1${extra}`;
    }
  }
  return undefined;
}

/** Maps an IBM report to engine-level findings (engine "ibm"). Never throws on malformed results. */
export function mapIbmReport(report: IbmReportLike | null | undefined, options: IbmMapOptions = {}): { findings: A11yFinding[]; dropped: number; elements: number } {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const dom = doc ? new DomCache(doc) : null;
  const meta = ruleMetaIndex(options.guidelines);
  const maxFindings = Math.max(1, Math.floor(options.maxFindings ?? 1000));
  const byKey = new Map<string, A11yFinding>();
  const paths = new Set<string>();
  const posMemo: PositionMemo = new WeakMap();
  const nameMemo = new Map<Element, string>();
  let dropped = 0;
  for (const r of Array.isArray(report?.results) ? report!.results : []) {
    try {
      if (!r || typeof r.ruleId !== "string") continue;
      const path = typeof r.path?.dom === "string" ? r.path.dom : "";
      if (path) paths.add(path);
      const m = meta.get(r.ruleId);
      const cls = classifyIbmValue(r.value || [], m?.toolkitLevel ?? 4, options.includeManual);
      if (!cls) continue;
      const el = isElement(r.node) ? (r.node as Element) : doc && path ? resolveXPath(doc, path) : null;
      // One canonical selector per element (our CSS path, or our XPath in shadow DOM / frames);
      // IBM's own path only when the element could not be resolved.
      const canon = canonicalSelector(el, dom);
      const selector = canon.selector || path;
      const node = nodeKey(el);
      const reason = r.reasonId === undefined || r.reasonId === null ? "" : String(r.reasonId);
      const key = `${r.ruleId}|${reason}|${node || selector}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.count = (prev.count ?? 1) + 1;
        continue;
      }
      if (byKey.size >= maxFindings) {
        dropped++;
        continue;
      }
      let snip = "";
      try {
        snip = el ? snippet(el) : snippetFromMarkup(String(r.snippet || ""));
      } catch {
        snip = "";
      }
      const f: A11yFinding = {
        id: "ibm-" + fnv1a(`${r.ruleId}|${reason}|${selector}`),
        ruleId: r.ruleId,
        check: reason,
        kind: cls.kind,
        impact: cls.impact,
        severity: SEVERITY_FOR_IMPACT[cls.impact],
        wcag: m?.wcag ?? "",
        level: m?.level ?? null,
        message: r.ruleId,
        help: "",
        selector,
        snippet: snip,
        engine: "ibm",
      };
      if (canon.xpath) f.xpath = canon.xpath;
      else if (!canon.selector && path) f.xpath = path;
      if (node) f.node = node;
      const pos = elementPosition(el, posMemo);
      if (pos) f.pos = pos;
      const name = namePreview(el, dom, nameMemo);
      if (name) f.name = name;
      const d = detailFor(r);
      if (d) f.detail = d;
      byKey.set(key, f);
    } catch {
      /* skip malformed result */
    }
  }
  const findings = [...byKey.values()].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return { findings, dropped, elements: paths.size };
}

const checkers = new WeakMap<object, IbmChecker>();

/** Unique rule ids enabled by an IBM ruleset. */
export function ibmRulesetRuleIds(checker: IbmChecker, ruleset: string): string[] {
  const out = new Set<string>();
  try {
    const list = checker.rulesetRules?.[ruleset];
    if (Array.isArray(list)) for (const id of list) out.add(String(id).replace(/\$\$\d+$/, ""));
    else
      for (const g of checker.getGuidelines())
        if (g.id === ruleset) for (const cp of g.checkpoints) for (const r of cp.rules || []) out.add(r.id);
  } catch {
    /* ignore */
  }
  return [...out].sort();
}

/**
 * Runs the IBM engine on `root` (default: the global document) and returns an engine-level report.
 * Never rejects: failures are reported in `report.error`.
 */
export async function runIbmAudit(ace: AceLike, root?: Document | Element | null, options: IbmAuditOptions = {}): Promise<A11yReport> {
  const t0 = nowMs();
  const timestamp = Date.now();
  const doc = docOf(root ?? null);
  const report: A11yReport = {
    url: pageUrl(doc),
    title: pageTitle(doc),
    timestamp,
    durationMs: 0,
    rulesRun: 0,
    elementsScanned: 0,
    findings: [],
    counts: emptyCounts(),
    score: 100,
    truncated: false,
    droppedFindings: 0,
    engineVersion: options.version || IBM_ACE_VERSION,
    engine: "ibm",
  };
  try {
    if (!ace || typeof ace.Checker !== "function") throw new Error("Rule engine not loaded");
    const target = root ?? doc;
    if (!doc || !target) throw new Error("No document to audit");
    let checker = checkers.get(ace);
    if (!checker) {
      checker = new ace.Checker();
      checkers.set(ace, checker);
    }
    const ruleset = ibmRulesetFor(options.standard);
    const sourceRules = ibmRulesetRuleIds(checker, ruleset);
    const raw = await checker.check(target, [ruleset]);
    const mapped = mapIbmReport(raw, { doc, guidelines: checker.getGuidelines(), includeManual: options.includeManual, maxFindings: options.maxFindings });
    report.findings = mapped.findings;
    report.droppedFindings = mapped.dropped;
    report.truncated = mapped.dropped > 0;
    report.elementsScanned = mapped.elements;
    report.sourceRules = sourceRules;
    report.rulesRun = sourceRules.length;
    report.counts = countFindings(report.findings);
    report.score = computeScore(report.findings);
  } catch (err) {
    report.error = err instanceof Error ? err.message.slice(0, 300) : "Audit failed";
  }
  report.durationMs = Math.round((nowMs() - t0) * 10) / 10;
  return report;
}
