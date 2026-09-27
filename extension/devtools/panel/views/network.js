import { h, icon, replaceChildren, reconcile, ellipsis, emptyState, sortHeader, searchField, listKeyNav } from "../dom.js";
import { formatMs, formatBytes, formatWallTime, statusClass, safeMax, shortUrl } from "../format.js";
import { isFailedRequest } from "../derive.js";

const COLUMNS = [
  { key: "method", label: "Method", defaultDir: "asc" },
  { key: "url", label: "URL", defaultDir: "asc" },
  { key: "status", label: "Status", className: "r" },
  { key: "timestamp", label: "Start", className: "hide-narrow" },
  { key: "duration", label: "Duration", className: "bar-col" },
  { key: "responseSize", label: "Size", className: "r hide-narrow" },
  { key: "initiator", label: "Initiator", className: "hide-narrow", defaultDir: "asc" },
  { key: "traceId", label: "Trace", sortable: false },
];

export function createNetworkView(ctx) {
  const { store } = ctx;
  const ui = () => store.state.ui.network;
  const setUi = (patch) => store.update((st) => Object.assign(st.ui.network, patch), "ui:network");

  const search = searchField({ placeholder: "Filter URL, method, status", onInput: (v) => setUi({ search: v }) });
  const failedToggle = h("button", { type: "button", class: "pill-toggle", "aria-pressed": "false", onClick: () => setUi({ failedOnly: !ui().failedOnly }) }, icon("warning", 14), h("span", { text: "Failed only" }));
  const count = h("span", { class: "caption muted" });
  const table = h("table", { class: "data-table", "aria-label": "Network requests" });
  const tbody = h("tbody");
  const content = h("div", { class: "view-body" }, h("div", { class: "filterbar" }, search.el, failedToggle, count), h("div", { class: "pane pane-table full" }, table));
  const el = h("section", { class: "view view-network", "aria-label": "Network" });

  listKeyNav(tbody, { itemSelector: "tr", onActivate: (tr) => tr.querySelector("button")?.click() });

  function render() {
    const snap = store.data.snapshot;
    if (!snap) return replaceChildren(el, ctx.statusEmpty());
    const all = snap.events.filter((e) => e.type === "network");
    if (all.length === 0) {
      return replaceChildren(el, emptyState({ iconName: "globe", title: "No requests recorded", body: "fetch and XMLHttpRequest calls made by the page show up here." }));
    }
    if (!el.contains(content)) replaceChildren(el, content);
    const u = ui();
    search.set(u.search);
    failedToggle.setAttribute("aria-pressed", u.failedOnly ? "true" : "false");
    const q = u.search.trim().toLowerCase();
    const filtered = all.filter((e) => {
      if (u.failedOnly && !isFailedRequest(e)) return false;
      return !q || `${e.method} ${e.url} ${e.status}`.toLowerCase().includes(q);
    });
    const failed = all.filter(isFailedRequest).length;
    count.textContent = `${filtered.length === all.length ? all.length : `${filtered.length} of ${all.length}`} requests${failed ? ` · ${failed} failed` : ""}`;
    const dir = u.sort.dir === "asc" ? 1 : -1;
    const k = u.sort.key;
    const rows = filtered.slice().sort((a, b) => {
      const va = a[k] ?? -1;
      const vb = b[k] ?? -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    const max = safeMax(filtered.map((e) => e.duration), 1) || 1;
    replaceChildren(table, sortHeader(COLUMNS, u.sort, (key, d) => setUi({ sort: { key, dir: d } })), tbody);
    if (rows.length === 0) {
      replaceChildren(tbody, h("tr", null, h("td", { colspan: COLUMNS.length, class: "muted center" }, `Filters hide ${all.length} requests. `, h("button", { type: "button", class: "btn-link", text: "Clear filters", onClick: () => setUi({ search: "", failedOnly: false }) }))));
      return;
    }
    reconcile(
      tbody,
      rows.slice(0, 1000),
      (e) => e.eventId,
      (e) => h("tr", { dataset: { id: e.eventId }, tabIndex: 0 }),
      (tr, e) => {
        const failedReq = isFailedRequest(e);
        tr.className = failedReq ? "row-error" : "";
        const sc = e.fromCache ? "cache" : failedReq ? "error" : statusClass(e.status);
        const trace = e.traceId && snap.tracesById.get(e.traceId);
        replaceChildren(
          tr,
          h("td", null, h("span", { class: "method", text: e.method })),
          h("td", { class: "url-cell" }, ellipsis(shortUrl(e.url, 300), "mono"), e.error ? h("span", { class: "text-bad caption", title: e.error, text: ` ${e.error}` }) : null),
          h("td", { class: "r num" }, h("span", { class: `status status-${sc}`, text: e.status ? String(e.status) : "ERR" })),
          h("td", { class: "num hide-narrow", text: formatWallTime(snap.timeOrigin, e.timestamp) }),
          h("td", { class: "bar-cell num" }, h("span", { class: `inline-bar net-${sc}`, style: { width: `${(e.duration / max) * 100}%` } }), h("span", { text: formatMs(e.duration) })),
          h("td", { class: "r num hide-narrow", text: e.fromCache ? "cache" : formatBytes(e.responseSize) }),
          h("td", { class: "hide-narrow muted", text: e.initiator || "—" }),
          h("td", null, trace ? h("button", { type: "button", class: "btn-link", title: "Show trace in timeline", onClick: () => ctx.actions.showTraceInTimeline(trace.traceId, [e.eventId]) }, icon("link", 12), h("span", { text: trace.trigger.eventType })) : h("span", { class: "muted", text: "—" })),
        );
      },
    );
  }

  return { el, render, focusSearch: () => search.input.focus(), clearSearch: () => setUi({ search: "" }) };
}
