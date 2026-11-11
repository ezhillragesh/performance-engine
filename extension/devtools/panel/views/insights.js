import { h, icon, replaceChildren, reconcile, setText, ellipsis, emptyState, segmented, searchField, listKeyNav } from "../dom.js";
import {
  humanizeIssueType,
  humanizeCategory,
  capitalize,
  formatMs,
  formatValue,
  formatPct,
  formatAgo,
  formatClock,
  formatWallTime,
  isNum,
  shortId,
  SEVERITIES,
} from "../format.js";
import { filterInsights, evidenceEventIds } from "../derive.js";

const SORTS = [
  { value: "severity", label: "Severity" },
  { value: "impact", label: "Impact" },
  { value: "confidence", label: "Confidence" },
  { value: "recent", label: "Recent" },
];

export function createInsightsView(ctx) {
  const { store } = ctx;
  const ui = () => store.state.ui.insights;
  const setUi = (patch) => store.update((st) => Object.assign(st.ui.insights, patch), "ui:insights");

  const sevControl = segmented({
    label: "Severity filter",
    className: "seg-severity",
    value: ui().severity,
    options: [{ value: "all", label: "All" }, ...SEVERITIES.map((sv) => ({ value: sv, label: capitalize(sv) }))],
    onChange: (v) => setUi({ severity: v }),
  });
  const categorySelect = h("select", { class: "select", "aria-label": "Category filter", onChange: (e) => setUi({ category: e.target.value }) });
  const sortSelect = h(
    "select",
    { class: "select", "aria-label": "Sort insights", onChange: (e) => setUi({ sort: e.target.value }) },
    SORTS.map((o) => h("option", { value: o.value, text: `Sort: ${o.label}` })),
  );
  const search = searchField({ placeholder: "Filter insights", label: "Filter insights", value: ui().search, onInput: (v) => setUi({ search: v }) });

  const list = h("ul", { class: "insight-list", role: "listbox", "aria-label": "Insights", tabIndex: -1 });
  const listWrap = h("div", { class: "pane pane-list" });
  const listStatus = h("div", { class: "list-status caption" });
  const detail = h("div", { class: "pane pane-detail", "aria-live": "polite" });

  listKeyNav(list, {
    itemSelector: "li[role=option]",
    onMove: (li) => setUi({ selectedId: li.dataset.id }),
    onActivate: (li) => setUi({ selectedId: li.dataset.id }),
  });

  const el = h(
    "section",
    { class: "view view-insights", "aria-label": "Insights" },
    h("div", { class: "filterbar" }, sevControl.el, categorySelect, sortSelect, search.el),
    h("div", { class: "split" }, listWrap, detail),
  );

  let lastDetailKey = "";

  function render(topic) {
    const data = store.data;
    const u = ui();
    sevControl.set(u.severity);
    sortSelect.value = u.sort;
    search.set(u.search);

    if (!data.snapshot) {
      replaceChildren(listWrap, ctx.statusEmpty());
      replaceChildren(detail);
      lastDetailKey = "";
      return;
    }

    const all = [...data.history.values()];
    const present = all.filter((e) => e.present);
    syncCategories(present, u.category);

    // Severity segment counts.
    for (const btn of sevControl.buttons) {
      const v = btn.dataset.value;
      const n = v === "all" ? present.length : present.filter((e) => e.insight.severity === v).length;
      let badge = btn.querySelector(".segment-count");
      if (!badge) btn.appendChild((badge = h("span", { class: "segment-count" })));
      setText(badge, n);
    }

    const visible = filterInsights(present, u);
    const hiddenCount = present.length - visible.length;

    if (present.length === 0) {
      replaceChildren(
        listWrap,
        store.limited && data.snapshot.engineVersion === "devtools"
          ? emptyState({
              iconName: "lightbulb",
              title: "Insights unavailable",
              body: "The analyzer bundle (vendor/perf-analyzer.mjs) couldn't be loaded, so DevTools-only data is shown without insights.",
            })
          : emptyState({
              iconName: "lightbulb",
              title: "No insights yet",
              body: store.limited
                ? "Insights from DevTools data (slow interactions, long tasks, slow requests, budgets) appear here. Render and causal insights need the engine."
                : "Interact with the page — insights appear when the analyzer finds a causal performance issue.",
            }),
      );
    } else {
      if (!listWrap.contains(list)) replaceChildren(listWrap, listStatus, list);
      setText(listStatus, hiddenCount ? `${visible.length} of ${present.length} shown` : `${present.length} insight${present.length === 1 ? "" : "s"}`);
      if (visible.length === 0) {
        reconcile(list, [], () => "", () => h("li"), () => {});
        if (!listWrap.querySelector(".empty")) {
          listWrap.appendChild(
            emptyState({
              iconName: "search",
              title: "No matching insights",
              body: `Filters hide ${hiddenCount} insight${hiddenCount === 1 ? "" : "s"}.`,
              action: h("button", { type: "button", class: "btn", text: "Clear filters", onClick: () => setUi({ severity: "all", category: "all", search: "" }) }),
            }),
          );
        }
      } else {
        listWrap.querySelector(".empty")?.remove();
        const pageNow = store.pageNow();
        reconcile(
          list,
          visible,
          (e) => e.insight.id,
          (e) => createItem(e, setUi),
          (li, e) => updateItem(li, e, u.selectedId, pageNow),
        );
      }
      // Roving tabindex: the selected (or first) item is the tab stop.
      const items = list.querySelectorAll("li[role=option]");
      let hasStop = false;
      for (const li of items) {
        const stop = li.dataset.id === u.selectedId;
        li.tabIndex = stop ? 0 : -1;
        hasStop ||= stop;
      }
      if (!hasStop && items[0]) items[0].tabIndex = 0;
    }

    // Detail pane: keyed by selection + entry freshness so typing in filters doesn't rebuild it.
    const entry = u.selectedId ? data.history.get(u.selectedId) : null;
    const key = entry ? `${entry.insight.id}|${entry.sig}|${entry.present}|${entry.occurrences}|${entry.lastSeen}` : `none|${present.length}`;
    if (key !== lastDetailKey || topic === "data") {
      lastDetailKey = key;
      renderDetail(entry);
    }
  }

  function syncCategories(present, selected) {
    const cats = [...new Set(present.map((e) => e.insight.category))].sort();
    if (selected !== "all" && !cats.includes(selected)) cats.push(selected);
    const want = ["all", ...cats].join("|");
    if (categorySelect.dataset.opts !== want) {
      categorySelect.dataset.opts = want;
      replaceChildren(categorySelect, h("option", { value: "all", text: "All categories" }), cats.map((c) => h("option", { value: c, text: humanizeCategory(c) })));
    }
    categorySelect.value = selected;
  }

  function renderDetail(entry) {
    if (!entry) {
      replaceChildren(
        detail,
        h("div", { class: "detail-placeholder" }, icon("lightbulb", 24), h("p", { text: "Select an insight to see its cause, evidence and fix." }), h("p", { class: "caption muted", text: "↑/↓ to move · Enter to select · / to search" })),
      );
      return;
    }
    const i = entry.insight;
    const snap = store.data.snapshot;
    const timeOrigin = snap?.timeOrigin ?? store.data.hello?.timeOrigin;
    const m = i.metadata || {};
    const canTimeline = !!(i.traceId || isNum(m.timeWindowStart) || evidenceEventIds(i).size);

    replaceChildren(
      detail,
      h(
        "div",
        { class: "detail" },
        h(
          "header",
          { class: "detail-head" },
          h("h2", { class: "detail-title", text: humanizeIssueType(i.issueType) }),
          h("div", { class: "chips" },
            h("span", { class: `chip sev-chip sev-${i.severity}`, text: capitalize(i.severity) }),
            h("span", { class: "chip", text: humanizeCategory(i.category) }),
            entry.present ? null : h("span", { class: "chip chip-gone", title: "The engine no longer reports this insight", text: "No longer present in current window" }),
          ),
          h("p", { class: "detail-source" }, h("span", { class: "caption", text: "Source" }), ellipsis(i.source, "mono")),
        ),
        i.message ? h("p", { class: "detail-message", text: i.message }) : null,
        h(
          "div",
          { class: "detail-actions" },
          h("button", { type: "button", class: "btn btn-accent", disabled: !canTimeline, onClick: () => ctx.actions.showInsightInTimeline(i) }, icon("timeline", 14), h("span", { text: "Show in timeline" })),
          i.traceId && snap?.tracesById.has(i.traceId)
            ? h("button", { type: "button", class: "btn", onClick: () => ctx.actions.openTrace(i.traceId) }, icon("waterfall", 14), h("span", { text: "Open trace" }))
            : null,
        ),
        h(
          "div",
          { class: "detail-grid" },
          block("Cause", i.cause || "—"),
          block("Suggested fix", i.possibleFix || "—"),
          h("div", { class: "block" }, h("h3", { text: "Confidence" }), meter(i.confidence)),
          h(
            "div",
            { class: "block" },
            h("h3", { text: "Impact" }),
            h("p", { class: "num impact" }, h("strong", { text: formatMs(i.impact.estimatedDelayMs) }), h("span", { class: "muted", text: " est. delay" })),
            isNum(i.impact.renderCostMs) ? h("p", { class: "num caption", text: `${formatMs(i.impact.renderCostMs)} render cost` }) : null,
          ),
        ),
        evidenceSection(i),
        h(
          "div",
          { class: "block block-meta" },
          h("h3", { text: "Context" }),
          h(
            "dl",
            { class: "kv" },
            kv("Seen", `${entry.occurrences}×`),
            kv("First seen", `${formatClock(entry.firstSeen)} (${formatAgo(Date.now() - entry.firstSeen)})`),
            kv("Last seen", `${formatClock(entry.lastSeen)} (${formatAgo(Date.now() - entry.lastSeen)})`),
            isNum(m.timeWindowStart) ? kv("Window", `${formatWallTime(timeOrigin, m.timeWindowStart)} · ${formatMs((m.timeWindowEnd ?? m.timeWindowStart) - m.timeWindowStart)}`) : null,
            m.interactionType ? kv("Interaction", m.interactionType) : null,
            m.rootComponent ? kv("Root component", m.rootComponent) : null,
            isNum(m.renderCount) ? kv("Renders", String(m.renderCount)) : null,
            i.traceId ? kv("Trace", shortId(i.traceId, 12)) : null,
            kv("Insight id", i.id),
          ),
          m.affectedComponents?.length
            ? h("div", { class: "chips wrap" }, m.affectedComponents.slice(0, 30).map((c) => h("button", { type: "button", class: "chip chip-button", title: `Filter by ${c}`, text: c, onClick: () => setUi({ search: c }) })))
            : null,
        ),
      ),
    );
  }

  return {
    el,
    render,
    focusSearch: () => search.input.focus(),
    clearSearch: () => setUi({ search: "" }),
  };
}

