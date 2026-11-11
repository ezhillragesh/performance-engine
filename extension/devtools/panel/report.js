// "Copy as Markdown": issue-ready reports of one insight or of the whole session. Pure (no DOM),
// so it can run in Node. Inputs are validated panel data; page-provided strings are still
// untrusted, so they are flattened to one line and escaped for Markdown (no raw HTML, no tables
// broken by "|"). Page URLs are reduced to origin + path: queries and hashes may carry PII.
import { humanizeIssueType, humanizeCategory, capitalize, formatMs, formatValue, formatPct, formatCount, isNum, SEVERITIES } from "./format.js";
import { VITALS, rateVital, formatVital } from "./vitals.js";

const MODE_LABEL = { app: "app engine", injected: "injected engine", devtools: "DevTools-only data", imported: "imported bundle" };

/** One line, Markdown-escaped (inline). */
export function mdText(value, max = 300) {
  const s = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
  return s.replace(/([\\`*_[\]<>|#])/g, "\\$1");
}

/** Inline code span that survives backticks in the value. */
export function mdCode(value, max = 200) {
  const s = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  if (!s) return "—";
  const fence = s.includes("`") ? "``" : "`";
  return `${fence}${fence === "``" ? " " : ""}${s}${fence === "``" ? " " : ""}${fence}`;
}

/** origin + pathname of a page URL (no query, hash or credentials), or "" when unparsable. */
export function pageLocation(url) {
  if (typeof url !== "string" || !url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return u.protocol;
    return `${u.origin}${u.pathname}`;
  } catch {
    return "";
  }
}

function contextLines(ctx) {
  const lines = [];
  const where = pageLocation(ctx.url);
  if (where) lines.push(`- **Page:** ${mdText(where, 400)}`);
  const how = [MODE_LABEL[ctx.mode] || null, ctx.engineVersion && ctx.engineVersion !== "devtools" ? `engine ${mdText(ctx.engineVersion, 40)}` : null, ctx.react ? "React detected" : null].filter(Boolean);
  if (how.length) lines.push(`- **Recorded with:** ${how.join(" · ")}`);
  return lines;
}

/**
 * @param entry  insight history entry `{ insight, occurrences, firstSeen, lastSeen, present }`
 * @param ctx    `{ url, mode, engineVersion, react, timeOrigin }`
 */
export function insightMarkdown(entry, ctx = {}) {
  const i = entry.insight;
  const m = i.metadata || {};
  const out = [];
  out.push(`### ${mdText(humanizeIssueType(i.issueType), 120)}: ${mdText(i.source, 160)}`);
  out.push("");
  out.push(`**${capitalize(i.severity)}** · ${humanizeCategory(i.category)} · confidence ${formatPct(Math.round((i.confidence || 0) * 100))} · est. delay ${formatMs(i.impact.estimatedDelayMs)}${isNum(i.impact.renderCostMs) ? ` · render cost ${formatMs(i.impact.renderCostMs)}` : ""}`);
  out.push("");
  if (i.message) out.push(mdText(i.message, 600), "");
  if (i.cause) out.push(`**Cause:** ${mdText(i.cause, 800)}`, "");
  if (i.possibleFix) out.push(`**Suggested fix:** ${mdText(i.possibleFix, 800)}`, "");
  if (i.evidence.length) {
    out.push("| Evidence | Value | Limit | Weight |", "| --- | ---: | ---: | ---: |");
    for (const ev of i.evidence.slice().sort((a, b) => b.weight - a.weight).slice(0, 12)) {
      const value = typeof ev.value === "number" ? formatValue(ev.value, ev.unit) : mdText(ev.value, 80);
      const limit = isNum(ev.threshold) ? formatValue(ev.threshold, ev.unit) : "—";
      out.push(`| ${mdText(ev.label, 120)} | ${value} | ${limit} | ${ev.weight.toFixed(2)} |`);
    }
    out.push("");
  }
  const facts = [];
  facts.push(`- **Insight id:** ${mdCode(i.id, 200)}`);
  if (i.traceId) facts.push(`- **Trace:** ${mdCode(i.traceId, 120)}`);
  if (m.interactionType) facts.push(`- **Interaction:** ${mdText(m.interactionType, 80)}`);
  if (m.rootComponent) facts.push(`- **Root component:** ${mdCode(m.rootComponent, 120)}`);
  if (m.affectedComponents?.length) facts.push(`- **Components:** ${m.affectedComponents.slice(0, 12).map((c) => mdCode(c, 80)).join(", ")}${m.affectedComponents.length > 12 ? ` (+${m.affectedComponents.length - 12})` : ""}`);
  if (isNum(m.renderCount)) facts.push(`- **Renders:** ${formatCount(m.renderCount)}`);
  if (isNum(m.timeWindowStart)) facts.push(`- **Window:** ${formatMs((m.timeWindowEnd ?? m.timeWindowStart) - m.timeWindowStart)} at ${formatMs(m.timeWindowStart)} after page start`);
  if (entry.occurrences > 1) facts.push(`- **Seen:** ${entry.occurrences}×`);
  out.push(...facts, ...contextLines(ctx), "", "_Reported with Perf Intelligence DevTools._");
  return out.join("\n");
}

/**
 * Session summary: score, Web Vitals, budgets and the top insights.
 * @param snapshot normalized snapshot (summary, insights)
 * @param ctx      `{ url, title, mode, engineVersion, react, vitals, maxInsights }`
 */
export function sessionMarkdown(snapshot, ctx = {}) {
  const sum = snapshot.summary;
  const out = [];
  const title = ctx.title ? mdText(ctx.title, 120) : pageLocation(ctx.url) ? mdText(pageLocation(ctx.url), 200) : "this page";
  out.push(`## Performance report: ${title}`, "");
  out.push(...contextLines(ctx), "");
  const counts = sum.insightCounts || {};
  const total = SEVERITIES.reduce((a, k) => a + (counts[k] || 0), 0);
  out.push(`**Health score:** ${isNum(sum.score) ? Math.round(sum.score) : "—"}${sum.grade ? ` (${mdText(sum.grade, 30)})` : ""} · **Insights:** ${total} (${SEVERITIES.map((k) => `${counts[k] || 0} ${k}`).join(", ")})`, "");
  out.push("| Metric | Value |", "| --- | ---: |");
  out.push(`| Interaction p75 | ${formatMs(sum.interactionP75Ms)} (${formatCount(sum.interactions)} measured) |`);
  if (ctx.mode !== "devtools") out.push(`| Renders | ${formatCount(sum.renders)}${sum.renders ? ` (${formatPct((sum.wastedRenders / sum.renders) * 100, 0)} wasted)` : ""} |`);
  out.push(`| Long tasks | ${formatCount(sum.longTasks)} (${formatMs(sum.totalBlockingMs)} blocking) |`);
  out.push(`| Requests | ${formatCount(sum.requests)}${sum.failedRequests ? ` (${sum.failedRequests} failed)` : ""} |`);
  const v = ctx.vitals;
  if (v) for (const meta of VITALS) if (isNum(v[meta.key])) out.push(`| ${meta.label} | ${formatVital(meta, v[meta.key])}${rateVital(meta, v[meta.key]) === "poor" ? " (poor)" : rateVital(meta, v[meta.key]) === "needs-improvement" ? " (needs work)" : ""} |`);
  out.push("");
  const failing = (sum.budgets || []).filter((b) => b.status === "fail" || b.status === "warn");
  if (failing.length) {
    out.push("**Budgets over limit:**");
    for (const b of failing) out.push(`- ${mdText(b.label, 80)}: ${formatValue(b.actual, b.unit)} / ${formatValue(b.limit, b.unit)} (${b.status})`);
    out.push("");
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  const top = snapshot.insights.slice().sort((a, b) => order[a.severity] - order[b.severity] || b.impact.estimatedDelayMs - a.impact.estimatedDelayMs).slice(0, ctx.maxInsights ?? 10);
  if (top.length) {
    out.push("**Top insights:**");
    for (const i of top) out.push(`- **${capitalize(i.severity)}** ${mdText(humanizeIssueType(i.issueType), 80)}: ${mdCode(i.source, 120)} (${formatMs(i.impact.estimatedDelayMs)})${i.possibleFix ? `. Fix: ${mdText(i.possibleFix, 240)}` : ""}`);
    out.push("");
  }
  out.push("_Reported with Perf Intelligence DevTools._");
  return out.join("\n");
}
