// Adapter for axe-core (Deque, MPL-2.0), shipped unchanged as extension/vendor/axe.min.js. The
// `axe` object is passed in, so core has no runtime dependency on the package. Produces an
// engine-level A11yReport (source rule ids); mergeA11yReports (unify.ts) applies the unified rules.
//
// Mapping: violations -> "error", incomplete -> "review"; passes / inapplicable are not requested.
// Impact: critical -> critical, serious -> major, moderate -> minor, minor -> minor (null -> minor).
// WCAG: tags "wcag143" -> 1.4.3 (level from the WCAG table); "best-practice" rules have none.
import { DomCache, snippet, snippetFromMarkup } from "./dom.js";
import { countFindings, computeScore, emptyCounts } from "./score.js";
import { AXE_CORE_VERSION } from "./loaders.js";
import { IMPACT_RANK, KIND_RANK, canonicalSelector, docOf, elementPosition, fnv1a, isElement, namePreview, nodeKey, type PositionMemo, nowMs, pageTitle, pageUrl, SEVERITY_FOR_IMPACT } from "./sourceUtil.js";
import type { A11yFinding, A11yImpact, A11yKind, A11yReport } from "./types.js";
import { normalizeStandard, wcagCriterion, type A11yStandard } from "./wcag.js";

export interface AxeCheckResult {
  id?: string;
  data?: unknown;
}

export interface AxeNodeResult {
  target?: unknown[];
  html?: string;
  impact?: string | null;
  element?: unknown;
  any?: AxeCheckResult[];
  all?: AxeCheckResult[];
  none?: AxeCheckResult[];
}

export interface AxeRuleResult {
  id: string;
  impact?: string | null;
  tags?: string[];
  nodes?: AxeNodeResult[];
}

export interface AxeResultsLike {
  violations?: AxeRuleResult[];
  incomplete?: AxeRuleResult[];
}

export interface AxeLike {
  version?: string;
  run(context: unknown, options: Record<string, unknown>): Promise<AxeResultsLike>;
  getRules(tags?: string[]): Array<{ ruleId: string; tags: string[]; enabled?: boolean }>;
}

export interface AxeMapOptions {
  doc?: Document | null;
  /** Default 1000. */
  maxFindings?: number;
}

export interface AxeAuditOptions {
  standard?: Partial<A11yStandard>;
  maxFindings?: number;
}

const AXE_PRELOAD_TIMEOUT_MS = 1500;

const IMPACT: Record<string, A11yImpact> = { critical: "critical", serious: "major", moderate: "minor", minor: "minor" };

/** "wcag143" -> "1.4.3", "wcag1412" -> "1.4.12"; null for level / version tags. */
export function wcagFromAxeTag(tag: string): string | null {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  if (!m) return null;
  const num = `${m[1]}.${m[2]}.${m[3]}`;
  return wcagCriterion(num) ? num : null;
}

/** Cumulative runOnly tags for a standard (e.g. WCAG 2.2 AA = wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22a, wcag22aa). */
export function axeTagsFor(standard: Partial<A11yStandard> | undefined): string[] {
  const s = normalizeStandard(standard);
  const levels = s.level === "A" ? ["a"] : s.level === "AA" ? ["a", "aa"] : ["a", "aa", "aaa"];
  const versions = s.version === "2.0" ? ["2"] : s.version === "2.1" ? ["2", "21"] : ["2", "21", "22"];
  const tags: string[] = [];
  for (const v of versions) for (const l of levels) tags.push(`wcag${v}${l}`);
  if (s.profile === "section508") tags.push("section508");
  if (s.profile === "en301549") tags.push("EN-301-549");
  if (s.bestPractices) tags.push("best-practice");
  return tags;
}

