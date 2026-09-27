// Test helpers: load a fixture into the jsdom global document and audit it.
import { runA11yAudit } from "../engine.js";
import type { A11yAuditOptions, A11yFinding, A11yReport } from "../types.js";

export interface Fixture {
  /** body innerHTML */
  body: string;
  /** head innerHTML (default: a <title>) */
  head?: string;
  /** lang on <html>; null removes it (default "en") */
  lang?: string | null;
  /** DOM surgery the HTML parser would not allow (e.g. <td> outside <tr>). */
  setup?: (doc: Document) => void;
}

export function load(f: Fixture | string): Document {
  const fx: Fixture = typeof f === "string" ? { body: f } : f;
  const doc = document;
  const html = doc.documentElement;
  for (const a of Array.from(html.attributes)) html.removeAttribute(a.name);
  if (fx.lang !== null) html.setAttribute("lang", fx.lang ?? "en");
  doc.head.innerHTML = fx.head ?? "<title>Fixture</title>";
  doc.body.innerHTML = fx.body;
  for (const a of Array.from(doc.body.attributes)) doc.body.removeAttribute(a.name);
  fx.setup?.(doc);
  (doc.activeElement as HTMLElement | null)?.blur?.();
  return doc;
}

export function audit(f: Fixture | string, opts?: A11yAuditOptions): A11yReport {
  load(f);
  return runA11yAudit(document, { timeBudgetMs: 10_000, ...opts });
}

export function findingsFor(r: A11yReport, ruleId: string, check?: string): A11yFinding[] {
  return r.findings.filter((f) => f.ruleId === ruleId && (check === undefined || f.check === check));
}

export function has(r: A11yReport, id: string): boolean {
  const [ruleId, check] = id.split("/");
  return findingsFor(r, ruleId, check).length > 0;
}

/** Keys of `fixtures` whose rule id is in `ruleIds`. */
export function idsForRules(keys: readonly string[], ruleIds: readonly string[]): string[] {
  const set = new Set(ruleIds);
  return keys.filter((k) => set.has(k.split("/")[0]));
}
