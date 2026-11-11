import { h, s, icon, replaceChildren, ellipsis, copyButton } from "../dom.js";
import {
  formatMs,
  formatPct,
  formatCount,
  formatValue,
  gradeLabel,
  isNum,
  SEVERITIES,
  capitalize,
  shortUrl,
  safeMax,
} from "../format.js";
import { activitySeries, mergeComponentStats, renderTimingMissing } from "../derive.js";
import { sessionMarkdown } from "../report.js";
import { VITALS, rateVital, formatVital, vitalThresholds } from "../vitals.js";

// Budgets that can only be measured with render data from the engine.
const RENDER_BUDGETS = new Set(["componentRenderMs", "rendersPerInteraction", "wastedRenderPct"]);
const NEEDS_ENGINE = "Needs engine: React renders are recorded by the perf engine inside the page.";

export function createOverviewView(ctx) {
  const el = h("section", { class: "view view-overview", "aria-label": "Overview" });

  function render() {
    const snap = ctx.store.data.snapshot;
    if (!snap) {
      replaceChildren(el, ctx.statusEmpty());
      return;
    }
    const sum = snap.summary;
    const limited = ctx.store.limited;
    replaceChildren(
      el,
      h(
        "div",
        { class: "overview-grid" },
        h(
          "div",
          { class: "card card-score" },
          scoreRing(sum, limited),
          kpiTiles(sum, ctx, limited),
          h(
            "div",
            { class: "score-actions" },
            copyButton({ label: "Copy summary", title: "Copy a Markdown performance report (score, vitals, budgets, top insights) for an issue or PR", className: "btn btn-small", getText: () => sessionMarkdown(ctx.store.data.snapshot, { ...ctx.actions.reportContext(), vitals: ctx.store.vitals }) }),
          ),
        ),
        vitalsCard(ctx.store.vitals, ctx.store.state.imported, ctx),
        h(
          "div",
          { class: "card card-activity" },
          h("div", { class: "card-head" }, h("h2", { text: "Activity" }), h("span", { class: "caption", text: `${formatCount(snap.events.length)} events${snap.droppedEvents ? ` · ${formatCount(snap.droppedEvents)} trimmed` : ""}` })),
          sparkline(activitySeries(snap.events, 60)),
        ),
        budgetsCard(sum.budgets, ctx, limited),
        limited ? needsEngineCard(ctx) : topComponentsCard(mergeComponentStats(sum.topComponents, snap.events).slice(0, 8), ctx, renderTimingMissing(snap.events)),
        topRequestsCard(sum.topRequests.slice(0, 8), ctx),
      ),
    );
  }

  return { el, render };
}

function scoreRing(sum, limited) {
  const score = isNum(sum.score) ? Math.round(sum.score) : null;
  const r = 34;
  const c = 2 * Math.PI * r;
  const grade = sum.grade || "none";
  const ring = s(
    "svg",
    { class: `score-ring grade-${grade}`, viewBox: "0 0 84 84", width: 84, height: 84, role: "img", "aria-label": `Health score ${score ?? "unknown"}` },
    s("circle", { class: "ring-track", cx: 42, cy: 42, r, fill: "none", "stroke-width": 7 }),
    s("circle", {
      class: "ring-value",
      cx: 42,
      cy: 42,
      r,
      fill: "none",
      "stroke-width": 7,
      "stroke-linecap": "round",
      "stroke-dasharray": `${((score ?? 0) / 100) * c} ${c}`,
      transform: "rotate(-90 42 42)",
    }),
    s("text", { class: "ring-text", x: 42, y: 47, "text-anchor": "middle", text: score === null ? "—" : String(score) }),
  );
  return h(
    "div",
    { class: "score" },
    ring,
    h(
      "div",
      { class: "score-meta" },
      h("span", { class: "caption", text: "Health score" }),
      h("strong", { class: `grade-text grade-${grade}`, text: gradeLabel(sum.grade) }),
      limited ? h("span", { class: "caption muted", title: "Scored without render data or causal traces.", text: "limited data" }) : null,
    ),
  );
}

