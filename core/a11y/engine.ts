// Runtime accessibility audit engine: one element tree walk with per-tag rule dispatch,
// lazy memoised visibility / name computation, per-rule try/catch, time and findings budgets.
import { DomCache, closestWithAttr, readAttrs, snippet, type Attrs, type Scope } from "./dom.js";
import { checkMeta, ruleKind } from "./meta.js";
import type { ReportExtra, Rule, RuleContext } from "./rule.js";
import { ALL_RULES } from "./rules/index.js";
import { computeScore, countFindings, emptyCounts } from "./score.js";
import { KIND_RANK, elementPosition, namePreview, nodeKey, type PositionMemo } from "./sourceUtil.js";
import type { A11yAuditOptions, A11yFinding, A11yImpact, A11yReport } from "./types.js";

import { A11Y_ENGINE_VERSION } from "./version.js";
export { A11Y_ENGINE_VERSION };
export { computeScore, countFindings, emptyCounts } from "./score.js";

/** Elements carrying this attribute (the highlight overlay) are ignored by the audit. */
export const A11Y_IGNORE_ATTR = "data-perf-intel-a11y";

const IMPACT_RANK: Record<A11yImpact, number> = { critical: 0, major: 1, minor: 2, info: 3 };
const MAX_RULE_ERRORS = 25;

interface Pending {
  el: Element;
  ruleId: string;
  check: string;
  details: string[];
  count: number;
}

interface Entry {
  rule: Rule;
  ctx: RuleContext;
  errors: number;
  disabled: boolean;
}

const now: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function isDocumentNode(n: unknown): n is Document {
  return !!n && typeof n === "object" && (n as Node).nodeType === 9;
}

function pageUrl(doc: Document): string {
  try {
    const loc = doc.defaultView?.location;
    if (loc && loc.origin && loc.origin !== "null") return loc.origin + loc.pathname;
    const u = new URL(doc.URL);
    return (u.origin !== "null" ? u.origin : u.protocol) + u.pathname;
  } catch {
    return "";
  }
}

function baseReport(doc: Document | null, timestamp: number): A11yReport {
  let title = "";
  try {
    title = doc ? String(doc.title || "").trim().slice(0, 200) : "";
  } catch {
    title = "";
  }
  return {
    url: doc ? pageUrl(doc) : "",
    title,
    timestamp,
    durationMs: 0,
    rulesRun: 0,
    elementsScanned: 0,
    findings: [],
    counts: emptyCounts(),
    score: 100,
    truncated: false,
    droppedFindings: 0,
    engineVersion: A11Y_ENGINE_VERSION,
    engine: "a11yinspect",
  };
}

/** Rule ids known to the engine (the 89 a11yinspect rule file names). */
export function listRuleIds(): string[] {
  return ALL_RULES.map((r) => r.id);
}

/**
 * Audits `root` (default: the global document) and returns a JSON-safe report.
 * Never throws: failures are reported in `report.error`.
 */