function createItem(entry, setUi) {
  const li = h("li", { role: "option", class: "insight-item", dataset: { id: entry.insight.id } });
  li.append(
    h("span", { class: "sev-bar", "aria-hidden": "true" }),
    h(
      "div",
      { class: "item-main" },
      h("div", { class: "item-row" }, h("span", { class: "item-title ellipsis" }), h("span", { class: "item-impact num" })),
      h("div", { class: "item-row" }, h("span", { class: "item-source ellipsis mono" }), h("span", { class: "item-meta caption" })),
    ),
  );
  li.addEventListener("click", () => setUi({ selectedId: li.dataset.id }));
  return li;
}

function updateItem(li, entry, selectedId, pageNow) {
  const i = entry.insight;
  li.className = `insight-item sev-${i.severity}`;
  const selected = i.id === selectedId;
  li.setAttribute("aria-selected", selected ? "true" : "false");
  const title = li.querySelector(".item-title");
  setText(title, humanizeIssueType(i.issueType));
  title.title = i.message || humanizeIssueType(i.issueType);
  setText(li.querySelector(".item-impact"), formatMs(i.impact.estimatedDelayMs));
  const src = li.querySelector(".item-source");
  setText(src, i.source);
  src.title = i.source;
  const end = i.metadata?.timeWindowEnd;
  const when = isNum(end) && isNum(pageNow) ? formatAgo(pageNow - end) : formatAgo(Date.now() - entry.lastSeen);
  setText(li.querySelector(".item-meta"), `${entry.occurrences > 1 ? `seen ${entry.occurrences}× · ` : ""}${when}`);
  li.setAttribute("aria-label", `${capitalize(i.severity)}: ${humanizeIssueType(i.issueType)} — ${i.source}`);
}

