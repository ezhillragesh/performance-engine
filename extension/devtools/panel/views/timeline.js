import { h, s, icon, replaceChildren, clear, ellipsis, emptyState } from "../dom.js";
import {
  formatMs,
  formatWallTime,
  formatBytes,
  niceTicks,
  statusClass,
  clamp,
  isNum,
  severityRank,
  capitalize,
  shortUrl,
  shortId,
} from "../format.js";
import { timeDomain, eventEnd, packRows, isFailedRequest } from "../derive.js";

const GUTTER = 136;
const PAD_R = 12;
const AXIS_H = 26;
const ROW_H = 12;
const ROW_GAP = 3;
const LANE_PAD = 8;
const LANE_HEAD = 18;
const MAX_NET_ROWS = 8;
const MAX_RENDER_ROWS = 14;
const MIN_BAR = 2;
const MIN_SPAN_MS = 2;

export function createTimelineView(ctx) {
  const { store } = ctx;
  const ui = () => store.state.ui.timeline;

  const traceStrip = h("div", { class: "trace-strip", role: "listbox", "aria-label": "Recent traces", "aria-orientation": "horizontal" });
  const rangeLabel = h("span", { class: "tl-range caption num" });
  const focusChip = h("div", { class: "tl-focus" });
  const zoomOut = h("button", { type: "button", class: "icon-btn", title: "Zoom out (−)", "aria-label": "Zoom out", onClick: () => zoomBy(1.6) }, icon("minus"));
  const zoomIn = h("button", { type: "button", class: "icon-btn", title: "Zoom in (+)", "aria-label": "Zoom in", onClick: () => zoomBy(1 / 1.6) }, icon("plus"));
  const fitBtn = h("button", { type: "button", class: "btn btn-small", title: "Fit all (0)", onClick: () => fit() }, icon("fit", 14), h("span", { text: "Fit" }));
  const legend = h(
    "div",
    { class: "tl-legend caption" },
    legendItem("lg-interaction", "Interaction"),
    legendItem("lg-longtask", "Long task"),
    legendItem("lg-network", "Request"),
    legendItem("lg-error", "Failed"),
    legendItem("lg-render", "Render"),
    legendItem("lg-wasted", "Wasted"),
  );
  const toolbar = h(
    "div",
    { class: "tl-toolbar" },
    h("div", { class: "btn-group" }, zoomOut, zoomIn, fitBtn),
    rangeLabel,
    focusChip,
    h("span", { class: "spacer" }),
    legend,
  );
  const svgHost = h("div", { class: "tl-svg-host" });
  const tooltip = h("div", { class: "tl-tooltip", role: "tooltip", hidden: true });
  const canvas = h("div", { class: "tl-canvas", tabIndex: 0, "aria-label": "Timeline. Ctrl+wheel to zoom, drag to pan, drag the time axis to zoom to a range." }, svgHost, tooltip);
  const inspector = h("div", { class: "tl-inspector", "aria-live": "polite" });
  const body = h("div", { class: "tl-body" }, traceStrip, toolbar, canvas, inspector);
  const el = h("section", { class: "view view-timeline", "aria-label": "Timeline" });

  let layout = null; // last computed geometry, used by pointer handlers
  let raf = 0;

  const ro = new ResizeObserver(() => schedule());
  ro.observe(canvas);

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (el.isConnected && !el.hidden) drawCanvas();
    });
  }

  function setWindow(win) {
    store.state.ui.timeline.window = win;
    schedule();
    updateRangeLabel();
  }

  function currentWindow() {
    const snap = store.data.snapshot;
    if (!snap) return null;
    const u = ui();
    if (u.window) return u.window;
    const dom = timeDomain(snap.events, snap.traces);
    if (!dom) return null;
    const pad = (dom[1] - dom[0]) * 0.02;
    return [dom[0] - pad, dom[1] + pad];
  }

  function clampWindow([a, b]) {
    const snap = store.data.snapshot;
    const dom = snap && timeDomain(snap.events, snap.traces);
    let span = Math.max(MIN_SPAN_MS, b - a);
    if (dom) {
      const full = (dom[1] - dom[0]) * 1.2 + 100;
      span = Math.min(span, full);
      const lo = dom[0] - full * 0.1;
      const hi = dom[1] + full * 0.1;
      a = clamp(a, lo, Math.max(lo, hi - span));
    }
    return [a, a + span];
  }

  function zoomBy(factor, anchorT) {
    const win = currentWindow();
    if (!win) return;
    const [a, b] = win;
    const t = isNum(anchorT) ? anchorT : (a + b) / 2;
    setWindow(clampWindow([t - (t - a) * factor, t + (b - t) * factor]));
  }

  function panBy(dt) {
    const win = currentWindow();
    if (!win) return;
    setWindow(clampWindow([win[0] + dt, win[1] + dt]));
  }

  function fit() {
    store.update((st) => {
      st.ui.timeline.window = null;
    }, "ui:timeline");
  }

  function selectTrace(traceId) {
    const snap = store.data.snapshot;
    const t = snap?.tracesById.get(traceId);
    store.update((st) => {
      const u = st.ui.timeline;
      if (!t || u.traceId === traceId) {
        u.traceId = null;
        u.highlight = null;
        u.fromInsightId = null;
        return;
      }
      u.traceId = traceId;
      u.highlight = null;
      u.fromInsightId = null;
      u.window = traceWindow(t);
    }, "ui:timeline");
  }

  function clearFocus() {
    store.update((st) => {
      Object.assign(st.ui.timeline, { traceId: null, highlight: null, fromInsightId: null });
    }, "ui:timeline");
  }

  function selectEvent(eventId) {
    store.update((st) => {
      st.ui.timeline.selectedEventId = eventId;
    }, "ui:timeline:event");
  }

  // ── Pointer interaction ──────────────────────────────────────────

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!layout) return;
      const rect = svgHost.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(Math.exp(e.deltaY * 0.0025), layout.tAt(x));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
        panBy((d / layout.plotW) * (layout.t1 - layout.t0));
      }
    },
    { passive: false },
  );

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (!layout || e.button !== 0) return;
    const rect = svgHost.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < GUTTER) return;
    const brush = y < AXIS_H || e.shiftKey;
    drag = { startX: x, lastX: x, brush, moved: false, win: [layout.t0, layout.t1], pointerId: e.pointerId, target: e.target };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.toggle("brushing", brush);
    canvas.classList.toggle("panning", !brush);
  });
  canvas.addEventListener("pointermove", (e) => {
    const rect = svgHost.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (drag) {
      if (Math.abs(x - drag.startX) > 3) drag.moved = true;
      drag.lastX = x;
      if (drag.brush) drawBrush(drag.startX, x);
      else if (drag.moved) {
        const dt = ((drag.startX - x) / layout.plotW) * (drag.win[1] - drag.win[0]);
        setWindow(clampWindow([drag.win[0] + dt, drag.win[1] + dt]));
      }
      hideTooltip();
      return;
    }
    showTooltipFor(e);
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.classList.remove("brushing", "panning");
    try {
      canvas.releasePointerCapture(d.pointerId);
    } catch {
      /* already released */
    }
    removeBrush();
    if (e.type === "pointercancel") return;
    if (d.brush && d.moved && layout) {
      const a = layout.tAt(Math.min(d.startX, d.lastX));
      const b = layout.tAt(Math.max(d.startX, d.lastX));
      setWindow(clampWindow([a, b]));
    } else if (!d.moved) {
      const hit = d.target instanceof Element ? d.target.closest("[data-id]") : null;
      selectEvent(hit ? hit.getAttribute("data-id") : null);
    }
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("pointerleave", () => hideTooltip());
  canvas.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") zoomBy(1 / 1.6);
    else if (e.key === "-" || e.key === "_") zoomBy(1.6);
    else if (e.key === "0") fit();
    else if (e.key === "ArrowLeft") panBy(-(layout ? layout.t1 - layout.t0 : 0) * 0.15);
    else if (e.key === "ArrowRight") panBy((layout ? layout.t1 - layout.t0 : 0) * 0.15);
    else if (e.key === "Escape") selectEvent(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  function drawBrush(x1, x2) {
    const svg = svgHost.firstChild;
    if (!svg || !layout) return;
    let r = svg.querySelector(".brush");
    if (!r) svg.appendChild((r = s("rect", { class: "brush", y: 0 })));
    const a = clamp(Math.min(x1, x2), GUTTER, layout.width - PAD_R);
    const b = clamp(Math.max(x1, x2), GUTTER, layout.width - PAD_R);
    r.setAttribute("x", a);
    r.setAttribute("width", Math.max(1, b - a));
    r.setAttribute("height", layout.height);
  }
  function removeBrush() {
    svgHost.querySelector(".brush")?.remove();
  }

  // ── Tooltip ──────────────────────────────────────────────────────

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function showTooltipFor(e) {
    const target = e.target instanceof Element ? e.target.closest("[data-id],[data-span]") : null;
    if (!target) return hideTooltip();
    const snap = store.data.snapshot;
    const lines = [];
    const id = target.getAttribute("data-id");
    if (id) {
      const ev = snap?.eventsById.get(id);
      if (!ev) return hideTooltip();
      lines.push(...describeEvent(ev, snap.timeOrigin, true));
    } else {
      const span = layout?.spans.get(target.getAttribute("data-span"));
      if (!span) return hideTooltip();
      lines.push([capitalize(span.kind), span.label], ["Duration", formatMs(span.end - span.start)]);
      if (span.detail) lines.push(["Detail", span.detail]);
    }
    replaceChildren(
      tooltip,
      h("div", { class: "tt-title", text: lines[0][1] }),
      h("dl", { class: "kv kv-tight" }, lines.slice(1).map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
    );
    tooltip.hidden = false;
    const host = canvas.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let left = e.clientX - host.left + canvas.scrollLeft + 14;
    let top = e.clientY - host.top + canvas.scrollTop + 14;
    if (left + tw > canvas.clientWidth + canvas.scrollLeft - 4) left = e.clientX - host.left - tw - 10;
    if (top + th > canvas.clientHeight + canvas.scrollTop - 4) top = e.clientY - host.top + canvas.scrollTop - th - 10;
    tooltip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
  }

  // ── Rendering ────────────────────────────────────────────────────

  function updateRangeLabel() {
    const win = currentWindow();
    const snap = store.data.snapshot;
    if (!win || !snap) return rangeLabel.replaceChildren();
    rangeLabel.textContent = `${formatWallTime(snap.timeOrigin, win[0])} · ${formatMs(win[1] - win[0])} window`;
  }

  function renderTraceStrip(snap) {
    const u = ui();
    const traces = snap.traces.slice(-40).reverse();
    clear(traceStrip);
    if (traces.length === 0) {
      const text = store.limited ? "Causal traces need the engine — DevTools-only data has no trigger → effect links." : "No traces yet — interact with the page to capture causal traces.";
      traceStrip.appendChild(h("span", { class: "caption muted strip-empty", text }));
      return;
    }
    for (const t of traces) {
      const insights = snap.insightsByTrace.get(t.traceId) || [];
      const worst = insights.slice().sort((a, b) => severityRank(a.severity) - severityRank(b.severity))[0];
      const selected = u.traceId === t.traceId;
      const label = t.trigger.label || t.trigger.target;
      traceStrip.appendChild(
        h(
          "button",
          {
            type: "button",
            role: "option",
            class: ["trace-chip", selected ? "selected" : ""],
            "aria-selected": selected ? "true" : "false",
            title: `${t.trigger.eventType} ${t.trigger.target}${worst ? ` — ${insights.length} insight(s)` : ""}`,
            onClick: () => selectTrace(t.traceId),
          },
          h("span", { class: ["sev-dot", worst ? `sev-${worst.severity}` : "sev-none"], "aria-hidden": "true" }),
          h("span", { class: "chip-kind", text: t.trigger.eventType }),
          ellipsis(label, "chip-label"),
          h("span", { class: "chip-stats num", text: `${formatMs(t.latencyMs ?? t.durationMs)} · ${t.renderCount}r` }),
        ),
      );
    }
    traceStrip.querySelector(".selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderFocusChip(snap) {
    const u = ui();
    clear(focusChip);
    const parts = [];
    if (u.fromInsightId) {
      const entry = store.data.history.get(u.fromInsightId);
      if (entry) parts.push(`Insight: ${entry.insight.source}`);
    }
    if (u.traceId) {
      const t = snap.tracesById.get(u.traceId);
      parts.push(t ? `Trace: ${t.trigger.eventType} ${t.trigger.label || t.trigger.target}` : `Trace ${shortId(u.traceId)} (not in window)`);
    }
    if (u.highlight?.length) parts.push(`${u.highlight.length} evidence event${u.highlight.length === 1 ? "" : "s"}`);
    if (!parts.length) return;
    focusChip.append(
      h("span", { class: "focus-pill" }, icon("link", 12), ellipsis(parts.join(" · ")), h("button", { type: "button", class: "focus-clear", "aria-label": "Clear focus", title: "Clear focus", onClick: clearFocus }, icon("close", 12))),
    );
  }

  function renderInspector(snap) {
    const id = ui().selectedEventId;
    const ev = id ? snap.eventsById.get(id) : null;
    if (!ev) {
      replaceChildren(inspector, h("span", { class: "caption muted", text: "Click an event to inspect it. Ctrl/⌘+wheel zooms, Shift+wheel pans, drag the time axis to zoom to a range." }));
      return;
    }
    const lines = describeEvent(ev, snap.timeOrigin, false);
    const trace = ev.traceId ? snap.tracesById.get(ev.traceId) : null;
    replaceChildren(
      inspector,
      h(
        "div",
        { class: "insp" },
        h("div", { class: "insp-head" }, h("span", { class: `type-pill type-${ev.type}`, text: ev.type }), ellipsis(lines[0][1], "insp-title"), trace ? h("button", { type: "button", class: "btn btn-small", onClick: () => ctx.actions.openTrace(trace.traceId) }, icon("waterfall", 14), h("span", { text: "Open trace" })) : null, h("button", { type: "button", class: "icon-btn", "aria-label": "Close inspector", title: "Close", onClick: () => selectEvent(null) }, icon("close", 14))),
        h("dl", { class: "kv kv-inline" }, lines.slice(1).map(([k, v]) => [h("dt", { text: k }), h("dd", { title: v }, ellipsis(v))])),
      ),
    );
  }

  function drawCanvas() {
    const snap = store.data.snapshot;
    if (!snap) return;
    const win = currentWindow();
    const width = Math.max(320, svgHost.clientWidth || canvas.clientWidth);
    if (!win) {
      replaceChildren(svgHost, h("p", { class: "caption muted pad", text: "No events in this window." }));
      layout = null;
      return;
    }
    const svg = buildSvg(snap, win, width, ui(), store.budgets(), { rendersNeedEngine: store.limited });
    layout = svg.layout;
    replaceChildren(svgHost, svg.el);
    updateRangeLabel();
  }

  function render(topic) {
    const snap = store.data.snapshot;
    if (!snap) {
      replaceChildren(el, ctx.statusEmpty());
      layout = null;
      return;
    }
    if (!el.contains(body)) replaceChildren(el, body);
    if (snap.events.length === 0 && snap.traces.length === 0) {
      renderTraceStrip(snap);
      replaceChildren(svgHost, emptyState({ iconName: "timeline", title: "No events recorded", body: "Events appear here as the page renders, fetches and responds to input." }));
      layout = null;
      renderInspector(snap);
      return;
    }
    if (topic !== "ui:timeline:event") {
      renderTraceStrip(snap);
      renderFocusChip(snap);
    }
    renderInspector(snap);
    drawCanvas();
  }

  return {
    el,
    render,
    focusSearch: () => canvas.focus(),
  };
}

export function traceWindow(t) {
  const dur = Math.max(t.end - t.start, 10);
  const pad = Math.max(dur * 0.12, 8);
  return [t.start - pad, t.end + pad];
}

function legendItem(cls, label) {
  return h("span", { class: "lg" }, h("span", { class: `lg-swatch ${cls}` }), h("span", { text: label }));
}

export function describeEvent(ev, timeOrigin, brief) {
  const at = ["Start", formatWallTime(timeOrigin, ev.timestamp)];
  const trace = ev.traceId ? ["Trace", shortId(ev.traceId, 12)] : null;
  let lines;
  switch (ev.type) {
    case "ui":
      lines = [["UI", `${ev.eventType} → ${ev.label || ev.target}`], ["Target", ev.target], at, isNum(ev.domTimestamp) ? ["Input delay", formatMs(ev.timestamp - ev.domTimestamp)] : null];
      break;
    case "interaction":
      lines = [["Interaction", `${ev.name} · ${formatMs(ev.duration)}`], ["Target", ev.target], ["Latency", formatMs(ev.duration)], ["Input delay", formatMs(ev.inputDelay)], ["Processing", formatMs(ev.processingMs)], ["Presentation", formatMs(ev.presentationDelay)], at];
      break;
    case "longtask":
      lines = [["Long task", `${formatMs(ev.duration)} main-thread block`], ["Duration", formatMs(ev.duration)], ["Blocking", formatMs(ev.blockingDuration)], ["API", ev.api], at];
      if (ev.scripts?.length) lines.push(["Script", `${ev.scripts[0].invoker}${ev.scripts[0].sourceFunctionName ? ` (${ev.scripts[0].sourceFunctionName})` : ""}`]);
      break;
    case "network":
      lines = [["Request", `${ev.method} ${shortUrl(ev.url, 90)}`], ["Status", ev.status ? String(ev.status) : ev.error ? "failed" : "0"], ["Duration", formatMs(ev.duration)], ["Size", formatBytes(ev.responseSize)], at, ev.fromCache ? ["Cache", "served from cache"] : null, ev.error ? ["Error", ev.error] : null, !brief && ev.initiator ? ["Initiator", ev.initiator] : null];
      break;
    case "render":
      lines = [["Render", `${ev.componentName}${ev.wasted ? " (wasted)" : ""}`], ["Duration", formatMs(ev.durationMs)], ev.phase ? ["Phase", ev.phase] : null, isNum(ev.selfDurationMs) ? ["Self", formatMs(ev.selfDurationMs)] : null, ev.changedProps?.length ? ["Changed props", ev.changedProps.join(", ")] : null, ev.stateChanged ? ["State", "changed"] : null, ev.contextChanged ? ["Context", "changed"] : null, ev.parentComponent ? ["Parent", ev.parentComponent] : null, !brief && isNum(ev.commitId) ? ["Commit", `#${ev.commitId}`] : null, at];
      break;
    default:
      lines = [["Event", ev.type], at];
  }
  return [...lines, trace].filter(Boolean);
}

// ── SVG construction (pure function of data + window + width) ──────

function buildSvg(snap, [t0, t1], width, u, budgets, { rendersNeedEngine = false } = {}) {
  const plotW = Math.max(40, width - GUTTER - PAD_R);
  const span = t1 - t0 || 1;
  const x = (t) => GUTTER + ((t - t0) / span) * plotW;
  const tAt = (px) => t0 + ((px - GUTTER) / plotW) * span;
  const visible = (a, b) => b >= t0 && a <= t1;

  const trace = u.traceId ? snap.tracesById.get(u.traceId) : null;
  const highlight = u.highlight?.length ? new Set(u.highlight) : null;
  const focusIds = trace ? new Set([...trace.eventIds, ...trace.spans.map((sp) => sp.eventId).filter(Boolean)]) : null;
  const classFor = (ev) => {
    if (highlight) return highlight.has(ev.eventId) ? " hl" : " dim";
    if (trace) return ev.traceId === trace.traceId || focusIds.has(ev.eventId) ? " focus" : " dim";
    return "";
  };
  const selected = u.selectedEventId;

  const geom = new Map(); // eventId -> { x1, x2, y }
  const laneGroups = [];
  const labels = [];
  let y = AXIS_H + 4;

  const inWin = snap.events.filter((e) => visible(e.timestamp, eventEnd(e)));
  const by = { ui: [], interaction: [], longtask: [], network: [], render: [] };
  for (const e of inWin) by[e.type]?.push(e);

  function bar(ev, x1, x2, yy, hh, cls, extra) {
    const w = Math.max(MIN_BAR, x2 - x1);
    const r = s("rect", {
      class: `bar ${cls}${classFor(ev)}${ev.eventId === selected ? " selected" : ""}`,
      x: x1.toFixed(1),
      y: yy,
      width: w.toFixed(1),
      height: hh,
      rx: Math.min(2, hh / 3),
      "data-id": ev.eventId,
      ...extra,
    });
    geom.set(ev.eventId, { x1, x2: x1 + w, y: yy + hh / 2 });
    return r;
  }

  function laneHeader(title, count, top) {
    labels.push(s("text", { class: "lane-title", x: 12, y: top + 12, text: title }), s("text", { class: "lane-count", x: GUTTER - 10, y: top + 12, "text-anchor": "end", text: count ? String(count) : "" }));
  }

  // Interactions lane
  {
    const g = s("g", { class: "lane lane-interactions" });
    const top = y;
    laneHeader("Interactions", by.interaction.length + by.ui.length, top);
    const rows = packRows(by.interaction, (e) => e.timestamp, (e) => e.timestamp + e.duration, 3);
    const nRows = Math.max(1, rows.length ? Math.max(...rows) + 1 : 1);
    const markerY = top + 4;
    for (const e of by.ui) {
      const cx = x(e.timestamp);
      const tri = s("path", {
        class: `ui-marker${classFor(e)}${e.eventId === selected ? " selected" : ""}${e.startsTrace ? " starts" : ""}`,
        d: `M${cx.toFixed(1)} ${markerY + 8} l-4 -7 h8 z`,
        "data-id": e.eventId,
      });
      geom.set(e.eventId, { x1: cx, x2: cx, y: markerY + 4 });
      g.appendChild(tri);
    }
    by.interaction.forEach((e, i) => {
      const yy = top + LANE_HEAD + rows[i] * (ROW_H + ROW_GAP);
      const tone = e.duration > budgets.interactionLatencyMs ? "bad" : e.duration > budgets.interactionLatencyMs * 0.5 ? "warn" : "good";
      g.appendChild(bar(e, x(e.timestamp), x(e.timestamp + e.duration), yy, ROW_H, `ev-interaction tone-${tone}`));
    });
    const hgt = LANE_HEAD + nRows * (ROW_H + ROW_GAP) + LANE_PAD;
    laneGroups.push({ g, top, hgt });
    y += hgt;
  }

  // Main thread lane
  {
    const g = s("g", { class: "lane lane-main" });
    const top = y;
    const blocking = by.longtask.reduce((a, e) => a + e.blockingDuration, 0);
    laneHeader("Main thread", by.longtask.length, top);
    labels.push(s("text", { class: "lane-sub", x: 12, y: top + 26, text: blocking ? `${formatMs(blocking)} blocking` : "" }));
    const yy = top + LANE_HEAD;
    for (const e of by.longtask) {
      const x1 = x(e.timestamp);
      const x2 = x(e.timestamp + e.duration);
      g.appendChild(bar(e, x1, x2, yy, ROW_H + 2, "ev-longtask"));
      // Darker overlay for the blocking portion (beyond the first 50ms).
      if (e.blockingDuration > 0) {
        const bx = x(e.timestamp + e.duration - e.blockingDuration);
        if (x2 - bx >= 1) g.appendChild(s("rect", { class: `bar-blocking${classFor(e)}`, x: bx.toFixed(1), y: yy, width: (x2 - bx).toFixed(1), height: ROW_H + 2, rx: 2, "pointer-events": "none" }));
      }
    }
    const hgt = LANE_HEAD + ROW_H + 2 + LANE_PAD + 8;
    laneGroups.push({ g, top, hgt });
    y += hgt;
  }

  // Network lane
  {
    const g = s("g", { class: "lane lane-network" });
    const top = y;
    laneHeader("Network", by.network.length, top);
    const rows = packRows(by.network, (e) => e.timestamp, (e) => eventEnd(e), MAX_NET_ROWS, (span / plotW) * 3);
    const nRows = Math.max(1, rows.length ? Math.max(...rows) + 1 : 1);
    by.network.forEach((e, i) => {
      const yy = top + LANE_HEAD + rows[i] * (ROW_H + ROW_GAP);
      const cls = e.fromCache ? "cache" : isFailedRequest(e) ? "error" : statusClass(e.status);
      g.appendChild(bar(e, x(e.timestamp), x(eventEnd(e)), yy, ROW_H, `ev-network net-${cls}`));
    });
    const hgt = LANE_HEAD + nRows * (ROW_H + ROW_GAP) + LANE_PAD;
    laneGroups.push({ g, top, hgt });
    y += hgt;
  }

  // Renders lane: one row per component (most expensive first), rest packed into "Other".
  {
    const g = s("g", { class: "lane lane-renders" });
    const top = y;
    laneHeader("Renders", by.render.length, top);
    if (rendersNeedEngine && by.render.length === 0) {
      // DevTools-only mode: React renders are only visible to the engine.
      const hgt = LANE_HEAD + ROW_H + ROW_GAP + LANE_PAD + 4;
      const cy = top + LANE_HEAD / 2 + (ROW_H + ROW_GAP + LANE_PAD) / 2 + 2;
      g.appendChild(s("rect", { class: "needs-engine-bg", x: GUTTER + 6, y: top + 6, width: Math.max(0, plotW - 12), height: hgt - 12, rx: 6 }));
      labels.push(s("text", { class: "needs-engine-text", x: GUTTER + plotW / 2, y: cy + 4, "text-anchor": "middle" }, s("title", { text: "React renders are recorded by the perf engine. Enable it on this site or install it in your app." }), "Needs engine — React renders are recorded by the perf engine"));
      laneGroups.push({ g, top, hgt, kindRow: top + LANE_HEAD });
      y += hgt;
    } else {
    const totals = new Map();
    for (const e of by.render) totals.set(e.componentName, (totals.get(e.componentName) || 0) + e.durationMs + 0.01);
    const names = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const rowNames = names.length > MAX_RENDER_ROWS ? names.slice(0, MAX_RENDER_ROWS - 1) : names;
    const rowIndex = new Map(rowNames.map((n, i) => [n, i]));
    const otherRow = names.length > MAX_RENDER_ROWS ? rowNames.length : -1;
    const nRows = Math.max(1, rowNames.length + (otherRow >= 0 ? 1 : 0));
    const rowY = (i) => top + LANE_HEAD + i * (ROW_H + ROW_GAP);
    rowNames.forEach((n, i) => {
      const label = n.length > 18 ? `${n.slice(0, 17)}…` : n;
      labels.push(s("text", { class: "row-label", x: GUTTER - 10, y: rowY(i) + ROW_H - 2, "text-anchor": "end" }, s("title", { text: n }), label));
      g.appendChild(s("rect", { class: "row-bg", x: GUTTER, y: rowY(i), width: plotW, height: ROW_H }));
    });
    if (otherRow >= 0) labels.push(s("text", { class: "row-label muted", x: GUTTER - 10, y: rowY(otherRow) + ROW_H - 2, "text-anchor": "end", text: `+${names.length - rowNames.length} more` }));
    for (const e of by.render) {
      const row = rowIndex.has(e.componentName) ? rowIndex.get(e.componentName) : otherRow;
      if (row < 0) continue;
      g.appendChild(bar(e, x(e.timestamp), x(e.timestamp + e.durationMs), rowY(row), ROW_H, `ev-render${e.wasted ? " wasted" : ""}${e.phase === "mount" ? " mount" : ""}`));
    }
    const hgt = LANE_HEAD + nRows * (ROW_H + ROW_GAP) + LANE_PAD;
    laneGroups.push({ g, top, hgt, kindRow: rowY(0) });
    y += hgt;
    }
  }

  const height = y + 8;
  const svg = s("svg", { class: "tl-svg", width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Event timeline" });
  svg.appendChild(
    s(
      "defs",
      null,
      s("pattern", { id: "tl-hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, s("rect", { class: "hatch-bg", width: 4, height: 4 }), s("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 4, "stroke-width": 2 })),
      s("marker", { id: "tl-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, s("path", { class: "link-arrow", d: "M0 0 L8 4 L0 8 z" })),
    ),
  );

  // Lane backgrounds + separators
  laneGroups.forEach(({ top, hgt }, i) => {
    svg.appendChild(s("rect", { class: `lane-bg ${i % 2 ? "alt" : ""}`, x: 0, y: top, width, height: hgt }));
    svg.appendChild(s("line", { class: "hairline", x1: 0, x2: width, y1: top + hgt - 0.5, y2: top + hgt - 0.5 }));
  });
  svg.appendChild(s("line", { class: "hairline", x1: GUTTER - 0.5, x2: GUTTER - 0.5, y1: 0, y2: height }));

  // Axis + grid
  const axis = s("g", { class: "axis" });
  axis.appendChild(s("rect", { class: "axis-bg", x: 0, y: 0, width, height: AXIS_H }));
  const { ticks } = niceTicks(0, span, Math.max(2, Math.floor(plotW / 90)));
  for (const rel of ticks) {
    const tx = x(t0 + rel);
    axis.appendChild(s("line", { class: "grid", x1: tx, x2: tx, y1: AXIS_H, y2: height }));
    axis.appendChild(s("line", { class: "tick", x1: tx, x2: tx, y1: AXIS_H - 5, y2: AXIS_H }));
    // Labels sit right of their tick; near the right edge they flip to the left so they are not clipped.
    const nearEnd = tx > width - 48;
    axis.appendChild(s("text", { class: "tick-label", x: nearEnd ? tx - 3 : tx + 3, y: AXIS_H - 9, "text-anchor": nearEnd ? "end" : "start", text: rel === 0 ? "0" : formatMs(rel) }));
  }
  axis.appendChild(s("text", { class: "axis-hint", x: 12, y: AXIS_H - 9, text: "Time" }));
  axis.appendChild(s("line", { class: "hairline", x1: 0, x2: width, y1: AXIS_H - 0.5, y2: AXIS_H - 0.5 }));
  svg.appendChild(axis);

  // Selected trace window shading
  if (trace && visible(trace.start, trace.end)) {
    const a = clamp(x(trace.start), GUTTER, width - PAD_R);
    const b = clamp(x(trace.end), GUTTER, width - PAD_R);
    svg.appendChild(s("rect", { class: "trace-window", x: a, y: AXIS_H, width: Math.max(1, b - a), height: height - AXIS_H }));
  }

  // Plot content clipped to plot area
  const clipId = "tl-clip";
  svg.firstChild.appendChild(s("clipPath", { id: clipId }, s("rect", { x: GUTTER, y: 0, width: plotW + PAD_R, height })));
  const plot = s("g", { "clip-path": `url(#${clipId})` });
  for (const { g } of laneGroups) plot.appendChild(g);
  svg.appendChild(plot);
  for (const l of labels) svg.appendChild(l);

  // Causal links along TraceSummary.spans
  const spansById = new Map();
  if (trace) {
    const links = s("g", { class: "links", "pointer-events": "none" });
    const ghosts = s("g", { class: "ghosts" });
    const laneY = {
      interaction: laneGroups[0].top + LANE_HEAD + ROW_H / 2,
      longtask: laneGroups[1].top + LANE_HEAD + ROW_H / 2 + 1,
      network: laneGroups[2].top + LANE_HEAD + ROW_H / 2,
      render: laneGroups[3].top + LANE_HEAD + ROW_H / 2,
      commit: laneGroups[3].top + LANE_HEAD - 4,
    };
    const spanGeom = new Map();
    for (const sp of trace.spans) {
      spansById.set(sp.id, sp);
      let gm = sp.eventId ? geom.get(sp.eventId) : null;
      if (!gm) {
        if (!visible(sp.start, sp.end)) continue;
        const x1 = x(sp.start);
        const x2 = Math.max(x1 + MIN_BAR, x(sp.end));
        const yy = laneY[sp.kind] ?? laneY.render;
        gm = { x1, x2, y: yy };
        // Spans without a drawn event (e.g. commits) get a ghost outline so the chain stays visible.
        ghosts.appendChild(s("rect", { class: `ghost ghost-${sp.kind}`, x: x1, y: yy - 4, width: x2 - x1, height: 8, rx: 2, "data-span": sp.id }));
      }
      spanGeom.set(sp.id, gm);
    }
    for (const sp of trace.spans) {
      if (!sp.parentId) continue;
      const p = spanGeom.get(sp.parentId);
      const c = spanGeom.get(sp.id);
      if (!p || !c) continue;
      const px = clamp(c.x1, p.x1, p.x2);
      if (Math.abs(px - c.x1) < 1 && Math.abs(p.y - c.y) < 2) continue;
      const my = (p.y + c.y) / 2;
      links.appendChild(
        s("path", {
          class: `link link-${sp.kind}`,
          d: `M${px.toFixed(1)} ${p.y.toFixed(1)} C${px.toFixed(1)} ${my.toFixed(1)} ${c.x1.toFixed(1)} ${my.toFixed(1)} ${c.x1.toFixed(1)} ${c.y.toFixed(1)}`,
          "marker-end": "url(#tl-arrow)",
        }),
      );
      links.appendChild(s("circle", { class: "link-origin", cx: px, cy: p.y, r: 2 }));
    }
    plot.appendChild(ghosts);
    plot.appendChild(links);
  }

  return { el: svg, layout: { t0, t1, plotW, width, height, tAt, spans: spansById } };
}