export function runA11yAudit(root?: Document | Element | null, options: A11yAuditOptions = {}): A11yReport {
  const t0 = now();
  const timestamp = Date.now();
  let doc: Document | null = null;
  try {
    const target = root ?? (typeof document !== "undefined" ? document : null);
    if (!target) return { ...baseReport(null, timestamp), error: "No document to audit" };
    doc = isDocumentNode(target) ? target : target.ownerDocument;
    const start: Element | null = isDocumentNode(target) ? target.documentElement : (target as Element);
    const report = baseReport(doc, timestamp);
    if (!doc || !start) return { ...report, error: "Document has no root element" };
    const isDocument = isDocumentNode(target) || start === doc.documentElement;

    const maxFindings = Math.max(1, Math.floor(options.maxFindings ?? 1000));
    const budget = Math.max(1, options.timeBudgetMs ?? 500);
    const only = options.rules && options.rules.length ? new Set(options.rules) : null;
    const errorsOnly = options.include === "errors";
    const rules = ALL_RULES.filter((r) => (!only || only.has(r.id)) && (!errorsOnly || ruleKind(r.id) === "error"));

    const dom = new DomCache(doc);
    let overlayPresent = false;
    try {
      // The overlay is only ever appended as a direct child of <html> or <body>; probing those is
      // O(children) instead of a full-document attribute query.
      const probe = (p: Element | null) => {
        for (let c = p?.firstElementChild ?? null; c; c = c.nextElementSibling) if (c.hasAttribute(A11Y_IGNORE_ATTR)) return true;
        return false;
      };
      overlayPresent = probe(doc.documentElement) || probe(doc.body);
    } catch {
      overlayPresent = false;
    }
    const pending = new Map<string, Pending>();
    const elKeys = new Map<Element, number>();
    let nextKey = 0;
    let dropped = 0;
    let truncated = false;

    const report_ = (rule: Rule, el: Element, check: string, extra?: ReportExtra): void => {
      if (!el || el.nodeType !== 1) return;
      const scope: Scope = extra?.scope ?? rule.scope ?? "visible";
      if (dom.excluded(extra?.visibilityOf ?? el, scope)) return;
      if (overlayPresent && closestWithAttr(el, A11Y_IGNORE_ATTR)) return;
      let k = elKeys.get(el);
      if (k === undefined) {
        k = nextKey++;
        elKeys.set(el, k);
      }
      const key = `${rule.id}|${check}|${k}`;
      const p = pending.get(key);
      if (p) {
        p.count++;
        if (extra?.detail && p.details.length < 5 && !p.details.includes(extra.detail)) p.details.push(extra.detail);
        return;
      }
      if (!checkMeta(rule.id, check)) return;
      if (pending.size >= maxFindings) {
        dropped++;
        truncated = true;
        return;
      }
      pending.set(key, { el, ruleId: rule.id, check, details: extra?.detail ? [extra.detail] : [], count: 1 });
    };

    const entries: Entry[] = [];
    const byTag = new Map<string, Entry[]>();
    const universal: Entry[] = [];
    for (const rule of rules) {
      const state: Record<string, unknown> = {};
      const ctx: RuleContext = {
        ruleId: rule.id,
        doc,
        dom,
        isDocument,
        listeners: typeof options.listeners === "function" ? options.listeners : null,
        state,
        report: (el, check, extra) => report_(rule, el, check, extra),
        excluded: (el, scope) => dom.excluded(el, scope ?? rule.scope ?? "visible"),
      };
      const entry: Entry = { rule, ctx, errors: 0, disabled: false };
      entries.push(entry);
      if (!rule.visit) continue;
      if (rule.tags) {
        for (const t of rule.tags) {
          const list = byTag.get(t);
          if (list) list.push(entry);
          else byTag.set(t, [entry]);
        }
      } else universal.push(entry);
    }

    const run = (e: Entry, el: Element, attrs: Attrs): void => {
      if (e.disabled) return;
      try {
        e.rule.visit!(el, attrs, e.ctx);
      } catch {
        if (++e.errors > MAX_RULE_ERRORS) e.disabled = true;
      }
    };

    // Single pre-order walk over elements (iterative; no recursion depth limits).
    const idCounts = new Map<string, number>();
    let scanned = 0;
    let node: Element | null = start;
    while (node) {
      let descend = true;
      if (overlayPresent && node.hasAttribute(A11Y_IGNORE_ATTR)) {
        descend = false;
      } else {
        scanned++;
        const attrs = readAttrs(node);
        const id = attrs["id"];
        if (id !== undefined) idCounts.set(id, (idCounts.get(id) || 0) + 1);
        for (let i = 0; i < universal.length; i++) run(universal[i], node, attrs);
        const list = byTag.get(node.localName);
        if (list) for (let i = 0; i < list.length; i++) run(list[i], node, attrs);
        if ((scanned & 63) === 0 && now() - t0 > budget) {
          truncated = true;
          break;
        }
      }
      let next: Element | null = descend ? node.firstElementChild : null;
      if (!next) {
        let cur: Element | null = node;
        while (cur && cur !== start && !cur.nextElementSibling) cur = cur.parentElement;
        if (!cur || cur === start) break;
        next = cur.nextElementSibling;
      }
      node = next;
    }

    if (isDocumentNode(target) && !truncated) dom.setIdCounts(idCounts);

    for (const e of entries) {
      if (!e.rule.finish || e.disabled) continue;
      try {
        e.rule.finish(e.ctx);
      } catch {
        e.errors++;
      }
    }

    const items = [...pending.values()];
    const built: Array<{ f: A11yFinding; el: Element }> = [];
    const posMemo: PositionMemo = new WeakMap();
    const nameMemo = new Map<Element, string>();
    for (const p of items) {
      const meta = checkMeta(p.ruleId, p.check);
      if (!meta) continue;
      let selector = "";
      let snip = "";
      try {
        selector = dom.uniqueSelector(p.el);
        snip = snippet(p.el);
      } catch {
        /* keep empty */
      }
      const f: A11yFinding = {
        id: "a11y-" + fnv1a(`${p.ruleId}|${p.check}|${selector}`),
        ruleId: p.ruleId,
        check: p.check,
        kind: meta.kind,
        impact: meta.impact,
        severity: meta.severity,
        wcag: meta.wcag,
        level: meta.level,
        message: meta.message,
        help: meta.help,
        selector,
        snippet: snip,
        engine: "a11yinspect",
      };
      const node = nodeKey(p.el);
      if (node) f.node = node;
      const pos = elementPosition(p.el, posMemo);
      if (pos) f.pos = pos;
      const name = namePreview(p.el, dom, nameMemo);
      if (name) f.name = name;
      if (p.details.length) f.detail = p.details.join("; ").slice(0, 300);
      if (p.count > 1) f.count = p.count;
      built.push({ f, el: p.el });
    }
    built.sort((x, y) => {
      const d = IMPACT_RANK[x.f.impact] - IMPACT_RANK[y.f.impact];
      if (d) return d;
      if (x.f.kind !== y.f.kind) return KIND_RANK[x.f.kind] - KIND_RANK[y.f.kind];
      if (x.el === y.el) return x.f.ruleId < y.f.ruleId ? -1 : x.f.ruleId > y.f.ruleId ? 1 : 0;
      try {
        return x.el.compareDocumentPosition(y.el) & 4 ? -1 : 1;
      } catch {
        return 0;
      }
    });
    const findings = built.map((b) => b.f);

    const counts = countFindings(findings);

    report.rulesRun = rules.length;
    report.sourceRules = rules.map((r) => r.id);
    report.elementsScanned = scanned;
    report.findings = findings;
    report.counts = counts;
    report.score = computeScore(findings);
    report.truncated = truncated;
    report.droppedFindings = dropped;
    report.durationMs = Math.round((now() - t0) * 10) / 10;
    return report;
  } catch (err) {
    const r = baseReport(doc, timestamp);
    r.error = err instanceof Error ? err.message.slice(0, 300) : "Audit failed";
    r.durationMs = Math.round((now() - t0) * 10) / 10;
    return r;
  }
}
