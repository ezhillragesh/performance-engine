// Pure derivations over validated data. No DOM — safe to import from Node.
import { percentile, safeMax, safeMin, severityRank, gradeFromScore, isNum } from "./format.js";

export const DEFAULT_BUDGETS = {
  interactionLatencyMs: 200,
  longTaskMs: 50,
  componentRenderMs: 16,
  rendersPerInteraction: 25,
  networkRequestMs: 1000,
  wastedRenderPct: 30,
};

export const BUDGET_META = {
  interactionLatencyMs: { label: "Interaction latency (p75)", unit: "ms" },
  longTaskMs: { label: "Longest main-thread task", unit: "ms" },
  componentRenderMs: { label: "Slowest component render", unit: "ms" },
  rendersPerInteraction: { label: "Renders per interaction", unit: "count" },
  networkRequestMs: { label: "Slowest network request", unit: "ms" },
  wastedRenderPct: { label: "Wasted render share", unit: "%" },
};

/** Same rule as core: requests the app aborted itself are not failures. */
export function isFailedRequest(e) {
  if (e.type !== "network" || e.error === "aborted") return false;
  return e.status === 0 || e.status >= 400 || !!e.error;
}

/**
 * Self time of a render (core `renderCost`): `durationMs` is React's
 * actualDuration and includes children, so summing it double counts.
 */
export function renderCost(e) {
  if (e.durationMs > 0 && isNum(e.selfDurationMs)) return Math.min(e.selfDurationMs, e.durationMs);
  return e.durationMs;
}

/** Longest blocking task in a long-task event (core `taskLengthMs`); 0 = a long frame that never blocked. */
export function taskLengthMs(e) {
  if (e.api !== "long-animation-frame") return e.duration;
  if (!(e.blockingDuration > 0)) return 0;
  return Math.min(e.duration, e.blockingDuration + 50);
}

export function componentStats(events) {
  const map = new Map();
  for (const e of events) {
    if (e.type !== "render") continue;
    let s = map.get(e.componentName);
    if (!s) {
      s = { name: e.componentName, renders: 0, mounts: 0, wasted: 0, totalMs: 0, maxMs: 0, avgMs: 0 };
      map.set(e.componentName, s);
    }
    s.renders++;
    if (e.phase === "mount") s.mounts++;
    if (e.wasted) s.wasted++;
    const cost = renderCost(e);
    s.totalMs += cost;
    if (cost > s.maxMs) s.maxMs = cost;
  }
  const out = [...map.values()];
  for (const s of out) s.avgMs = s.renders ? s.totalMs / s.renders : 0;
  return out.sort((a, b) => b.totalMs - a.totalMs);
}

export function requestStats(events) {
  const map = new Map();
  for (const e of events) {
    if (e.type !== "network") continue;
    const key = `${e.method} ${e.url.split("?")[0]}`;
    let s = map.get(key);
    if (!s) {
      s = { url: e.url.split("?")[0], method: e.method, count: 0, avgMs: 0, maxMs: 0, errors: 0, _total: 0 };
      map.set(key, s);
    }
    s.count++;
    s._total += e.duration;
    if (e.duration > s.maxMs) s.maxMs = e.duration;
    if (isFailedRequest(e)) s.errors++;
  }
  return [...map.values()]
    .map(({ _total, ...s }) => ({ ...s, avgMs: s.count ? _total / s.count : 0 }))
    .sort((a, b) => b.maxMs - a.maxMs);
}

/** Merge engine-provided component stats with stats computed from events (engine wins on overlap). */
export function mergeComponentStats(fromSummary, events) {
  const computed = componentStats(events);
  if (!fromSummary || fromSummary.length === 0) return computed;
  const names = new Set(fromSummary.map((c) => c.name));
  return [...fromSummary, ...computed.filter((c) => !names.has(c.name))];
}

function budgetResult(key, limit, values, actualOverride) {
  const meta = BUDGET_META[key];
  const samples = values.length;
  const actual = actualOverride !== undefined ? actualOverride : samples ? safeMax(values) : null;
  const violations = values.filter((v) => v > limit).length;
  let status = "no-data";
  if (actual !== null && actual !== undefined) {
    status = actual > limit ? "fail" : actual > limit * 0.8 ? "warn" : "pass";
  }
  return { key, label: meta.label, limit, actual: actual ?? null, unit: meta.unit, status, samples, violations };
}

/**
 * Fallback SessionSummary for legacy v1 data or snapshots without a summary.
 * Recomputed on every data update so it never goes stale.
 */
