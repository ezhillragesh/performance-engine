// Public types of the runtime accessibility audit (core/a11y).
// Rules are ported from BarrierBreak eslint-plugin-a11yinspect (MIT) — see THIRD_PARTY_NOTICES.md.
import type { A11yStandard } from "./wcag.js";

/** Normalised impact. Source tags map: Blocker|Critical -> critical, Major -> major, Minor -> minor, Best Practice -> info. */
export type A11yImpact = "critical" | "major" | "minor" | "info";

/** Severity tag exactly as written in the source rule message. */
export type A11ySeverityTag = "Blocker" | "Critical" | "Major" | "Minor" | "Best Practice";

/**
 * "error": a confirmed failure; "warning": advisory (A11yInspect `*-warning` rules, recommendations);
 * "review": a possible failure that a person must confirm ("Needs review").
 */
export type A11yKind = "error" | "warning" | "review";

/** Source engines behind the unified rule set (internal: never shown in the UI). */
export type A11yEngineId = "a11yinspect" | "ibm" | "axe";

/** One source result folded into a unified finding (kept for debugging and exports, not rendered). */
export interface A11ySource {
  engine: A11yEngineId;
  /** Source rule id, e.g. "img_alt_valid" (IBM), "image-alt" (axe), "img-element-error" (A11yInspect). */
  rule: string;
  /** Source reason / messageId when the engine has one. */
  check?: string;
  kind: A11yKind;
}

export type A11yLevel = "A" | "AA" | "AAA";

export interface A11yFinding {
  /** Stable id: hash of ruleId + check + selector (survives rescans while the DOM path is stable). */
  id: string;
  /**
   * Engine-level reports: the source rule id (e.g. "img-element-error").
   * Unified reports (mergeA11yReports): the unified rule id (e.g. "image-alt").
   */
  ruleId: string;
  /** Engine-level: source messageId / reasonId. Unified: the check of the first source. */
  check: string;
  kind: A11yKind;
  impact: A11yImpact;
  /** Severity tag from the source message, e.g. "Critical". */
  severity: A11ySeverityTag;
  /** WCAG success criterion, e.g. "1.1.1". */
  wcag: string;
  level: A11yLevel | null;
  /** Source message without the emoji, e.g. "[Critical] img missing alt attribute (1.1.1 A)". */
  message: string;
  /** One sentence on how to fix it. */
  help: string;
  /** Unique, stable CSS path to the element (ids, tag names and :nth-of-type only). */
  selector: string;
  /** The element's opening tag; value-like attributes redacted, URL queries stripped, max 200 chars. */
  snippet: string;
  /** Extra non-PII context, e.g. the offending attribute name or `h2 -> h4`. */
  detail?: string;
  /** Times the same check fired on the same element (e.g. several unsupported aria-* attributes). */
  count?: number;
  /** Engine-level reports: the engine that produced the finding. */
  engine?: A11yEngineId;
  /** Unified reports: every success criterion of the unified rule (`wcag` is the first). */
  criteria?: string[];
  /** Unified reports: the rule is not tied to a WCAG success criterion. */
  bestPractice?: boolean;
  /** XPath of the element when no document-level CSS selector exists (shadow DOM, frames). */
  xpath?: string;
  /**
   * Per-page identity of the element (same element -> same key in every engine report of one page
   * load). The merge keys findings by it instead of selector strings; not rendered.
   */
  node?: string;
  /**
   * Composed-tree position of the element (element-child indices, e.g. "1.2.4.1"; see
   * sourceUtil.elementPosition): document order and ancestry for the merge. Tag-free, not rendered.
   */
  pos?: string;
  /**
   * Short preview of the element's accessible name / text (max 60 chars) that tells similar rows
   * apart (e.g. 200 low-contrast links). Never taken from form fields, contenteditable content or
   * the page root; empty when the element has none.
   */
  name?: string;
  /** Unified reports: the source results merged into this finding (hidden, for debugging/exports). */
  sources?: A11ySource[];
}

export interface A11yCounts {
  errors: number;
  warnings: number;
  /** "Needs review" findings. */
  reviews: number;
  byImpact: Record<A11yImpact, number>;
  byWcag: Record<string, number>;
}

export interface A11yReport {
  /** origin + path of the audited document (no query string or hash). */
  url: string;
  title: string;
  /** Epoch ms at the start of the audit. */
  timestamp: number;
  durationMs: number;
  rulesRun: number;
  elementsScanned: number;
  findings: A11yFinding[];
  counts: A11yCounts;
  /** 0-100, 100 = no findings. Weighted by impact and kind, sub-linear in instance count. */
  score: number;
  /** True when the time budget or maxFindings cut the audit short. */
  truncated: boolean;
  /** Findings dropped because of maxFindings. */
  droppedFindings: number;
  engineVersion: string;
  /** Only set when the audit itself failed; findings are then empty. */
  error?: string;
  /** Engine-level reports: which engine produced it. */
  engine?: A11yEngineId;
  /** Engine-level reports: source rule ids that were enabled (for rule / criterion coverage). */
  sourceRules?: string[];
  /** Unified reports: the standard the findings were filtered by. */
  standard?: A11yStandard;
  /** Unified reports: unified rule ids that were checked (a source rule of theirs ran). */
  rulesChecked?: string[];
  /** Unified reports: per-engine run summaries (internal, not rendered). */
  engines?: A11yEngineRun[];
}

export interface A11yEngineRun {
  engine: A11yEngineId;
  version: string;
  durationMs: number;
  /** Source findings before merging (after the standard filter). */
  findings: number;
  error?: string;
  truncated?: boolean;
}

/** Signature of the DevTools Console Utilities `getEventListeners(el)`. */
export type ListenerLookup = (el: Element) => Record<string, unknown[] | undefined> | null | undefined;

export interface A11yAuditOptions {
  /** Only run these rule ids (unknown ids are ignored). Default: all rules. */
  rules?: string[];
  /** "errors" drops findings from *-warning rules. Default "all". */
  include?: "all" | "errors";
  /** Default 1000. */
  maxFindings?: number;
  /** Tree-walk time budget in ms. Default 500. */
  timeBudgetMs?: number;
  /**
   * Optional DevTools `getEventListeners`. When supplied (the panel passes it from an
   * inspectedWindow.eval scope), click-handler-warning also sees addEventListener handlers.
   */
  listeners?: ListenerLookup;
}
