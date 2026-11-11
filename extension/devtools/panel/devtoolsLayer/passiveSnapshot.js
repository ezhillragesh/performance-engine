// Synthetic PerfSnapshot for DevTools-only mode, built with the bundled analyzer
// (extension/vendor/perf-analyzer.mjs, generated from core). Pure apart from loadAnalyzer().

export const PASSIVE_SESSION_ID = "devtools";
export const PASSIVE_EVENT_CAP = 1500;
export const PASSIVE_TRACE_CAP = 100;

const REQUIRED = ["analyzeEvents", "buildAnalysisContext", "computeSummary", "buildTraceSummaries", "resolveBudgets", "sanitizeUrl"];

let analyzerPromise = null;

/**
 * Dynamically imports the analyzer bundle once. Resolves to the module, or null when the file is
 * missing / broken, so the panel keeps working (passive data without insights).
 */
export function loadAnalyzer(url = new URL("../../../vendor/perf-analyzer.mjs", import.meta.url).href) {
  if (!analyzerPromise) {
    analyzerPromise = import(url)
      .then((mod) => (REQUIRED.every((k) => typeof mod[k] === "function") ? mod : null))
      .catch((err) => {
        console.warn("[perf-devtools] analyzer bundle unavailable; showing passive data without insights", err?.message || err);
        return null;
      });
  }
  return analyzerPromise;
}

/**
 * @param analyzer  analyzer module or null
 * @param input     { events, budgets, timeOrigin, capturedAt, paused, droppedEvents }
 * @returns PerfSnapshot (not yet validated; run through validateSnapshot before display)
 */
export function buildPassiveSnapshot(analyzer, { events = [], budgets = null, timeOrigin = null, capturedAt = 0, paused = false, droppedEvents = 0 } = {}) {
  let sorted = events.slice().sort((a, b) => a.timestamp - b.timestamp);
  let dropped = droppedEvents;
  if (sorted.length > PASSIVE_EVENT_CAP) {
    dropped += sorted.length - PASSIVE_EVENT_CAP;
    sorted = sorted.slice(sorted.length - PASSIVE_EVENT_CAP);
  }
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const snapshot = {
    sessionId: PASSIVE_SESSION_ID,
    engineVersion: analyzer && typeof analyzer.ENGINE_VERSION === "string" ? analyzer.ENGINE_VERSION : "devtools",
    capturedAt: Math.max(capturedAt || 0, last ? last.timestamp : 0),
    timeOrigin,
    paused,
    insights: [],
    events: sorted,
    droppedEvents: dropped,
    traces: [],
    summary: null, // the panel derives one (derive.js) when the analyzer is unavailable
    budgets: budgets ? { ...budgets } : null,
  };
  if (!analyzer) return snapshot;
  try {
    const b = analyzer.resolveBudgets(budgets || undefined);
    const insights = analyzer.analyzeEvents(sorted, { budgets: b });
    const context = analyzer.buildAnalysisContext(sorted);
    snapshot.insights = insights;
    const summary = analyzer.computeSummary(context, insights, b);
    // core counts `interactions` as traces, which never exist without UI events; report the
    // browser-measured interactions (distinct interactionId) the p75 is computed from instead.
    if (summary && !summary.interactions) summary.interactions = countInteractions(sorted);
    snapshot.summary = summary;
    snapshot.traces = analyzer.buildTraceSummaries(context, insights, PASSIVE_TRACE_CAP);
    snapshot.budgets = b;
  } catch (err) {
    console.warn("[perf-devtools] passive analysis failed", err);
  }
  return snapshot;
}

function countInteractions(events) {
  const ids = new Set();
  let anonymous = 0;
  for (const e of events) {
    if (e.type !== "interaction") continue;
    if (e.interactionId > 0) ids.add(e.interactionId);
    else anonymous += 1;
  }
  return ids.size || anonymous; // id-less entries only count when the browser assigns no ids
}