export function deriveSummary(events, insights, budgets, traces = []) {
  const b = { ...DEFAULT_BUDGETS, ...(budgets || {}) };
  const interactions = events.filter((e) => e.type === "interaction");
  const renders = events.filter((e) => e.type === "render");
  const longTasks = events.filter((e) => e.type === "longtask");
  const network = events.filter((e) => e.type === "network");
  const latencies = interactions.map((e) => e.duration);
  const wasted = renders.filter((e) => e.wasted).length;
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of insights) counts[i.severity] = (counts[i.severity] || 0) + 1;

  const rendersPerTrace = traces.map((t) => t.renderCount);
  const budgetsOut = [
    budgetResult("interactionLatencyMs", b.interactionLatencyMs, latencies, percentile(latencies, 75)),
    budgetResult("longTaskMs", b.longTaskMs, longTasks.map(taskLengthMs).filter((ms) => ms > 0)),
    budgetResult("componentRenderMs", b.componentRenderMs, renders.map(renderCost).filter((ms) => ms > 0)),
    budgetResult("rendersPerInteraction", b.rendersPerInteraction, rendersPerTrace),
    budgetResult("networkRequestMs", b.networkRequestMs, network.map((e) => e.duration)),
    budgetResult(
      "wastedRenderPct",
      b.wastedRenderPct,
      renders.length ? [(wasted / renders.length) * 100] : [],
    ),
  ];

  const failedBudgets = budgetsOut.filter((r) => r.status === "fail").length;
  const penalty = counts.critical * 20 + counts.high * 10 + counts.medium * 4 + counts.low * 1 + failedBudgets * 8;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    score,
    grade: gradeFromScore(score),
    interactionP75Ms: percentile(latencies, 75),
    interactionMaxMs: safeMax(latencies),
    interactions: interactions.length,
    renders: renders.length,
    wastedRenders: wasted,
    longTasks: longTasks.length,
    totalBlockingMs: longTasks.reduce((acc, e) => acc + e.blockingDuration, 0),
    requests: network.length,
    failedRequests: network.filter(isFailedRequest).length,
    insightCounts: counts,
    budgets: budgetsOut,
    topComponents: componentStats(events).slice(0, 10),
    topRequests: requestStats(events).slice(0, 10),
  };
}

/** Fill gaps in an engine summary (missing grade/score) without discarding engine values. */
export function completeSummary(summary, events, insights, budgets, traces) {
  if (!summary) return deriveSummary(events, insights, budgets, traces);
  const derived = deriveSummary(events, insights, budgets, traces);
  const score = summary.score ?? derived.score;
  return {
    ...summary,
    score,
    grade: summary.grade || gradeFromScore(score),
    budgets: summary.budgets.length ? summary.budgets : derived.budgets,
    topComponents: summary.topComponents.length ? summary.topComponents : derived.topComponents,
    topRequests: summary.topRequests.length ? summary.topRequests : derived.topRequests,
  };
}

export function eventEnd(e) {
  switch (e.type) {
    case "network":
      return isNum(e.endTime) ? e.endTime : e.timestamp + e.duration;
    case "longtask":
    case "interaction":
      return e.timestamp + e.duration;
    case "render":
      return e.timestamp + e.durationMs;
    default:
      return e.timestamp;
  }
}

export function timeDomain(events, traces = []) {
  const start = safeMin([...events.map((e) => e.timestamp), ...traces.map((t) => t.start)]);
  const end = safeMax([...events.map(eventEnd), ...traces.map((t) => t.end)]);
  if (start === null || end === null) return null;
  return end > start ? [start, end] : [start, start + 1000];
}

/** Events-per-bucket series for a sparkline. Returns [] for no events. */
export function activitySeries(events, buckets = 60) {
  const domain = timeDomain(events);
  if (!domain) return [];
  const [start, end] = domain;
  const size = (end - start) / buckets || 1;
  const out = new Array(buckets).fill(0);
  for (const e of events) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((e.timestamp - start) / size)));
    out[idx]++;
  }
  const perSecond = 1000 / size;
  return out.map((n) => n * perSecond);
}

/** Depth-first ordered span tree: [{ span, depth }]. Orphans/cycles are attached to the root. */
export function flattenSpanTree(spans) {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const children = new Map();
  const roots = [];
  for (const s of spans) {
    if (s.parentId && byId.has(s.parentId) && s.parentId !== s.id) {
      if (!children.has(s.parentId)) children.set(s.parentId, []);
      children.get(s.parentId).push(s);
    } else {
      roots.push(s);
    }
  }
  const out = [];
  const visited = new Set();
  const walk = (s, depth) => {
    if (visited.has(s.id) || out.length > 2000) return;
    visited.add(s.id);
    out.push({ span: s, depth });
    const kids = (children.get(s.id) || []).slice().sort((a, b) => a.start - b.start);
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots.slice().sort((a, b) => a.start - b.start)) walk(r, 0);
  // Anything unreached (cycles) goes at depth 0.
  for (const s of spans) if (!visited.has(s.id)) walk(s, 0);
  return out;
}

