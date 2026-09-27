import { h, icon, replaceChildren, reconcile, setText, ellipsis, emptyState, sortHeader, listKeyNav } from "../dom.js";
import { formatMs, formatWallTime, humanizeIssueType, capitalize, niceTicks, severityRank, isNum } from "../format.js";
import { flattenSpanTree } from "../derive.js";

const COLUMNS = [
  { key: "trigger", label: "Trigger", defaultDir: "asc" },
  { key: "start", label: "Time" },
  { key: "durationMs", label: "Duration", className: "r" },
  { key: "latencyMs", label: "Latency", className: "r" },
  { key: "renderCount", label: "Renders", className: "r" },
  { key: "networkCount", label: "Network", className: "r" },
  { key: "longTaskMs", label: "Long tasks", className: "r" },
  { key: "components", label: "Components", sortable: false, className: "hide-narrow" },
];

function sortValue(t, key) {
  if (key === "trigger") return `${t.trigger.label || t.trigger.target}`.toLowerCase();
  if (key === "latencyMs") return t.latencyMs ?? -1;
  return t[key];
}

export function createTracesView(ctx) {
  const { store } = ctx;
  const ui = () => store.state.ui.traces;
  const setUi = (patch) => store.update((st) => Object.assign(st.ui.traces, patch), "ui:traces");

  const table = h("table", { class: "data-table", "aria-label": "Traces" });
  const tbody = h("tbody");
  const tableWrap = h("div", { class: "pane pane-table" }, table);
  const detail = h("div", { class: "pane pane-detail" });
  const split = h("div", { class: "split split-traces" }, tableWrap, detail);
  const el = h("section", { class: "view view-traces", "aria-label": "Traces" });

  listKeyNav(tbody, {
    itemSelector: "tr",
    onMove: (tr) => setUi({ selectedId: tr.dataset.id }),
    onActivate: (tr) => setUi({ selectedId: tr.dataset.id }),
  });

  let lastDetail = "";

  function render(topic) {
    const snap = store.data.snapshot;
    if (!snap) {
      replaceChildren(el, ctx.statusEmpty());
      lastDetail = "";
      return;
    }
    if (store.limited) {
      replaceChildren(
        el,
        ctx.siteAccess.engineEmptyState({
          iconName: "waterfall",
          title: "Causal traces need the engine",
          body: "A trace links each click or keystroke to the long tasks, requests and React renders it caused. DevTools APIs can't observe that causality — the engine records it inside the page.",
          bullets: ["Span waterfall per interaction", "Requests and renders attributed to their trigger", "Insights linked to the trace that caused them"],
        }),
      );
      lastDetail = "";
      return;
    }
    if (snap.traces.length === 0) {
      replaceChildren(el, emptyState({ iconName: "waterfall", title: "No traces yet", body: "A trace is captured for each user interaction and everything it causes — long tasks, requests and renders." }));
      lastDetail = "";
      return;
    }
    if (!el.contains(split)) replaceChildren(el, split);
    const u = ui();
    replaceChildren(table, sortHeader(COLUMNS, u.sort, (key, dir) => setUi({ sort: { key, dir } })), tbody);
    const dir = u.sort.dir === "asc" ? 1 : -1;
    const rows = snap.traces.slice().sort((a, b) => {
      const va = sortValue(a, u.sort.key);
      const vb = sortValue(b, u.sort.key);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    if (!u.selectedId || !snap.tracesById.has(u.selectedId)) {
      // Keep a stale selection id (so it can reappear) but render the newest trace by default only if none chosen.
      if (!u.selectedId) u.selectedId = rows[0]?.traceId ?? null;
    }
    reconcile(
      tbody,
      rows,
      (t) => t.traceId,
      (t) => {
        const tr = h("tr", { class: "clickable", dataset: { id: t.traceId }, tabIndex: -1, onClick: () => setUi({ selectedId: t.traceId }) });
        for (let i = 0; i < COLUMNS.length; i++) tr.appendChild(h("td", { class: COLUMNS[i].className }));
        return tr;
      },
      (tr, t) => updateRow(tr, t, snap, u.selectedId),
    );
    const trace = snap.tracesById.get(u.selectedId);
    const key = trace ? `${trace.traceId}|${trace.spans.length}|${trace.end}|${(snap.insightsByTrace.get(trace.traceId) || []).length}` : "none";
    if (key !== lastDetail || topic === "data") {
      lastDetail = key;
      renderDetail(trace, snap);
    }
  }

  function renderDetail(trace, snap) {
    if (!trace) {
      replaceChildren(detail, h("div", { class: "detail-placeholder" }, icon("waterfall", 24), h("p", { text: "Select a trace to see its causal waterfall." })));
      return;
    }
    const insights = (snap.insightsByTrace.get(trace.traceId) || []).slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    replaceChildren(
      detail,
      h(
        "div",
        { class: "detail" },
        h(
          "header",
          { class: "detail-head" },
          h("h2", { class: "detail-title" }, h("span", { class: "chip", text: trace.trigger.eventType }), " ", ellipsis(trace.trigger.label || trace.trigger.target)),
          h("p", { class: "caption num", text: `${formatWallTime(snap.timeOrigin, trace.start)} · ${formatMs(trace.durationMs)} total${isNum(trace.latencyMs) ? ` · ${formatMs(trace.latencyMs)} latency` : ""}` }),
        ),
        h(
          "div",
          { class: "detail-actions" },
          h("button", { type: "button", class: "btn btn-accent", onClick: () => ctx.actions.showTraceInTimeline(trace.traceId) }, icon("timeline", 14), h("span", { text: "Show in timeline" })),
        ),
        waterfall(trace),
        h(
          "div",
          { class: "block" },
          h("h3", { text: `Linked insights (${insights.length})` }),
          insights.length
            ? h(
                "ul",
                { class: "link-list" },
                insights.map((i) =>
                  h(
                    "li",
                    null,
                    h(
                      "button",
                      { type: "button", class: "link-row", onClick: () => ctx.actions.goToInsight(i.id) },
                      h("span", { class: `sev-dot sev-${i.severity}`, title: capitalize(i.severity) }),
                      ellipsis(humanizeIssueType(i.issueType), "link-title"),
                      ellipsis(i.source, "muted mono"),
                      icon("arrowRight", 14),
                    ),
                  ),
                ),
              )
            : h("p", { class: "caption muted", text: "No insights reference this trace." }),
        ),
        trace.components.length
          ? h("div", { class: "block" }, h("h3", { text: "Components" }), h("div", { class: "chips wrap" }, trace.components.slice(0, 40).map((c) => h("span", { class: "chip", text: c }))))
          : null,
      ),
    );
  }

  return { el, render };
}

function updateRow(tr, t, snap, selectedId) {
  const selected = t.traceId === selectedId;
  tr.setAttribute("aria-selected", selected ? "true" : "false");
  tr.classList.toggle("selected", selected);
  tr.tabIndex = selected ? 0 : -1;
  const insights = snap.insightsByTrace.get(t.traceId) || [];
  const worst = insights.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
  const cells = tr.children;
  const label = t.trigger.label || t.trigger.target;
  // Flex row so a long label truncates itself instead of being pushed out of the cell by the chip.
  replaceChildren(
    cells[0],
    h("span", { class: "cell-row" }, h("span", { class: ["sev-dot", worst ? `sev-${worst.severity}` : "sev-none"] }), h("span", { class: "chip chip-tiny", text: t.trigger.eventType }), ellipsis(label)),
  );
  setText(cells[1], formatWallTime(snap.timeOrigin, t.start));
  cells[1].className = "num";
  setText(cells[2], formatMs(t.durationMs));
  cells[2].className = "r num";
  setText(cells[3], formatMs(t.latencyMs));
  cells[3].className = "r num";
  setText(cells[4], String(t.renderCount));
  cells[4].className = "r num";
  setText(cells[5], String(t.networkCount));
  cells[5].className = "r num";
  setText(cells[6], t.longTaskMs ? formatMs(t.longTaskMs) : "—");
  cells[6].className = `r num ${t.longTaskMs > 100 ? "text-warn" : ""}`;
  replaceChildren(cells[7], ellipsis(t.components.slice(0, 6).join(", ") + (t.components.length > 6 ? ` +${t.components.length - 6}` : ""), "muted"));
  cells[7].className = "hide-narrow";
}

function waterfall(trace) {
  const rows = flattenSpanTree(trace.spans);
  if (rows.length === 0) return h("p", { class: "caption muted", text: "This trace has no spans." });
  const start = trace.start;
  const end = Math.max(trace.end, ...rows.map((r) => r.span.end));
  const span = end - start || 1;
  const { ticks } = niceTicks(0, span, 5);
  const pct = (t) => `${((t - start) / span) * 100}%`;
  return h(
    "div",
    { class: "block" },
    h("h3", { text: `Waterfall (${rows.length} spans)` }),
    h(
      "div",
      { class: "waterfall", role: "tree", "aria-label": "Span waterfall" },
      h(
        "div",
        { class: "wf-axis" },
        h("span", { class: "wf-name caption", text: "Span" }),
        h("span", { class: "wf-track" }, ticks.map((t) => h("span", { class: t / span > 0.88 ? "wf-tick wf-tick-clipped caption num" : "wf-tick caption num", style: { left: `${(t / span) * 100}%` }, text: formatMs(t) }))),
      ),
      rows.map(({ span: sp, depth }) =>
        h(
          "div",
          { class: `wf-row kind-${sp.kind}`, role: "treeitem", "aria-level": depth + 1, title: `${sp.label}${sp.detail ? ` — ${sp.detail}` : ""} · ${formatMs(sp.end - sp.start)}` },
          h("span", { class: "wf-name", style: { paddingLeft: `${Math.min(depth, 8) * 12 + 4}px` } }, h("span", { class: `kind-dot kind-${sp.kind}` }), ellipsis(sp.label)),
          h(
            "span",
            { class: "wf-track" },
            ticks.map((t) => h("span", { class: "wf-grid", style: { left: `${(t / span) * 100}%` } })),
            h("span", { class: `wf-bar kind-${sp.kind}`, style: { left: pct(sp.start), width: `max(2px, ${((sp.end - sp.start) / span) * 100}%)` } }),
            // Label sits right of the bar, or left of it when the bar ends near the edge.
            (sp.end - start) / span > 0.8
              ? h("span", { class: "wf-dur caption num", style: { right: `calc(${100 - ((sp.start - start) / span) * 100}% + 4px)` }, text: formatMs(sp.end - sp.start) })
              : h("span", { class: "wf-dur caption num", style: { left: `calc(${pct(sp.end)} + 4px)` }, text: formatMs(sp.end - sp.start) }),
          ),
        ),
      ),
    ),
  );
}