function detailFor(ruleId: string, node: AxeNodeResult): string | undefined {
  if (ruleId !== "color-contrast" && ruleId !== "color-contrast-enhanced") return undefined;
  for (const c of [...(node.any || []), ...(node.all || []), ...(node.none || [])]) {
    const d = c?.data as Record<string, unknown> | undefined;
    if (d && typeof d.contrastRatio === "number" && d.contrastRatio > 0) {
      const need = typeof d.expectedContrastRatio === "string" || typeof d.expectedContrastRatio === "number" ? ` (needs ${String(d.expectedContrastRatio).replace(/:1$/, "")}:1)` : "";
      return `contrast ${Math.round(d.contrastRatio * 100) / 100}:1${need}`;
    }
  }
  return undefined;
}

/**
 * Resolves an axe target to the element: each entry is the selector in the next frame document;
 * an entry that is itself an array walks shadow roots ([host, inner, ...]).
 */
function resolveTarget(doc: Document, target: unknown[] | undefined): { el: Element | null; text: string } {
  if (!Array.isArray(target) || !target.length) return { el: null, text: "" };
  const texts: string[] = [];
  let el: Element | null = null;
  try {
    let d: Document | null = doc;
    for (let i = 0; i < target.length; i++) {
      const part = target[i];
      const sels: unknown[] | null = typeof part === "string" ? [part] : Array.isArray(part) ? part : null;
      if (!sels) return { el: null, text: texts.join(" | ") };
      texts.push(sels.map(String).join(" >>> "));
      let scope: Document | ShadowRoot | null = d;
      for (const sel of sels) {
        if (!scope || typeof sel !== "string") return { el: null, text: texts.join(" | ") };
        el = scope.querySelector(sel);
        scope = el?.shadowRoot ?? null;
      }
      if (i < target.length - 1) {
        let next: Document | null = null;
        try {
          next = el && (el.localName === "iframe" || el.localName === "frame") ? (el as HTMLIFrameElement).contentDocument : null;
        } catch {
          next = null;
        }
        d = next;
        el = null;
      }
    }
  } catch {
    el = null; /* invalid selector / cross-origin frame */
  }
  return { el, text: texts.join(" | ") };
}

/** Maps axe results to engine-level findings (engine "axe"). */
export function mapAxeResults(results: AxeResultsLike | null | undefined, options: AxeMapOptions = {}): { findings: A11yFinding[]; dropped: number } {
  const doc = options.doc ?? (typeof document !== "undefined" ? document : null);
  const dom = doc ? new DomCache(doc) : null;
  const maxFindings = Math.max(1, Math.floor(options.maxFindings ?? 1000));
  const byKey = new Map<string, A11yFinding>();
  const posMemo: PositionMemo = new WeakMap();
  const nameMemo = new Map<Element, string>();
  let dropped = 0;
  const groups: Array<[A11yKind, AxeRuleResult[] | undefined]> = [
    ["error", results?.violations],
    ["review", results?.incomplete],
  ];
  for (const [kind, list] of groups) {
    for (const rule of Array.isArray(list) ? list : []) {
      if (!rule || typeof rule.id !== "string") continue;
      const tags = Array.isArray(rule.tags) ? rule.tags : [];
      const criteria = tags.map(wcagFromAxeTag).filter((x): x is string => !!x);
      const wcag = criteria[0] || "";
      const level = wcag ? wcagCriterion(wcag)!.level : null;
      for (const node of Array.isArray(rule.nodes) ? rule.nodes : []) {
        try {
          const resolved = doc ? resolveTarget(doc, node.target) : { el: null, text: "" };
          const el = isElement(node.element) ? (node.element as Element) : resolved.el;
          // One canonical selector per element (our CSS path, or our XPath in shadow DOM); axe's
          // "host >>> inner" target text only when the element could not be resolved.
          const canon = canonicalSelector(el, dom);
          const selector = canon.selector || resolved.text;
          const nk = nodeKey(el);
          const key = `${rule.id}|${kind}|${nk || selector}`;
          const prev = byKey.get(key);
          if (prev) {
            prev.count = (prev.count ?? 1) + 1;
            continue;
          }
          if (byKey.size >= maxFindings) {
            dropped++;
            continue;
          }
          const impact = IMPACT[String(node.impact || rule.impact || "")] ?? "minor";
          let snip = "";
          try {
            snip = el ? snippet(el) : snippetFromMarkup(String(node.html || ""));
          } catch {
            snip = "";
          }
          const chk = [...(node.any || []), ...(node.all || []), ...(node.none || [])].find((c) => c && typeof c.id === "string");
          // The check's messageKey (an identifier such as "noId", never message text) tells some
          // results of one axe rule apart (see CHECK_REFINE in catalog/unified.ts).
          const mk = (chk?.data as { messageKey?: unknown } | undefined)?.messageKey;
          const checkId = (chk?.id || "") + (typeof mk === "string" && /^[A-Za-z]{1,30}$/.test(mk) ? `:${mk}` : "");
          const f: A11yFinding = {
            id: "axe-" + fnv1a(`${rule.id}|${kind}|${selector}`),
            ruleId: rule.id,
            check: checkId,
            kind,
            impact,
            severity: SEVERITY_FOR_IMPACT[impact],
            wcag,
            level,
            message: rule.id,
            help: "",
            selector,
            snippet: snip,
            engine: "axe",
          };
          if (canon.xpath) f.xpath = canon.xpath;
          if (nk) f.node = nk;
          const pos = elementPosition(el, posMemo);
          if (pos) f.pos = pos;
          const name = namePreview(el, dom, nameMemo);
          if (name) f.name = name;
          if (tags.includes("best-practice")) f.bestPractice = true;
          const d = detailFor(rule.id, node);
          if (d) f.detail = d;
          byKey.set(key, f);
        } catch {
          /* skip malformed node */
        }
      }
    }
  }
  const findings = [...byKey.values()].sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
  return { findings, dropped };
}

