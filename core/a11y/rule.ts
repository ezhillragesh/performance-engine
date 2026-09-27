// Rule contract for the runtime audit. A rule mirrors one a11yinspect rule file (same id).
import type { Attrs, DomCache, Scope } from "./dom.js";
import type { ListenerLookup } from "./types.js";

export interface ReportExtra {
  /** Non-PII context (attribute name, missing id, heading levels...). */
  detail?: string;
  /** Visibility filter for this report; defaults to the rule's scope. */
  scope?: Scope;
  /** Check visibility on this element instead (e.g. the <select> for an <option>). */
  visibilityOf?: Element;
}

export interface RuleContext {
  readonly ruleId: string;
  readonly doc: Document;
  readonly dom: DomCache;
  /** True when the audit root is the whole document (page-level checks run only then). */
  readonly isDocument: boolean;
  readonly listeners: ListenerLookup | null;
  report(el: Element, check: string, extra?: ReportExtra): void;
  /** True when `el` would be filtered out under `scope` (default: the rule's scope). */
  excluded(el: Element, scope?: Scope): boolean;
  /** Per-run scratch storage for this rule (collected during visit, consumed in finish). */
  readonly state: Record<string, unknown>;
}

export interface Rule {
  /** Source rule id (file name without .js). */
  readonly id: string;
  /** Lowercase local names this rule visits; omit to visit every element. */
  readonly tags?: readonly string[];
  /** Default visibility scope for reports. Default "visible". */
  readonly scope?: Scope;
  visit?(el: Element, attrs: Attrs, ctx: RuleContext): void;
  /** Runs after the tree walk (document-wide checks). */
  finish?(ctx: RuleContext): void;
}

export function ariaTrue(v: string | undefined): boolean {
  return v !== undefined && v.trim().toLowerCase() === "true";
}

export function firstToken(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  const i = t.search(/\s/);
  return i === -1 ? t : t.slice(0, i);
}

export function hasText(v: string | undefined | null): boolean {
  return v !== undefined && v !== null && v.trim() !== "";
}