function tile(label, value, sub, tone, onClick, title) {
  return h(
    onClick ? "button" : "div",
    { class: ["kpi", tone ? `tone-${tone}` : "", onClick ? "kpi-link" : ""], type: onClick ? "button" : undefined, onClick, title },
    h("span", { class: "caption", text: label }),
    h("span", { class: "kpi-value num", text: value }),
    h("span", { class: "kpi-sub", text: sub }),
  );
}

function kpiTiles(sum, ctx, limited) {
  const budgets = ctx.store.budgets();
  const wastedPct = sum.renders ? (sum.wastedRenders / sum.renders) * 100 : null;
  const latTone = !isNum(sum.interactionP75Ms) ? "" : sum.interactionP75Ms > budgets.interactionLatencyMs ? "bad" : sum.interactionP75Ms > budgets.interactionLatencyMs * 0.8 ? "warn" : "good";
  const counts = sum.insightCounts;
  const totalInsights = SEVERITIES.reduce((a, k) => a + (counts[k] || 0), 0);
  const sevRow = h(
    "span",
    { class: "sev-counts" },
    SEVERITIES.map((k) => h("span", { class: `sev-count sev-${k}`, title: capitalize(k) }, h("span", { class: "dot" }), h("span", { class: "num", text: counts[k] || 0 }))),
  );
  const insightsTile = h(
    "button",
    { type: "button", class: ["kpi", "kpi-link", counts.critical ? "tone-bad" : counts.high ? "tone-warn" : ""], onClick: () => ctx.actions.setView("insights") },
    h("span", { class: "caption", text: "Insights" }),
    h("span", { class: "kpi-value num", text: String(totalInsights) }),
    sevRow,
  );
  return h(
    "div",
    { class: "kpis" },
    tile("Interaction p75", formatMs(sum.interactionP75Ms), `worst ${formatMs(sum.interactionMaxMs)} · ${formatCount(sum.interactions)} measured`, latTone, () => ctx.actions.setView("timeline")),
    limited
      ? tile("Renders", "—", "Needs engine", "na", undefined, NEEDS_ENGINE)
      : tile("Renders", formatCount(sum.renders), wastedPct === null ? "no renders" : `${formatPct(wastedPct, 0)} wasted`, wastedPct !== null && wastedPct > budgets.wastedRenderPct ? "warn" : "", () => ctx.actions.setView("components")),
    tile("Long tasks", formatCount(sum.longTasks), `${formatMs(sum.totalBlockingMs)} blocking`, sum.totalBlockingMs > 300 ? "bad" : sum.longTasks ? "warn" : "", () => ctx.actions.setView("timeline")),
    tile("Requests", formatCount(sum.requests), sum.failedRequests ? `${sum.failedRequests} failed` : "no failures", sum.failedRequests ? "bad" : "", () => ctx.actions.setView("network")),
    insightsTile,
  );
}