function block(title, text) {
  return h("div", { class: "block" }, h("h3", { text: title }), h("p", { text }));
}

function kv(k, v) {
  return [h("dt", { text: k }), h("dd", { title: v }, ellipsis(v))];
}

function meter(value) {
  const pct = Math.round((value || 0) * 100);
  const tone = pct >= 75 ? "good" : pct >= 50 ? "warn" : "bad";
  return h(
    "div",
    { class: "meter-wrap" },
    h("div", { class: `meter tone-${tone}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-label": "Confidence" }, h("span", { class: "meter-fill", style: { width: `${pct}%` } })),
    h("span", { class: "num meter-label", text: formatPct(pct) }),
  );
}

function evidenceSection(insight) {
  const items = insight.evidence;
  return h(
    "div",
    { class: "block block-evidence" },
    h("h3", null, "Evidence ", h("span", { class: "muted caption", text: items.length ? `${items.length} observation${items.length === 1 ? "" : "s"}` : "" })),
    items.length
      ? h(
          "ul",
          { class: "evidence-list" },
          items
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((ev) => {
              const numeric = typeof ev.value === "number";
              const hasThreshold = numeric && isNum(ev.threshold) && ev.threshold > 0;
              const over = hasThreshold && ev.value > ev.threshold;
              let bar = null;
              if (hasThreshold) {
                const scale = Math.max(ev.value, ev.threshold) * 1.15;
                bar = h(
                  "div",
                  { class: `ev-bar ${over ? "over" : "under"}`, title: `${formatValue(ev.value, ev.unit)} vs limit ${formatValue(ev.threshold, ev.unit)}` },
                  h("span", { class: "ev-fill", style: { width: `${(ev.value / scale) * 100}%` } }),
                  h("span", { class: "ev-threshold", style: { left: `${(ev.threshold / scale) * 100}%` } }),
                );
              }
              return h(
                "li",
                { class: `evidence kind-${ev.kind}` },
                h(
                  "div",
                  { class: "ev-row" },
                  h("span", { class: "ev-kind", title: capitalize(ev.kind), text: ev.kind[0].toUpperCase() }),
                  ellipsis(ev.label, "ev-label"),
                  h("span", { class: `ev-value num ${over ? "text-bad" : ""}`, text: formatValue(ev.value, ev.unit) }),
                ),
                bar
                  ? h("div", { class: "ev-compare" }, bar, h("span", { class: "caption num", text: `limit ${formatValue(ev.threshold, ev.unit)}` }))
                  : null,
                h(
                  "div",
                  { class: "ev-foot caption" },
                  h("span", { class: "ev-weight", title: "Contribution to confidence" }, h("span", { class: "weight-bar" }, h("span", { style: { width: `${Math.round(ev.weight * 100)}%` } })), h("span", { class: "num", text: `weight ${ev.weight.toFixed(2)}` })),
                  ev.eventIds?.length ? h("span", { class: "muted", text: `${ev.eventIds.length} event${ev.eventIds.length === 1 ? "" : "s"}` }) : null,
                ),
              );
            }),
        )
      : h("p", { class: "caption muted", text: "The engine did not attach evidence to this insight." }),
  );
}
