// Panel entry: builds the shell, wires the connection, routes messages into the store.
import { h, icon, replaceChildren, setText, ellipsis, emptyState, isTypingTarget, downloadJson } from "./dom.js";
import { createStore } from "./state.js";
import { createConnection, contextValid } from "./connection.js";
import { validatePageMessage, validateBundle, EXPORT_FORMAT } from "./validate.js";
import { shortId, shortUrl, formatClock, isNum } from "./format.js";
import { evidenceEventIds, eventEnd } from "./derive.js";
import { createOverviewView } from "./views/overview.js";
import { createInsightsView } from "./views/insights.js";
import { createTimelineView, traceWindow } from "./views/timeline.js";
import { createTracesView } from "./views/traces.js";
import { createComponentsView } from "./views/components.js";
import { createNetworkView } from "./views/network.js";
import { createAccessibilityView } from "./views/accessibility.js";
import { createBudgetsPopover, loadStoredBudgets } from "./views/budgets.js";
import { createSiteAccess, isEnableableOrigin, MODE_META } from "./views/siteAccess.js";
import { createDevtoolsLayer } from "./devtoolsLayer/index.js";

const NO_ENGINE_TIMEOUT_MS = 2500;
const RECORDING_FRESH_MS = 3000;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const INJECTION_REPLY_TIMEOUT_MS = 10000;

// View registry: one row per tab. Tabs, panels, keyboard shortcuts (1–9) and dirty tracking are
// all derived from this list, so adding a view is one import + one row here.
const VIEWS = [
  { id: "overview", label: "Overview", icon: "overview", create: createOverviewView },
  { id: "insights", label: "Insights", icon: "lightbulb", create: createInsightsView },
  { id: "timeline", label: "Timeline", icon: "timeline", create: createTimelineView },
  { id: "traces", label: "Traces", icon: "waterfall", create: createTracesView },
  { id: "components", label: "Components", icon: "cube", create: createComponentsView },
  { id: "network", label: "Network", icon: "globe", create: createNetworkView },
  // Runs its own audit in the inspected page (inspectedWindow.eval), so it works in every mode.
  { id: "accessibility", label: "Accessibility", icon: "check", create: createAccessibilityView },
];

const STATUS_TEXT = {
  waiting: "Waiting for engine…",
  connected: "Connected",
  recording: "Recording",
  paused: "Paused",
  disconnected: "Disconnected",
  invalidated: "Extension updated",
  navigated: "Page navigated",
};

// ── Theme ────────────────────────────────────────────────────────────

function applyTheme() {
  const themeName = globalThis.chrome?.devtools?.panels?.themeName;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    const dark = themeName === "dark" || (themeName !== "default" && mq.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };
  set();
  mq.addEventListener?.("change", set);
}

// ── Boot ─────────────────────────────────────────────────────────────