function sparkline(series) {
  const w = 300;
  const hgt = 48;
  if (series.length < 2) return h("p", { class: "caption muted", text: "No events yet." });
  const max = safeMax(series, 1) || 1;
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, hgt - 2 - (v / max) * (hgt - 6)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${hgt} L0 ${hgt} Z`;
  return h(
    "div",
    { class: "sparkline-wrap" },
    s(
      "svg",
      { class: "sparkline", viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: "none", role: "img", "aria-label": `Activity, peak ${Math.round(max)} events per second` },
      s("path", { class: "spark-area", d: area }),
      s("path", { class: "spark-line", d: line, fill: "none", "vector-effect": "non-scaling-stroke" }),
    ),
    h("span", { class: "caption muted", text: `peak ${Math.round(max)} ev/s` }),
  );
}

function budgetsCard(budgets, ctx, limited) {
  const body = budgets.length
    ? h(
        "ul",
        { class: "budget-list" },
        budgets.map((b) => {
          if (limited && RENDER_BUDGETS.has(b.key)) {
            return h(
              "li",
              { class: "budget budget-no-data budget-na", title: NEEDS_ENGINE },
              h("div", { class: "budget-row" }, ellipsis(b.label, "budget-label"), h("span", { class: "pill pill-no-data", text: "Needs engine" })),
              h("div", { class: "budget-bar", "aria-hidden": "true" }, h("span", { class: "budget-fill", style: { width: "0%" } })),
              h("div", { class: "budget-nums caption num" }, h("span", { text: `— / ${formatValue(b.limit, b.unit)}` })),
            );
          }
          const ratio = isNum(b.actual) && b.limit > 0 ? b.actual / b.limit : 0;
          return h(
            "li",
            { class: `budget budget-${b.status}` },
            h("div", { class: "budget-row" }, ellipsis(b.label, "budget-label"), h("span", { class: `pill pill-${b.status}`, text: b.status === "no-data" ? "No data" : capitalize(b.status) })),
            h(
              "div",
              { class: "budget-bar", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(Math.min(ratio, 1) * 100), "aria-label": b.label },
              h("span", { class: "budget-fill", style: { width: `${Math.min(ratio, 1) * 100}%` } }),
            ),
            h("div", { class: "budget-nums caption num" }, h("span", { text: `${formatValue(b.actual, b.unit)} / ${formatValue(b.limit, b.unit)}` }), b.samples ? h("span", { text: `${b.violations}/${b.samples} over` }) : null),
          );
        }),
      )
    : h("p", { class: "caption muted", text: "No budget results in this snapshot." });
  return h(
    "div",
    { class: "card card-budgets" },
    h("div", { class: "card-head" }, h("h2", { text: "Budgets" }), ctx.store.readOnly ? null : h("button", { type: "button", class: "btn btn-small", onClick: (e) => ctx.actions.openBudgets(e.currentTarget) }, icon("gauge", 14), h("span", { text: "Edit" }))),
    body,
  );
}

function topComponentsCard(rows, ctx, noTiming) {
  const max = safeMax(rows.map((r) => r.totalMs), 1) || 1;
  return h(
    "div",
    { class: "card card-mini" },
    h("div", { class: "card-head" }, h("h2", { text: "Top components" }), h("button", { type: "button", class: "btn-link", onClick: () => ctx.actions.setView("components"), text: "All" })),
    noTiming ? h("p", { class: "caption muted", title: "React production builds report renders but not their duration; component names are usually minified.", text: "Production React build: no render timings." }) : null,
    rows.length
      ? h(
          "table",
          { class: "mini-table" },
          h("thead", null, h("tr", null, h("th", { text: "Component" }), h("th", { class: "r", text: "Renders" }), h("th", { class: "r", text: "Total" }))),
          h(
            "tbody",
            null,
            rows.map((r) =>
              h(
                "tr",
                { class: "clickable", tabIndex: 0, onClick: () => ctx.actions.filterInsightsBy(r.name), onKeydown: (e) => e.key === "Enter" && ctx.actions.filterInsightsBy(r.name) },
                h("td", null, ellipsis(r.name)),
                h("td", { class: "r num" }, String(r.renders), r.wasted ? h("span", { class: "muted", text: ` · ${r.wasted}w` }) : null),
                h("td", { class: "r num bar-cell" }, h("span", { class: "inline-bar", style: { width: `${(r.totalMs / max) * 100}%` } }), h("span", { text: formatMs(r.totalMs) })),
              ),
            ),
          ),
        )
      : h("p", { class: "caption muted", text: "No renders recorded." }),
  );
}

function topRequestsCard(rows, ctx) {
  return h(
    "div",
    { class: "card card-mini" },
    h("div", { class: "card-head" }, h("h2", { text: "Top requests" }), h("button", { type: "button", class: "btn-link", onClick: () => ctx.actions.setView("network"), text: "All" })),
    rows.length
      ? h(
          "table",
          { class: "mini-table" },
          h("thead", null, h("tr", null, h("th", { text: "Request" }), h("th", { class: "r", text: "Count" }), h("th", { class: "r", text: "Max" }))),
          h(
            "tbody",
            null,
            rows.map((r) =>
              h(
                "tr",
                { class: r.errors ? "row-error" : "" },
                h("td", null, h("span", { class: "method", text: r.method }), ellipsis(shortUrl(r.url, 200))),
                h("td", { class: "r num" }, String(r.count), r.errors ? h("span", { class: "text-bad", text: ` · ${r.errors} err` }) : null),
                h("td", { class: "r num", text: formatMs(r.maxMs) }),
              ),
            ),
          ),
        )
      : h("p", { class: "caption muted", text: "No requests recorded." }),
  );
}


function vitalsCard(vitals, imported, ctx) {
  const v = vitals || {};
  const inpAttr = v.attribution?.inp;
  const inpTrace = inpAttr?.traceId && ctx.store.data.snapshot?.tracesById.get(inpAttr.traceId) ? inpAttr.traceId : null;
  const tiles = VITALS.map((meta) => {
    const value = v[meta.key];
    const rating = rateVital(meta, value);
    const max = meta.poor * 1.5;
    const pos = typeof value === "number" ? Math.min(1, value / max) : null;
    let sub = vitalThresholds(meta);
    if (meta.key === "inp" && value == null && v.interactions > 0) sub = `all ${v.interactions} interactions < 16 ms`;
    return h(
      "div",
      { class: ["vital", rating ? `vital-${rating}` : "vital-none"], title: `${meta.name}\n${vitalThresholds(meta)}` },
      h(
        "div",
        { class: "vital-head" },
        h("span", { class: "vital-label", text: meta.label }),
        rating ? h("span", { class: `pill pill-vital-${rating}`, text: rating === "good" ? "Good" : rating === "poor" ? "Poor" : "Needs work" }) : null,
      ),
      h("span", { class: "vital-value num", text: formatVital(meta, value) }),
      h(
        "div",
        { class: "vital-meter", "aria-hidden": "true" },
        h("span", { class: "seg seg-good", style: { width: `${(meta.good / max) * 100}%` } }),
        h("span", { class: "seg seg-ni", style: { width: `${((meta.poor - meta.good) / max) * 100}%` } }),
        h("span", { class: "seg seg-poor", style: { width: `${((max - meta.poor) / max) * 100}%` } }),
        pos === null ? null : h("span", { class: "vital-marker", style: { left: `${pos * 100}%` } }),
      ),
      h("span", { class: "vital-sub caption", text: sub }),
    );
  });
  const notes = [];
  if (v.lcpTarget) notes.push(`LCP element ${v.lcpTarget}`);
  if (inpAttr) notes.push(`INP ${inpAttr.name} on ${inpAttr.target}`);
  else if (v.interactions) notes.push(`INP from ${formatCount(v.interactions)} interaction${v.interactions === 1 ? "" : "s"}`);
  return h(
    "div",
    { class: "card card-vitals" },
    h(
      "div",
      { class: "card-head" },
      h("h2", { text: "Web Vitals" }),
      ellipsis(vitals ? notes.join(" · ") || "This page load" : imported ? "Not included in this bundle" : "Waiting for the page…", "caption muted card-note"),
      inpTrace ? h("button", { type: "button", class: "btn-link", title: "Open the causal trace of the slowest interaction", onClick: () => ctx.actions.openTrace(inpTrace), text: "INP trace" }) : null,
    ),
    h("div", { class: "vitals" }, tiles),
  );
}

function needsEngineCard(ctx) {
  return h(
    "div",
    { class: "card card-mini card-needs-engine" },
    h("div", { class: "card-head" }, h("h2", { text: "Top components" }), h("span", { class: "pill pill-no-data", text: "Needs engine" })),
    h("p", { class: "caption muted", text: "Render counts, wasted renders and render cost come from the engine's React instrumentation." }),
    ctx.store.readOnly ? null : h("div", { class: "cta-inline" }, ctx.siteAccess.enableButton({ small: true }), h("button", { type: "button", class: "btn-link", onClick: () => ctx.actions.openInstall(), text: "How to install" })),
  );
}
