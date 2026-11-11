import { h, replaceChildren, reconcile, ellipsis, emptyState, sortHeader, searchField, listKeyNav } from "../dom.js";
import { formatMs, formatPct, safeMax } from "../format.js";
import { mergeComponentStats } from "../derive.js";

const COLUMNS = [
  { key: "name", label: "Component", defaultDir: "asc" },
  { key: "renders", label: "Renders", className: "r" },
  { key: "mounts", label: "Mounts", className: "r hide-narrow" },
  { key: "wasted", label: "Wasted", className: "r" },
  { key: "totalMs", label: "Total", className: "r bar-col" },
  { key: "avgMs", label: "Avg", className: "r hide-narrow" },
  { key: "maxMs", label: "Max", className: "r" },
];

export function createComponentsView(ctx) {
  const { store } = ctx;
  const ui = () => store.state.ui.components;
  const setUi = (patch) => store.update((st) => Object.assign(st.ui.components, patch), "ui:components");

  const search = searchField({ placeholder: "Filter components", onInput: (v) => setUi({ search: v }) });
  const count = h("span", { class: "caption muted" });
  const table = h("table", { class: "data-table", "aria-label": "Components" });
  const tbody = h("tbody");
  const tableWrap = h("div", { class: "pane pane-table full" }, table);
  const content = h("div", { class: "view-body" }, h("div", { class: "filterbar" }, search.el, count, h("span", { class: "spacer" }), h("span", { class: "caption muted", text: "Click a component to filter insights" })), tableWrap);
  const el = h("section", { class: "view view-components", "aria-label": "Components" });

  listKeyNav(tbody, { itemSelector: "tr", onActivate: (tr) => ctx.actions.filterInsightsBy(tr.dataset.id) });

  function render() {
    const snap = store.data.snapshot;
    if (!snap) return replaceChildren(el, ctx.statusEmpty());
    if (store.limited) {
      return replaceChildren(
        el,
        ctx.siteAccess.engineEmptyState({
          iconName: "cube",
          title: "Component stats need the engine",
          body: "Render counts, mounts, wasted renders and render cost per component come from the engine's React instrumentation, which DevTools APIs can't see.",
          bullets: ["Renders and wasted renders per component", "Self time, average and worst render", "Click-through to the insights they cause"],
        }),
      );
    }
    const all = mergeComponentStats(snap.summary.topComponents, snap.events);
    if (all.length === 0) {
      return replaceChildren(el, emptyState({ iconName: "cube", title: "No component renders recorded", body: "Render tracking needs the React integration or manual trackRender() instrumentation." }));
    }
    if (!el.contains(content)) replaceChildren(el, content);
    const u = ui();
    search.set(u.search);
    const q = u.search.trim().toLowerCase();
    const filtered = q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    count.textContent = filtered.length === all.length ? `${all.length} components` : `${filtered.length} of ${all.length}`;
    const dir = u.sort.dir === "asc" ? 1 : -1;
    const rows = filtered.slice().sort((a, b) => {
      const va = u.sort.key === "name" ? a.name.toLowerCase() : a[u.sort.key];
      const vb = u.sort.key === "name" ? b.name.toLowerCase() : b[u.sort.key];
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
    const max = safeMax(all.map((c) => c.totalMs), 1) || 1;
    replaceChildren(table, sortHeader(COLUMNS, u.sort, (key, d) => setUi({ sort: { key, dir: d } })), tbody);
    if (rows.length === 0) {
      replaceChildren(tbody, h("tr", null, h("td", { colspan: COLUMNS.length, class: "muted center", text: `Filter hides ${all.length} components.` })));
      return;
    }
    reconcile(
      tbody,
      rows,
      (c) => c.name,
      (c) => h("tr", { class: "clickable", tabIndex: 0, dataset: { id: c.name }, onClick: () => ctx.actions.filterInsightsBy(c.name) }),
      (tr, c) => {
        const wastedPct = c.renders ? (c.wasted / c.renders) * 100 : 0;
        replaceChildren(
          tr,
          h("td", null, ellipsis(c.name, "mono")),
          h("td", { class: "r num", text: String(c.renders) }),
          h("td", { class: "r num hide-narrow", text: String(c.mounts) }),
          h("td", { class: `r num ${wastedPct > 30 ? "text-warn" : ""}` }, String(c.wasted), c.renders ? h("span", { class: "muted", text: ` (${formatPct(wastedPct)})` }) : null),
          h("td", { class: "r num bar-cell" }, h("span", { class: "inline-bar", style: { width: `${(c.totalMs / max) * 100}%` } }), h("span", { text: formatMs(c.totalMs) })),
          h("td", { class: "r num hide-narrow", text: formatMs(c.avgMs) }),
          h("td", { class: `r num ${c.maxMs > 16 ? "text-warn" : ""}`, text: formatMs(c.maxMs) }),
        );
      },
    );
  }

  return { el, render, focusSearch: () => search.input.focus(), clearSearch: () => setUi({ search: "" }) };
}
