// Central store. Views read `store.state` and subscribe to change topics.
import { mergeHistory, completeSummary, DEFAULT_BUDGETS } from "./derive.js";

function emptyData() {
  return {
    hello: null,
    snapshot: null,
    history: new Map(),
    receivedAt: 0, // Date.now() when the last snapshot arrived
    legacy: false,
  };
}

function initialUi() {
  return {
    insights: { selectedId: null, severity: "all", category: "all", search: "", sort: "severity" },
    timeline: { traceId: null, highlight: null, window: null, selectedEventId: null, fromInsightId: null },
    traces: { selectedId: null, sort: { key: "start", dir: "desc" } },
    components: { sort: { key: "totalMs", dir: "desc" }, search: "" },
    network: { sort: { key: "timestamp", dir: "desc" }, search: "", failedOnly: false, selectedId: null },
  };
}

export function createStore() {
  const listeners = new Set();
  const state = {
    status: "waiting", // waiting | devtools | connected | recording | paused | disconnected | invalidated | navigated
    view: "overview",
    live: emptyData(), // engine data (app or injected engine)
    passive: emptyData(), // DevTools-only layer data (synthetic snapshot, sessionId "devtools")
    devtoolsFallback: false, // PING went unanswered: no engine, show the DevTools-only layer
    imported: null, // { ...emptyData(), fileName, vitals, mode, a11y }
    vitals: null, // Web Vitals from the page collector (every mode)
    page: null, // { origin, href, title } from the page collector
    injection: { origin: null, enabled: false, granted: false, known: false, pending: null, message: null },
    ui: initialUi(),
    notice: null, // transient banner text
    limitedBannerDismissed: false,
  };

  const hasEngine = () => !!(state.live.hello || state.live.snapshot);

  const store = {
    state,
    /** Data currently displayed: imported bundle, else engine data, else the DevTools-only layer. */
    get data() {
      if (state.imported) return state.imported;
      if (!hasEngine() && state.devtoolsFallback && state.passive.snapshot) return state.passive;
      return state.live;
    },
    get hasEngine() {
      return hasEngine();
    },
    /** "app" | "injected" | "devtools" | "imported" | null (still detecting). */
    get mode() {
      if (state.imported) return "imported";
      if (state.live.hello) return state.live.hello.config?.mode === "injected" ? "injected" : "app";
      if (state.live.snapshot) return "app";
      if (state.devtoolsFallback) return "devtools";
      return null;
    },
    /** Mode that produced the displayed data (an imported bundle keeps its original mode). */
    get dataMode() {
      if (!state.imported) return store.mode;
      const d = state.imported;
      if (d.mode) return d.mode;
      if (d.snapshot?.sessionId === "devtools") return "devtools";
      return d.hello?.config?.mode === "injected" ? "injected" : "app";
    },
    /** True when the displayed data comes from DevTools APIs only (no renders / causal traces). */
    get limited() {
      return store.dataMode === "devtools";
    },
    /** Vitals for the displayed data. */
    get vitals() {
      return state.imported ? state.imported.vitals || null : state.vitals;
    },
    get readOnly() {
      return !!state.imported;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(topic) {
      for (const fn of listeners) {
        try {
          fn(topic, state);
        } catch (err) {
          console.error("[perf-devtools] render error", err);
        }
      }
    },
    update(mutator, topic = "ui") {
      mutator(state);
      store.emit(topic);
    },

    // ── Live data mutations ──
    setHello(hello) {
      const live = state.live;
      if (live.hello && live.hello.sessionId !== hello.sessionId) {
        state.live = emptyData();
        resetSelections(state);
      }
      state.live.hello = hello;
      store.emit("data");
    },
    setSnapshot(snapshot) {
      let live = state.live;
      if (live.snapshot && live.snapshot.sessionId !== snapshot.sessionId) {
        state.live = live = { ...emptyData(), hello: live.hello?.sessionId === snapshot.sessionId ? live.hello : null };
        resetSelections(state);
      }
      live.snapshot = normalizeSnapshot(snapshot);
      live.history = mergeHistory(live.history, live.snapshot.insights, Date.now());
      live.receivedAt = Date.now();
      live.legacy = false;
      store.emit("data");
    },
    /** v1 compatibility: INSIGHTS_UPDATE / EVENTS_UPDATE carry a single array each. */
    setLegacy(kind, items) {
      const live = state.live;
      const prev = live.snapshot || {
        sessionId: "legacy",
        engineVersion: "v1",
        capturedAt: 0,
        timeOrigin: null,
        paused: false,
        insights: [],
        events: [],
        droppedEvents: 0,
        traces: [],
        summary: null,
        budgets: null,
      };
      const next = { ...prev, summary: null };
      if (kind === "insights") next.insights = items;
      else next.events = items;
      next.capturedAt = Math.max(prev.capturedAt, ...next.events.slice(-1).map((e) => e.timestamp));
      live.snapshot = normalizeSnapshot(next);
      if (kind === "insights") live.history = mergeHistory(live.history, items, Date.now());
      live.receivedAt = Date.now();
      live.legacy = true;
      store.emit("data");
    },
    setPassiveSnapshot(snapshot) {
      const p = state.passive;
      p.snapshot = normalizeSnapshot(snapshot);
      p.history = mergeHistory(p.history, p.snapshot.insights, Date.now());
      p.receivedAt = Date.now();
      store.emit("data");
    },
    resetPassive() {
      state.passive = emptyData();
      if (!hasEngine() && !state.imported) resetSelections(state);
      store.emit("data");
    },
    setDevtoolsFallback(on) {
      if (state.devtoolsFallback === on) return;
      state.devtoolsFallback = on;
      store.emit("data");
    },
    setVitals(vitals) {
      const key = JSON.stringify(vitals);
      if (key === state._vitalsKey) return;
      state._vitalsKey = key;
      state.vitals = vitals;
      store.emit("vitals");
    },
    setPage(page) {
      state.page = page;
      store.emit("status");
    },
    setInjection(patch) {
      Object.assign(state.injection, patch);
      store.emit("status");
    },
    resetLive({ keepHello = false } = {}) {
      const hello = state.live.hello;
      state.live = emptyData();
      if (keepHello) state.live.hello = hello;
      resetSelections(state);
      store.emit("data");
    },
    setImported(bundle, fileName) {
      const data = emptyData();
      data.hello = bundle.hello;
      data.snapshot = normalizeSnapshot(bundle.snapshot);
      const history = new Map();
      for (const e of bundle.insightHistory) history.set(e.insight.id, { ...e, present: false, sig: "" });
      data.history = mergeHistory(history, data.snapshot.insights, bundle.exportedAt || Date.now());
      data.receivedAt = bundle.exportedAt || Date.now();
      data.fileName = fileName;
      data.exportedAt = bundle.exportedAt;
      data.vitals = bundle.vitals || null;
      data.mode = bundle.mode || null;
      data.a11y = bundle.a11y || null; // Accessibility view's imported audit (read-only)
      state.imported = data;
      resetSelections(state);
      store.emit("data");
    },
    clearImported() {
      state.imported = null;
      resetSelections(state);
      store.emit("data");
    },
    setStatus(status) {
      if (state.status === status) return;
      state.status = status;
      store.emit("status");
    },
    setView(view) {
      if (state.view === view) return;
      state.view = view;
      store.emit("view");
    },
    /** Page-relative "now" for the displayed data (for "12s ago" labels). */
    pageNow() {
      const d = store.data;
      if (!d.snapshot) return null;
      if (state.imported) return d.snapshot.capturedAt;
      return d.snapshot.capturedAt + (Date.now() - d.receivedAt);
    },
    budgets() {
      return { ...DEFAULT_BUDGETS, ...(store.data.snapshot?.budgets || {}) };
    },
  };
  return store;
}

function resetSelections(state) {
  const prevView = state.ui;
  state.ui = initialUi();
  // Keep user-chosen filters/sorts; drop selections that referenced old data.
  state.ui.insights = { ...prevView.insights, selectedId: null };
  state.ui.traces.sort = prevView.traces.sort;
  state.ui.components.sort = prevView.components.sort;
  state.ui.network = { ...prevView.network, selectedId: null };
}

/** Ensures a snapshot has a fresh, complete summary and lookup indexes. */
function normalizeSnapshot(snap) {
  const summary = completeSummary(snap.summary, snap.events, snap.insights, snap.budgets, snap.traces);
  const eventsById = new Map(snap.events.map((e) => [e.eventId, e]));
  const tracesById = new Map(snap.traces.map((t) => [t.traceId, t]));
  const insightsByTrace = new Map();
  for (const i of snap.insights) {
    if (!i.traceId) continue;
    if (!insightsByTrace.has(i.traceId)) insightsByTrace.set(i.traceId, []);
    insightsByTrace.get(i.traceId).push(i);
  }
  for (const t of snap.traces) {
    for (const id of t.insightIds) {
      const ins = snap.insights.find((x) => x.id === id);
      if (!ins) continue;
      const arr = insightsByTrace.get(t.traceId) || [];
      if (!arr.includes(ins)) arr.push(ins);
      insightsByTrace.set(t.traceId, arr);
    }
  }
  return { ...snap, summary, eventsById, tracesById, insightsByTrace };
}
