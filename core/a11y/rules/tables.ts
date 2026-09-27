// Tables. Ported from a11yinspect: table-element-*, scope-element-error.
// Runtime accuracy: header detection walks the table's own rows (nested tables are separate), and
// layout tables (role="none"/"presentation") are not held to data-table requirements.
import { childByTag, closestTag, normalizeSpace, rawRole } from "../dom.js";
import type { Rule } from "../rule.js";

function isLayoutTable(table: Element | null): boolean {
  if (!table) return false;
  const r = rawRole(table);
  return r === "presentation" || r === "none";
}

function ownRows(table: Element): Element[] {
  const rows = (table as HTMLTableElement).rows;
  if (rows && typeof rows.length === "number") return Array.from(rows);
  return Array.from(table.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr"));
}

function isHeaderTh(cell: Element): boolean {
  if (cell.localName !== "th") return false;
  const r = rawRole(cell);
  return r === null || r === "rowheader" || r === "columnheader";
}

export const tableElementError: Rule = {
  id: "table-element-error",
  tags: ["table", "tr", "td", "th"],
  visit(el, a, ctx) {
    const tag = el.localName;
    if (tag === "td" || tag === "th") {
      const p = el.parentElement;
      if (p && p.localName !== "tr") ctx.report(el, tag === "td" ? "tdMissingTrParent" : "thMissingTrParent");
      return;
    }
    if (tag === "tr") {
      const p = el.parentElement;
      if (p && !["table", "thead", "tbody", "tfoot"].includes(p.localName)) ctx.report(el, "trMissingTableParent");
      return;
    }
    const summary = a["summary"];
    if (summary !== undefined) ctx.report(el, "tableDeprecatedSummary");
    if (isLayoutTable(el)) return;
    const caption = childByTag(el, "caption");
    if (!caption && !ctx.dom.ariaName(el) && summary === undefined) ctx.report(el, "tableMissingCaptionSummary");
    if (!caption) ctx.report(el, "tableMissingCaption");
    let hasTh = false;
    let hasRoleHeaders = false;
    for (const row of ownRows(el)) {
      for (let c = row.firstElementChild; c; c = c.nextElementSibling) {
        const r = rawRole(c);
        if (r === "columnheader" || r === "rowheader") hasRoleHeaders = true;
        if (!isHeaderTh(c)) continue;
        hasTh = true;
        if (!ctx.dom.accessibleName(c) && !normalizeSpace(c.textContent || "")) ctx.report(c, "tableEmptyHeader");
      }
    }
    if (!hasTh) ctx.report(el, "tableMissingTh");
    if (!hasTh && !hasRoleHeaders) ctx.report(el, "tableMissingHeaders");
  },
};

export const tableElementWarning: Rule = {
  id: "table-element-warning",
  tags: ["table"],
  visit(el, a, ctx) {
    if (isLayoutTable(el)) ctx.report(el, "tableRolePresentation");
    const summary = a["summary"];
    const caption = childByTag(el, "caption");
    if (summary !== undefined && caption) {
      const s = normalizeSpace(summary);
      const c = normalizeSpace(caption.textContent || "");
      if (s && c && s === c) ctx.report(el, "tableSummaryCaptionMatch");
    }
  },
};

const VALID_SCOPES = new Set(["row", "col", "rowgroup", "colgroup"]);

export const scopeElementError: Rule = {
  id: "scope-element-error",
  tags: ["th"],
  visit(el, a, ctx) {
    if (isLayoutTable(closestTag(el, "table"))) return;
    const scope = a["scope"];
    if (scope === undefined) return ctx.report(el, "thMissingScopeAttribute");
    const v = scope.trim().toLowerCase();
    if (v && !VALID_SCOPES.has(v)) ctx.report(el, "invalidScopeValue", { detail: `scope="${scope.trim().slice(0, 20)}"` });
  },
};

export const TABLE_RULES: readonly Rule[] = [tableElementError, tableElementWarning, scopeElementError];