export function insightSignature(i) {
  const m = i.metadata || {};
  return `${i.message}|${m.timeWindowStart ?? ""}|${m.timeWindowEnd ?? ""}|${i.traceId ?? ""}`;
}

/**
 * Accumulates insights across snapshots keyed by insight.id.
 * An "occurrence" is counted when an id first appears, reappears after being absent,
 * or its signature changes (the rule fired again on new data).
 * Returns a new Map; the input map is not mutated.
 */
export function mergeHistory(history, insights, nowWall) {
  const next = new Map();
  const present = new Set();
  for (const insight of insights) {
    present.add(insight.id);
    const prev = history.get(insight.id);
    const sig = insightSignature(insight);
    if (!prev) {
      next.set(insight.id, { insight, firstSeen: nowWall, lastSeen: nowWall, occurrences: 1, present: true, sig });
    } else {
      const again = !prev.present || prev.sig !== sig;
      next.set(insight.id, {
        insight,
        firstSeen: prev.firstSeen,
        lastSeen: again || prev.present ? nowWall : prev.lastSeen,
        occurrences: prev.occurrences + (again ? 1 : 0),
        present: true,
        sig,
      });
    }
  }
  for (const [id, entry] of history) {
    if (!present.has(id)) next.set(id, { ...entry, present: false });
  }
  // Bound history size: drop the oldest absent entries first.
  if (next.size > 1000) {
    const absent = [...next.values()].filter((e) => !e.present).sort((a, b) => a.lastSeen - b.lastSeen);
    for (const e of absent.slice(0, next.size - 1000)) next.delete(e.insight.id);
  }
  return next;
}

export const INSIGHT_SORTS = {
  severity: (a, b) =>
    severityRank(a.insight.severity) - severityRank(b.insight.severity) ||
    b.insight.impact.estimatedDelayMs - a.insight.impact.estimatedDelayMs,
  impact: (a, b) => b.insight.impact.estimatedDelayMs - a.insight.impact.estimatedDelayMs,
  confidence: (a, b) => b.insight.confidence - a.insight.confidence,
  recent: (a, b) =>
    b.lastSeen - a.lastSeen ||
    (b.insight.metadata?.timeWindowEnd ?? 0) - (a.insight.metadata?.timeWindowEnd ?? 0),
};

/** Filters + sorts history entries. Never mutates inputs. */
export function filterInsights(entries, { severity = "all", category = "all", search = "", sort = "severity" }) {
  const q = search.trim().toLowerCase();
  const out = entries.filter((e) => {
    const i = e.insight;
    if (severity !== "all" && i.severity !== severity) return false;
    if (category !== "all" && i.category !== category) return false;
    if (!q) return true;
    const hay = [
      i.issueType,
      i.source,
      i.message,
      i.cause,
      i.metadata?.rootComponent,
      ...(i.metadata?.affectedComponents || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q) || hay.replace(/-/g, " ").includes(q);
  });
  return out.slice().sort(INSIGHT_SORTS[sort] || INSIGHT_SORTS.severity);
}

export function evidenceEventIds(insight) {
  const ids = new Set();
  for (const ev of insight.evidence) for (const id of ev.eventIds || []) ids.add(id);
  return ids;
}

/** Greedy interval packing into rows. Returns row index per item (same order). */
export function packRows(items, getStart, getEnd, maxRows = 8, gap = 0) {
  const rowEnds = [];
  return items.map((it) => {
    const s = getStart(it);
    let row = rowEnds.findIndex((end) => end + gap <= s);
    if (row === -1) {
      if (rowEnds.length < maxRows) {
        row = rowEnds.length;
        rowEnds.push(0);
      } else {
        // Overflow: put in the row that frees earliest.
        row = rowEnds.indexOf(Math.min(...rowEnds));
      }
    }
    rowEnds[row] = Math.max(rowEnds[row], getEnd(it));
    return row;
  });
}

/**
 * True when renders were recorded but none carries a duration: React production builds call the
 * DevTools hook (so renders, wasted renders and component names are seen) but don't measure
 * render time. Component names are usually minified there too.
 */
export function renderTimingMissing(events) {
  let renders = 0;
  for (const e of events) {
    if (e.type !== "render") continue;
    renders += 1;
    if (e.durationMs > 0 || e.selfDurationMs > 0) return false;
  }
  return renders >= 5;
}