/** Rule ids axe will run for these tags (enabled, not experimental). */
export function axeRuleIdsFor(axe: AxeLike, tags: string[]): string[] {
  try {
    return axe
      .getRules(tags)
      .filter((r) => r.enabled !== false && !(r.tags || []).includes("experimental"))
      .map((r) => r.ruleId)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Runs axe-core on `root` (default: the global document) and returns an engine-level report.
 * Never rejects: failures are reported in `report.error`.
 */
export async function runAxeAudit(axe: AxeLike, root?: Document | Element | null, options: AxeAuditOptions = {}): Promise<A11yReport> {
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
    engineVersion: String(axe?.version || AXE_CORE_VERSION),
    engine: "axe",
  };
  try {
    if (!axe || typeof axe.run !== "function") throw new Error("Rule engine not loaded");
    const target = root ?? doc;
    if (!doc || !target) throw new Error("No document to audit");
    const known = new Set<string>();
    for (const r of axe.getRules()) for (const t of r.tags || []) known.add(t);
    const tags = axeTagsFor(options.standard).filter((t) => known.has(t));
    const raw = await axe.run(target, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations", "incomplete"],
      elementRef: true,
      iframes: false,
      performanceTimer: false,
      // axe waits for media / CSSOM assets before some rules; its default 10 s wait made broken
      // media elements dominate the audit time.
      preload: { assets: ["cssom", "media"], timeout: AXE_PRELOAD_TIMEOUT_MS },
    });
    const mapped = mapAxeResults(raw, { doc, maxFindings: options.maxFindings });
    report.findings = mapped.findings;
    report.droppedFindings = mapped.dropped;
    report.truncated = mapped.dropped > 0;
    report.sourceRules = axeRuleIdsFor(axe, tags);
    report.rulesRun = report.sourceRules.length;
    const els = new Set(report.findings.map((f) => f.selector));
    report.elementsScanned = isDocumentLike(target) ? doc.getElementsByTagName("*").length : (target as Element).getElementsByTagName("*").length + 1;
    if (!report.elementsScanned) report.elementsScanned = els.size;
    report.counts = countFindings(report.findings);
    report.score = computeScore(report.findings);
  } catch (err) {
    report.error = err instanceof Error ? err.message.slice(0, 300) : "Audit failed";
  }
  report.durationMs = Math.round((nowMs() - t0) * 10) / 10;
  return report;
}

function isDocumentLike(n: unknown): boolean {
  return !!n && typeof n === "object" && (n as Node).nodeType === 9;
}