function boot() {
  applyTheme();
  const store = createStore();
  const tabId = chrome.devtools?.inspectedWindow?.tabId;
  let noEngineTimer = 0;
  let storedBudgets = null;
  let injectionTimer = 0;
  let lastNavigation = 0;

  // DevTools-only layer: always on (Web Vitals in every mode); synthetic snapshots only without an engine.
  const layer = createDevtoolsLayer({
    devtools: chrome.devtools,
    wantSnapshots: () => !store.hasEngine && store.state.devtoolsFallback,
    onSnapshot: (snap) => {
      if (store.hasEngine || !store.state.devtoolsFallback) return;
      store.setPassiveSnapshot(snap);
      recomputeStatus();
    },
    onVitals: (v) => store.setVitals(v),
    onPage: (info) => {
      store.setPage(info);
      if (info.origin) setOrigin(info.origin);
    },
  });
  loadStoredBudgets().then((b) => {
    storedBudgets = b;
    if (b) layer.setBudgets(b);
  });

  const conn = createConnection({
    tabId,
    onMessage: handleBackgroundMessage,
    onState: (s) => {
      if (s === "invalidated") {
        clearTimeout(noEngineTimer);
        store.setStatus("invalidated");
      } else if (s === "closed") {
        if (store.state.status !== "invalidated") store.setStatus("disconnected");
      } else if (s === "open") {
        requestInjectionStatus();
        if (store.state.live.hello || store.state.devtoolsFallback) recomputeStatus();
        else waitForEngine("waiting");
      }
    },
  });

  function waitForEngine(status) {
    store.setStatus(status);
    clearTimeout(noEngineTimer);
    noEngineTimer = setTimeout(() => {
      // PING went unanswered: fall back to the DevTools-only layer instead of a dead end.
      if (store.hasEngine || store.state.status === "invalidated") return;
      store.setDevtoolsFallback(true);
      layer.refresh();
      recomputeStatus();
    }, NO_ENGINE_TIMEOUT_MS);
  }

  function recomputeStatus() {
    const st = store.state.status;
    if (st === "invalidated" || (st === "disconnected" && !conn.connected)) return;
    const live = store.state.live;
    if (!live.hello && !live.snapshot) {
      if (store.state.devtoolsFallback) store.setStatus(layer.paused ? "paused" : "recording");
      return;
    }
    if (live.snapshot?.paused) store.setStatus("paused");
    else if (live.snapshot && Date.now() - live.receivedAt < RECORDING_FRESH_MS) store.setStatus("recording");
    else store.setStatus("connected");
  }

  function onNavigated() {
    // background's TAB_NAVIGATED and devtools.network.onNavigated both report the same navigation.
    const now = Date.now();
    if (now - lastNavigation < 800) return;
    lastNavigation = now;
    store.resetLive();
    layer.navigated();
    viewInstances.accessibility.onNavigated(); // coalesced with its own onNavigated listener
    store.setDevtoolsFallback(false);
    store.resetPassive();
    store.setVitals(null);
    waitForEngine("navigated");
    // The old document may still answer right away; ask again once the new one exists.
    setTimeout(refreshOrigin, 700);
  }

  // ── Site origin + injection status ──

  function setOrigin(origin) {
    if (typeof origin !== "string" || !origin || origin === store.state.injection.origin) return;
    const { pending, message } = store.state.injection;
    store.setInjection({ origin, enabled: false, granted: false, known: false, pending, message });
    requestInjectionStatus();
  }

  function refreshOrigin() {
    layer.fetchOrigin().then((o) => o && setOrigin(o));
  }

  function requestInjectionStatus() {
    const origin = store.state.injection.origin;
    if (isEnableableOrigin(origin)) conn.injection("INJECTION_STATUS_REQUEST", origin);
  }

  function handleInjectionStatus(msg) {
    const p = msg.payload && typeof msg.payload === "object" ? msg.payload : msg;
    const origin = typeof p.origin === "string" ? p.origin : null;
    const inj = store.state.injection;
    if (origin && inj.origin && origin !== inj.origin) return; // reply for a previous page
    clearTimeout(injectionTimer);
    const enabled = p.enabled === true;
    let message = inj.message;
    if (typeof p.error === "string" && p.error) message = { tone: "error", text: p.error.slice(0, 300) };
    else if (inj.pending === "enable") message = enabled ? { tone: "good", text: "Enabled — the page reloads with the injected engine." } : { tone: "error", text: "The extension couldn't enable injection on this site." };
    else if (inj.pending === "disable") message = enabled ? { tone: "error", text: "The extension couldn't disable injection on this site." } : { tone: "good", text: "Disabled — the page reloads without the engine." };
    store.setInjection({ enabled, granted: p.granted === true, known: true, pending: null, message });
  }

  function awaitInjectionReply(what) {
    clearTimeout(injectionTimer);
    injectionTimer = setTimeout(() => {
      if (store.state.injection.pending !== what) return;
      store.setInjection({ pending: null, message: { tone: "error", text: "The extension didn't answer. Reload it on chrome://extensions and try again." } });
    }, INJECTION_REPLY_TIMEOUT_MS);
  }

  function permissionBlocked(detail) {
    store.setInjection({
      pending: null,
      message: {
        tone: "error",
        text: `Chrome didn't show the site-access prompt from DevTools${detail ? ` (${String(detail).slice(0, 120)})` : ""}. Grant this site from the Extensions menu in the toolbar, then click Enable again.`,
      },
    });
  }

  function handleBackgroundMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "TAB_NAVIGATED") return onNavigated();
    if (msg.type === "INJECTION_STATUS") return handleInjectionStatus(msg);
    if (msg.type === "CONNECTION") {
      if (msg.engineDetected === true && !store.state.live.hello) store.setStatus("connected");
      return;
    }
    if (msg.type !== "PERF_MESSAGE") return;
    const m = validatePageMessage(msg.payload);
    if (!m) return;
    clearTimeout(noEngineTimer);
    switch (m.type) {
      case "HELLO": {
        store.setHello(m.payload);
        const note = store.state.injection.message;
        if (note && note.tone !== "error") store.setInjection({ message: null });
        // Budgets are page state: re-apply the user's saved budgets on every (re)attach.
        if (storedBudgets) conn.command("SET_BUDGETS", storedBudgets);
        break;
      }
      case "SNAPSHOT":
        store.setSnapshot(m.payload);
        break;
      case "RESET":
        store.resetLive({ keepHello: true });
        break;
      case "INSIGHTS_UPDATE":
        store.setLegacy("insights", m.payload);
        break;
      case "EVENTS_UPDATE":
        store.setLegacy("events", m.payload);
        break;
    }
    recomputeStatus();
  }

  // ── Actions shared with views ──

  /** Commands in DevTools-only mode are served by the local layer instead of a page engine. */
  function passiveCommand(command, payload) {
    switch (command) {
      case "PAUSE":
      case "RESUME":
        layer.setPaused(command === "PAUSE");
        layer.refresh();
        recomputeStatus();
        return true;
      case "CLEAR":
        layer.clear();
        store.resetPassive();
        layer.refresh();
        return true;
      case "SET_BUDGETS":
        layer.refresh();
        return true;
      case "REQUEST_SNAPSHOT":
        layer.refresh();
        return true;
      default:
        return false;
    }
  }

  const actions = {
    setView: (v) => store.setView(v),
    command(command, payload) {
      if (store.readOnly && command !== "SET_BUDGETS") return false;
      if (command === "SET_BUDGETS") layer.setBudgets(payload); // kept for a later DevTools-only fallback too
      if (!store.readOnly && store.mode === "devtools") return passiveCommand(command, payload);
      return conn.command(command, payload);
    },
    /**
     * "Enable on this site". chrome.permissions.request must be called synchronously from the
     * click (user gesture), so nothing here may await before it.
     */
    enableInjection() {
      const origin = store.state.injection.origin;
      if (!isEnableableOrigin(origin)) {
        store.setInjection({ message: { tone: "error", text: "Only http(s) pages can run the injected engine." } });
        return;
      }
      const perms = globalThis.chrome?.permissions;
      if (!perms || typeof perms.request !== "function") return permissionBlocked("permissions API unavailable here");
      let request;
      try {
        request = perms.request({ origins: [`${origin}/*`] });
      } catch (err) {
        return permissionBlocked(err?.message || err);
      }
      if (!request || typeof request.then !== "function") return permissionBlocked("no permission prompt");
      store.setInjection({ pending: "enable", message: { tone: "info", text: `Waiting for Chrome's site-access prompt for ${origin}…` } });
      request.then(
        (granted) => {
          if (!granted) {
            store.setInjection({ pending: null, message: { tone: "error", text: "Site access wasn't granted, so the engine can't be injected. DevTools-only data keeps working." } });
            return;
          }
          if (!conn.injection("ENABLE_INJECTION", origin)) {
            store.setInjection({ pending: null, granted: true, message: { tone: "error", text: "Access granted, but the extension background is disconnected. Try again in a moment." } });
            return;
          }
          store.setInjection({ granted: true, message: { tone: "info", text: "Access granted — injecting the engine and reloading the page…" } });
          awaitInjectionReply("enable");
        },
        (err) => permissionBlocked(err?.message || err),
      );
    },
    disableInjection() {
      const origin = store.state.injection.origin;
      if (!isEnableableOrigin(origin)) return;
      if (!conn.injection("DISABLE_INJECTION", origin)) {
        store.setInjection({ message: { tone: "error", text: "The extension background is disconnected. Try again in a moment." } });
        return;
      }
      store.setInjection({ pending: "disable", message: { tone: "info", text: "Disabling injection and reloading the page…" } });
      awaitInjectionReply("disable");
    },
    openInstall: () => siteAccess.openInstall(),
    openSiteSettings: (anchor) => siteAccess.openSettings(anchor),
    goToInsight(id) {
      store.update((st) => {
        const u = st.ui.insights;
        u.selectedId = id;
        const entry = store.data.history.get(id);
        if (entry && ((u.severity !== "all" && u.severity !== entry.insight.severity) || (u.category !== "all" && u.category !== entry.insight.category) || u.search)) {
          Object.assign(u, { severity: "all", category: "all", search: "" });
        }
        st.view = "insights";
      }, "view");
    },
    filterInsightsBy(text) {
      store.update((st) => {
        Object.assign(st.ui.insights, { search: text, severity: "all", category: "all" });
        st.view = "insights";
      }, "view");
    },
    showInsightInTimeline(insight) {
      const snap = store.data.snapshot;
      if (!snap) return;
      const ids = [...evidenceEventIds(insight)];
      const trace = insight.traceId ? snap.tracesById.get(insight.traceId) : null;
      let win = trace ? traceWindow(trace) : null;
      const m = insight.metadata || {};
      if (!win && isNum(m.timeWindowStart)) {
        const end = isNum(m.timeWindowEnd) ? m.timeWindowEnd : m.timeWindowStart + 100;
        win = traceWindow({ start: m.timeWindowStart, end });
      }
      if (!win && ids.length) {
        const evs = ids.map((id) => snap.eventsById.get(id)).filter(Boolean);
        if (evs.length) win = traceWindow({ start: Math.min(...evs.map((e) => e.timestamp)), end: Math.max(...evs.map(eventEnd)) });
      }
      store.update((st) => {
        Object.assign(st.ui.timeline, { traceId: trace ? trace.traceId : null, highlight: ids.length ? ids : null, window: win, fromInsightId: insight.id, selectedEventId: null });
        st.view = "timeline";
      }, "view");
    },
    showTraceInTimeline(traceId, highlight) {
      const t = store.data.snapshot?.tracesById.get(traceId);
      if (!t) return;
      store.update((st) => {
        Object.assign(st.ui.timeline, { traceId, highlight: highlight || null, window: traceWindow(t), fromInsightId: null, selectedEventId: highlight?.[0] ?? null });
        st.view = "timeline";
      }, "view");
    },
    openTrace(traceId) {
      store.update((st) => {
        st.ui.traces.selectedId = traceId;
        st.view = "traces";
      }, "view");
    },
    openBudgets: (anchor) => budgets.open(anchor),
  };

  const ctx = { store, actions, statusEmpty: () => statusEmpty(store) };
  const budgets = createBudgetsPopover(ctx);
  const siteAccess = createSiteAccess(ctx);
  ctx.siteAccess = siteAccess;

  // ── Shell ──

  const statusDot = h("span", { class: "status-dot", "aria-hidden": "true" });
  const statusText = h("span", { class: "status-text" });
  const modeBadge = h("button", { type: "button", class: "mode-badge", hidden: true, "aria-haspopup": "dialog", "aria-expanded": "false", onClick: (e) => siteAccess.openSettings(e.currentTarget) });
  const pageTitle = h("span", { class: "page-title ellipsis" });
  const pageMeta = h("span", { class: "page-meta caption ellipsis" });

  const tabs = VIEWS.map((v, i) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        id: `tab-${v.id}`,
        class: "segment",
        "aria-controls": `view-${v.id}`,
        title: `${v.label} (${i + 1})`,
        onClick: () => store.setView(v.id),
      },
      icon(v.icon, 14),
      h("span", { class: "segment-label", text: v.label }),
    ),
  );
  const tablist = h("nav", { class: "segmented seg-views", role: "tablist", "aria-label": "Views" }, tabs);
  tablist.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = VIEWS.findIndex((v) => v.id === store.state.view);
    const next = VIEWS[(idx + (e.key === "ArrowRight" ? 1 : VIEWS.length - 1)) % VIEWS.length];
    store.setView(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
    e.preventDefault();
  });

  const recordBtn = h("button", { type: "button", class: "pill-toggle record-toggle", onClick: toggleRecording });
  const clearBtn = h("button", { type: "button", class: "icon-btn", title: "Clear recorded data", "aria-label": "Clear", onClick: clearAll }, icon("trash"));
  const exportBtn = h("button", { type: "button", class: "icon-btn", title: "Export JSON bundle", "aria-label": "Export", onClick: exportBundle }, icon("export"));
  const fileInput = h("input", { type: "file", accept: "application/json,.json", hidden: true, onChange: (e) => importFile(e.target.files?.[0]) });
  const importBtn = h("button", { type: "button", class: "icon-btn", title: "Import JSON bundle", "aria-label": "Import", onClick: () => fileInput.click() }, icon("import"));
  const budgetsBtn = h("button", { type: "button", class: "icon-btn", title: "Performance budgets", "aria-label": "Budgets", "aria-haspopup": "dialog", "aria-expanded": "false", onClick: (e) => budgets.open(e.currentTarget) }, icon("gauge"));

  const header = h(
    "header",
    { class: "toolbar" },
    h(
      "div",
      { class: "tb-left" },
      h("div", { class: "status", role: "status", "aria-live": "polite" }, statusDot, statusText),
      modeBadge,
      h("div", { class: "page" }, pageTitle, pageMeta),
    ),
    tablist,
    h("div", { class: "tb-right" }, recordBtn, h("span", { class: "tb-sep", "aria-hidden": "true" }), clearBtn, exportBtn, importBtn, budgetsBtn, fileInput),
  );
  const banner = h("div", { class: "banner-host" });
  const viewInstances = Object.fromEntries(VIEWS.map((v) => [v.id, v.create(ctx)]));
  const main = h("main", { class: "views" });
  for (const v of VIEWS) {
    const view = viewInstances[v.id];
    view.el.id = `view-${v.id}`;
    view.el.setAttribute("role", "tabpanel");
    view.el.setAttribute("aria-labelledby", `tab-${v.id}`);
    main.appendChild(view.el);
  }
  const root = document.getElementById("app") || document.body;
  replaceChildren(root, header, banner, main);

  // ── Rendering ──

  const dirty = new Set(VIEWS.map((v) => v.id));

  function renderChrome() {
    const st = store.state;
    const data = store.data;
    const status = st.imported ? "imported" : st.status;
    statusDot.className = `status-dot st-${status}`;
    setText(statusText, st.imported ? "Imported" : STATUS_TEXT[st.status] || st.status);
    const hello = data.hello;
    const page = st.imported ? null : st.page;
    const limited = store.limited;
    const url = hello?.url || page?.href || "";
    const title = hello?.title || page?.title || (url ? shortUrl(url) : st.imported ? data.fileName : "Perf Intelligence");
    setText(pageTitle, title);
    pageTitle.title = url || title;
    const meta = [];
    if (url && title !== shortUrl(url)) meta.push(shortUrl(url, 60));
    const ver = hello?.engineVersion || data.snapshot?.engineVersion;
    if (limited) meta.push(ver && ver !== "devtools" ? `analyzer ${ver}` : "no analyzer bundle");
    else if (ver) meta.push(`engine ${ver}`);
    const sid = hello?.sessionId || data.snapshot?.sessionId;
    if (sid && !limited) meta.push(`session ${shortId(sid, 6)}`);
    if (data.legacy) meta.push("v1 protocol");
    setText(pageMeta, meta.join(" · "));
    pageMeta.title = meta.join(" · ");

    for (const v of VIEWS) {
      const tab = document.getElementById(`tab-${v.id}`);
      const on = st.view === v.id;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      viewInstances[v.id].el.hidden = !on;
    }

    const mode = store.mode;
    const modeMeta = MODE_META[mode];
    modeBadge.hidden = !modeMeta || !!st.imported;
    if (modeMeta) {
      modeBadge.className = `mode-badge mode-${mode}`;
      modeBadge.title = modeMeta.tip;
      modeBadge.setAttribute("aria-label", `${modeMeta.label}. Site settings`);
      if (modeBadge.dataset.mode !== mode) {
        modeBadge.dataset.mode = mode;
        replaceChildren(modeBadge, h("span", { class: "mode-dot", "aria-hidden": "true" }), h("span", { class: "mode-label", text: modeMeta.label }), icon("chevronDown", 10));
      }
    }

    const devtoolsOnly = mode === "devtools";
    const paused = devtoolsOnly ? layer.paused : !!store.state.live.snapshot?.paused;
    const live = !st.imported && (st.status === "recording" || st.status === "connected" || st.status === "paused");
    replaceChildren(recordBtn, icon(paused ? "record" : "pause", 14), h("span", { text: paused ? "Record" : "Pause" }));
    recordBtn.classList.toggle("is-paused", paused);
    recordBtn.setAttribute("aria-pressed", paused ? "false" : "true");
    recordBtn.title = paused ? "Resume recording (Space)" : "Pause recording (Space)";
    recordBtn.disabled = !live;
    clearBtn.disabled = !!st.imported || !(devtoolsOnly ? store.state.passive.snapshot : store.state.live.snapshot);
    exportBtn.disabled = !data.snapshot;
    budgetsBtn.disabled = !!st.imported || !live;

    renderBanner();
  }

  function renderBanner() {
    const st = store.state;
    let content = null;
    if (st.status === "invalidated") {
      content = h("div", { class: "banner banner-warn", role: "alert" }, icon("warning", 14), h("span", { text: "Extension was updated — close and reopen DevTools to reconnect." }));
    } else if (st.imported) {
      const d = st.imported;
      content = h(
        "div",
        { class: "banner banner-info" },
        icon("import", 14),
        ellipsis(`Viewing imported bundle ${d.fileName || ""}${d.exportedAt ? ` · exported ${formatClock(d.exportedAt)}` : ""} (read-only)`),
        h("span", { class: "spacer" }),
        h("button", { type: "button", class: "btn btn-small", onClick: () => store.clearImported(), text: "Return to live" }),
      );
    } else if (st.notice) {
      content = h("div", { class: `banner banner-${st.notice.tone || "info"}`, role: "status" }, icon(st.notice.tone === "error" ? "warning" : "info", 14), ellipsis(st.notice.text), h("span", { class: "spacer" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Dismiss", onClick: () => store.update((s) => (s.notice = null), "status") }, icon("close", 12)));
    } else {
      content = siteAccess.limitedBanner();
    }
    const inj = st.injection;
    const key = content ? `${content.textContent}|${inj.origin}|${inj.pending}` : "";
    if (banner.dataset.key !== key) {
      banner.dataset.key = key;
      replaceChildren(banner, content);
    }
  }

  function renderActive(topic) {
    const id = store.state.view;
    for (const v of VIEWS) if (v.id !== id && (topic === "data" || topic === "status")) dirty.add(v.id);
    viewInstances[id].render(topic);
    dirty.delete(id);
  }

  store.subscribe((topic) => {
    if (topic === "vitals") {
      // Only the Overview shows Web Vitals.
      if (store.state.view === "overview") viewInstances.overview.render("vitals");
      else dirty.add("overview");
      return;
    }
    renderChrome();
    if (topic === "status") siteAccess.renderSettings();
    if (topic === "view") {
      renderActive(dirty.has(store.state.view) ? "data" : "view");
      budgets.close();
      siteAccess.closeSettings();
      return;
    }
    if (topic === "tick") {
      if (store.state.view === "insights") viewInstances.insights.render("tick");
      return;
    }
    renderActive(topic);
  });

  // ── Toolbar actions ──

  function toggleRecording() {
    if (store.readOnly) return;
    if (store.mode === "devtools") {
      passiveCommand(layer.paused ? "RESUME" : "PAUSE");
      store.emit("status");
      return;
    }
    const snap = store.state.live.snapshot;
    if (!snap) return;
    const paused = !snap.paused;
    actions.command(paused ? "PAUSE" : "RESUME");
    snap.paused = paused; // optimistic; the next SNAPSHOT is authoritative
    conn.command("REQUEST_SNAPSHOT");
    recomputeStatus();
    store.emit("status");
  }

  function clearAll() {
    if (store.readOnly) return;
    if (store.mode === "devtools") return void passiveCommand("CLEAR");
    actions.command("CLEAR");
    store.resetLive({ keepHello: true });
  }

  function exportBundle() {
    const data = store.data;
    if (!data.snapshot) return;
    const { eventsById, tracesById, insightsByTrace, ...snapshot } = data.snapshot;
    const bundle = {
      format: EXPORT_FORMAT,
      version: 2,
      exportedAt: Date.now(),
      hello: data.hello,
      snapshot,
      insightHistory: [...data.history.values()].map(({ insight, firstSeen, lastSeen, occurrences }) => ({ insight, firstSeen, lastSeen, occurrences })),
      mode: store.dataMode,
      vitals: store.vitals,
      // Last accessibility audit: the live one, or the imported bundle's when re-exporting it.
      a11y: store.readOnly ? store.state.imported.a11y || null : viewInstances.accessibility.getReport(),
    };
    let host = "page";
    try {
      host = new URL(data.hello?.url || store.state.page?.href || "").host || "page";
    } catch {
      /* keep default */
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadJson(`perf-engine-${host.replace(/[^\w.-]/g, "_")}-${stamp}.json`, bundle);
  }

  async function importFile(file) {
    fileInput.value = "";
    if (!file) return;
    const fail = (text) => store.update((s) => (s.notice = { tone: "error", text }), "status");
    if (file.size > MAX_IMPORT_BYTES) return fail(`${file.name} is too large to import (max 25 MB).`);
    try {
      const bundle = validateBundle(JSON.parse(await file.text()));
      if (!bundle) return fail(`${file.name} is not a Perf Intelligence export.`);
      store.state.notice = null;
      store.setImported(bundle, file.name.slice(0, 120));
    } catch {
      fail(`Could not read ${file.name} — invalid JSON.`);
    }
  }

  // ── Keyboard ──

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const active = viewInstances[store.state.view];
    if (e.key === "Escape") {
      if (budgets.isOpen) return budgets.close();
      if (siteAccess.isOpen) return siteAccess.closeAll();
      if (!isTypingTarget(e.target)) active.clearSearch?.();
      return;
    }
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      active.focusSearch?.();
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= VIEWS.length) {
      e.preventDefault();
      store.setView(VIEWS[Number(e.key) - 1].id);
    } else if (e.key === " " || e.code === "Space") {
      const t = e.target;
      if (t instanceof Element && t.closest("button, a, [role=option], tr[tabindex]")) return; // native activation
      e.preventDefault();
      toggleRecording();
    }
  });

  // ── Timers & navigation ──

  setInterval(() => {
    if (!store.state.imported) recomputeStatus();
  }, 1000);
  setInterval(() => store.emit("tick"), 5000);

  try {
    chrome.devtools?.network?.onNavigated?.addListener(() => onNavigated());
  } catch {
    /* not available in preview */
  }

  renderChrome();
  renderActive("data");
  layer.start();
  refreshOrigin();
  if (!contextValid()) store.setStatus("invalidated");
  else conn.connect();
}

function statusEmpty(store) {
  const st = store.state.status;
  if (st === "invalidated") return emptyState({ iconName: "warning", title: "Extension was updated", body: "Close and reopen DevTools to reconnect." });
  if (store.mode === "devtools") {
    return h("div", { class: "empty", role: "status" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "empty-title", text: "Collecting DevTools data…" }), h("p", { class: "empty-body", text: "No engine on this page — reading network, long tasks, interactions and Web Vitals from DevTools." }));
  }
  if (st === "disconnected") return emptyState({ iconName: "refresh", title: "Disconnected", body: "Reconnecting to the extension…" });
  if (st === "navigated") return emptyState({ iconName: "refresh", title: "Page navigated — waiting for engine", body: "Data from the previous page was cleared." });
  if (st === "connected" || st === "recording" || st === "paused") return emptyState({ iconName: "bolt", title: "Engine connected", body: "Waiting for the first snapshot…" });
  return h("div", { class: "empty", role: "status" }, h("div", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "empty-title", text: "Waiting for engine…" }), h("p", { class: "empty-body", text: "Looking for a perf engine on the inspected page. Without one, the panel switches to DevTools-only data." }));
}

boot();
