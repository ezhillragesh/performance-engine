// Validation of untrusted page-provided payloads. Pure (no DOM) — safe to import from Node.
// Every function returns a sanitized copy or null; malformed items are dropped, never thrown.
import { validateReport } from "./views/accessibility.js";
import { validateVitals } from "./devtoolsLayer/collector.js";

export { validateVitals };

export const LIMITS = {
  str: 500,
  events: 2000,
  insights: 500,
  traces: 200,
  spans: 500,
  evidence: 50,
  ids: 500,
  components: 200,
  requests: 200,
  budgets: 20,
  scripts: 20,
};

const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const CATEGORIES = new Set(["rendering", "network", "main-thread", "interaction", "budget"]);
const EVIDENCE_KINDS = new Set(["measurement", "correlation", "budget", "heuristic"]);
const UNITS = new Set(["ms", "count", "%"]);
const SPAN_KINDS = new Set(["interaction", "longtask", "network", "render", "commit"]);
const BUDGET_STATUS = new Set(["pass", "warn", "fail", "no-data"]);
const GRADES = new Set(["good", "needs-improvement", "poor"]);
export const BUDGET_KEYS = [
  "interactionLatencyMs",
  "longTaskMs",
  "componentRenderMs",
  "rendersPerInteraction",
  "networkRequestMs",
  "wastedRenderPct",
];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const nonNeg = (v) => {
  const n = num(v);
  return n === undefined ? undefined : Math.max(0, n);
};
const bool = (v) => (typeof v === "boolean" ? v : undefined);

export function str(v, max = LIMITS.str) {
  if (typeof v !== "string") return undefined;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function strOr(v, fallback) {
  const s = str(v);
  return s === undefined || s === "" ? fallback : s;
}

function strArray(v, cap = LIMITS.ids) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (out.length >= cap) break;
    const s = str(item);
    if (s !== undefined) out.push(s);
  }
  return out;
}

/**
 * Map + cap an array, dropping items the mapper rejects (returns null). Reports truncation.
 * `keep: "tail"` keeps the most recent `cap` items (chronological arrays: events, traces);
 * `keep: "head"` keeps the first ones (ranked arrays such as insights, which the engine sorts
 * most severe first, and trace spans, whose first entry is the root interaction span).
 */
function list(v, mapper, cap, keep = "tail") {
  if (!Array.isArray(v)) return { items: [], dropped: 0, truncated: 0 };
  const items = [];
  let dropped = 0;
  const start = keep === "head" ? 0 : Math.max(0, v.length - cap);
  const end = keep === "head" ? Math.min(v.length, cap) : v.length;
  for (let i = start; i < end; i++) {
    let item = null;
    try {
      item = mapper(v[i]);
    } catch {
      item = null;
    }
    if (item) items.push(item);
    else dropped++;
  }
  return { items, dropped, truncated: v.length - (end - start) };
}

// ── Events ───────────────────────────────────────────────────────────

export function validateEvent(raw) {
  if (!isObj(raw)) return null;
  const timestamp = num(raw.timestamp);
  const eventId = str(raw.eventId, 120);
  if (timestamp === undefined || !eventId) return null;
  const base = { timestamp, eventId, traceId: str(raw.traceId, 120), sessionId: str(raw.sessionId, 120) || "" };

  switch (raw.type) {
    case "ui":
      return {
        ...base,
        type: "ui",
        eventType: strOr(raw.eventType, "event"),
        target: strOr(raw.target, "unknown"),
        label: str(raw.label),
        domTimestamp: num(raw.domTimestamp),
        startsTrace: bool(raw.startsTrace),
      };
    case "render":
      return {
        ...base,
        type: "render",
        componentName: strOr(raw.componentName, "Anonymous"),
        instanceId: str(raw.instanceId, 120),
        durationMs: nonNeg(raw.durationMs) ?? 0,
        selfDurationMs: nonNeg(raw.selfDurationMs),
        commitTime: num(raw.commitTime),
        phase: str(raw.phase, 20),
        source: str(raw.source, 20),
        commitId: num(raw.commitId),
        parentComponent: str(raw.parentComponent),
        changedProps: strArray(raw.changedProps, 50),
        stateChanged: bool(raw.stateChanged),
        contextChanged: bool(raw.contextChanged),
        wasted: bool(raw.wasted),
      };
    case "network": {
      const duration = nonNeg(raw.duration) ?? 0;
      return {
        ...base,
        type: "network",
        url: strOr(raw.url, "(unknown)"),
        method: strOr(raw.method, "GET").toUpperCase().slice(0, 10),
        duration,
        endTime: num(raw.endTime) ?? timestamp + duration,
        status: num(raw.status) ?? 0,
        fromCache: raw.fromCache === true,
        responseSize: nonNeg(raw.responseSize),
        initiator: raw.initiator === "xhr" ? "xhr" : raw.initiator === "fetch" ? "fetch" : undefined,
        error: str(raw.error),
      };
    }
    case "longtask": {
      const duration = nonNeg(raw.duration) ?? 0;
      return {
        ...base,
        type: "longtask",
        duration,
        blockingDuration: nonNeg(raw.blockingDuration) ?? Math.max(0, duration - 50),
        api: raw.api === "longtask" ? "longtask" : "long-animation-frame",
        scripts: list(
          raw.scripts,
          (s) =>
            isObj(s)
              ? {
                  invoker: strOr(s.invoker, "unknown"),
                  sourceURL: str(s.sourceURL),
                  sourceFunctionName: str(s.sourceFunctionName),
                  duration: nonNeg(s.duration) ?? 0,
                }
              : null,
          LIMITS.scripts,
        ).items,
      };
    }
    case "interaction":
      return {
        ...base,
        type: "interaction",
        name: strOr(raw.name, "interaction"),
        interactionId: num(raw.interactionId) ?? 0,
        duration: nonNeg(raw.duration) ?? 0,
        inputDelay: nonNeg(raw.inputDelay) ?? 0,
        processingMs: nonNeg(raw.processingMs) ?? 0,
        presentationDelay: nonNeg(raw.presentationDelay) ?? 0,
        target: strOr(raw.target, "unknown"),
      };
    default:
      return null;
  }
}

/** Returns a new sorted array (never mutates input). */
export function validateEvents(raw, cap = LIMITS.events) {
  const { items } = list(raw, validateEvent, cap);
  return items.slice().sort((a, b) => a.timestamp - b.timestamp);
}

// ── Insights ─────────────────────────────────────────────────────────

function validateEvidence(raw) {
  if (!isObj(raw)) return null;
  const label = str(raw.label);
  if (!label) return null;
  const value = typeof raw.value === "string" ? str(raw.value) : num(raw.value);
  if (value === undefined) return null;
  return {
    kind: EVIDENCE_KINDS.has(raw.kind) ? raw.kind : "heuristic",
    label,
    value,
    unit: UNITS.has(raw.unit) ? raw.unit : undefined,
    threshold: num(raw.threshold),
    eventIds: strArray(raw.eventIds),
    weight: Math.min(1, nonNeg(raw.weight) ?? 0),
  };
}

function validateMetadata(raw) {
  if (!isObj(raw)) return {};
  return {
    renderCount: num(raw.renderCount),
    interactionType: str(raw.interactionType),
    rootComponent: str(raw.rootComponent),
    affectedComponents: strArray(raw.affectedComponents, 100),
    timeWindowStart: num(raw.timeWindowStart),
    timeWindowEnd: num(raw.timeWindowEnd),
    dedupeKey: str(raw.dedupeKey),
    traceId: str(raw.traceId, 120),
  };
}

export function validateInsight(raw) {
  if (!isObj(raw)) return null;
  const issueType = str(raw.issueType, 80);
  if (!issueType) return null;
  const metadata = validateMetadata(raw.metadata);
  // Legacy v1 insights have no id: synthesize a stable one from type/source/window.
  const id =
    str(raw.id, 200) ||
    `${issueType}|${str(raw.source, 200) || ""}|${metadata.dedupeKey || metadata.timeWindowStart || ""}`;
  const impact = isObj(raw.impact) ? raw.impact : {};
  return {
    id,
    issueType,
    category: CATEGORIES.has(raw.category) ? raw.category : inferCategory(issueType),
    severity: SEVERITIES.has(raw.severity) ? raw.severity : "low",
    source: strOr(raw.source, "unknown"),
    message: strOr(raw.message, ""),
    cause: strOr(raw.cause, ""),
    possibleFix: strOr(raw.possibleFix, ""),
    confidence: Math.min(1, nonNeg(raw.confidence) ?? 0),
    impact: {
      estimatedDelayMs: nonNeg(impact.estimatedDelayMs) ?? 0,
      renderCostMs: nonNeg(impact.renderCostMs),
    },
    evidence: list(raw.evidence, validateEvidence, LIMITS.evidence).items,
    traceId: str(raw.traceId, 120) || metadata.traceId,
    metadata,
  };
}

function inferCategory(issueType) {
  if (issueType.includes("network")) return "network";
  if (issueType.includes("long-task")) return "main-thread";
  if (issueType.includes("budget")) return "budget";
  if (issueType.includes("interaction")) return "interaction";
  return "rendering";
}

export function validateInsights(raw, cap = LIMITS.insights) {
  const { items } = list(raw, validateInsight, cap, "head");
  // De-duplicate ids so keyed DOM diffing stays sound.
  const seen = new Set();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

// ── Traces ───────────────────────────────────────────────────────────

function validateSpan(raw) {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 160);
  const start = num(raw.start);
  if (!id || start === undefined || !SPAN_KINDS.has(raw.kind)) return null;
  const end = Math.max(start, num(raw.end) ?? start);
  return {
    id,
    kind: raw.kind,
    label: strOr(raw.label, raw.kind),
    start,
    end,
    parentId: str(raw.parentId, 160),
    eventId: str(raw.eventId, 120),
    detail: str(raw.detail),
  };
}

export function validateTrace(raw) {
  if (!isObj(raw)) return null;
  const traceId = str(raw.traceId, 120);
  const start = num(raw.start);
  if (!traceId || start === undefined) return null;
  const end = Math.max(start, num(raw.end) ?? start);
  const trig = isObj(raw.trigger) ? raw.trigger : {};
  return {
    traceId,
    trigger: {
      eventType: strOr(trig.eventType, "event"),
      target: strOr(trig.target, "unknown"),
      label: str(trig.label),
      timestamp: num(trig.timestamp) ?? start,
    },
    start,
    end,
    durationMs: nonNeg(raw.durationMs) ?? end - start,
    latencyMs: nonNeg(raw.latencyMs),
    renderCount: nonNeg(raw.renderCount) ?? 0,
    networkCount: nonNeg(raw.networkCount) ?? 0,
    longTaskMs: nonNeg(raw.longTaskMs) ?? 0,
    components: strArray(raw.components, 100),
    eventIds: strArray(raw.eventIds, LIMITS.events),
    insightIds: strArray(raw.insightIds, LIMITS.insights),
    spans: list(raw.spans, validateSpan, LIMITS.spans, "head").items,
  };
}

export function validateTraces(raw, cap = LIMITS.traces) {
  const { items } = list(raw, validateTrace, cap);
  return items.slice().sort((a, b) => a.start - b.start);
}

// ── Summary / budgets ────────────────────────────────────────────────

export function validateBudgets(raw) {
  if (!isObj(raw)) return null;
  const out = {};
  let any = false;
  for (const key of BUDGET_KEYS) {
    const v = nonNeg(raw[key]);
    if (v !== undefined) {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : null;
}

function validateBudgetResult(raw) {
  if (!isObj(raw) || !BUDGET_KEYS.includes(raw.key)) return null;
  const actual = raw.actual === null ? null : num(raw.actual) ?? null;
  return {
    key: raw.key,
    label: strOr(raw.label, raw.key),
    limit: nonNeg(raw.limit) ?? 0,
    actual,
    unit: UNITS.has(raw.unit) ? raw.unit : "ms",
    status: BUDGET_STATUS.has(raw.status) ? raw.status : "no-data",
    samples: nonNeg(raw.samples) ?? 0,
    violations: nonNeg(raw.violations) ?? 0,
  };
}

function validateComponentStat(raw) {
  if (!isObj(raw)) return null;
  const name = str(raw.name);
  if (!name) return null;
  return {
    name,
    renders: nonNeg(raw.renders) ?? 0,
    mounts: nonNeg(raw.mounts) ?? 0,
    wasted: nonNeg(raw.wasted) ?? 0,
    totalMs: nonNeg(raw.totalMs) ?? 0,
    maxMs: nonNeg(raw.maxMs) ?? 0,
    avgMs: nonNeg(raw.avgMs) ?? 0,
  };
}

function validateRequestStat(raw) {
  if (!isObj(raw)) return null;
  const url = str(raw.url);
  if (!url) return null;
  return {
    url,
    method: strOr(raw.method, "GET").slice(0, 10),
    count: nonNeg(raw.count) ?? 0,
    avgMs: nonNeg(raw.avgMs) ?? 0,
    maxMs: nonNeg(raw.maxMs) ?? 0,
    errors: nonNeg(raw.errors) ?? 0,
  };
}

const nullableNum = (v) => (v === null ? null : num(v) ?? null);

export function validateSummary(raw) {
  if (!isObj(raw)) return null;
  const counts = isObj(raw.insightCounts) ? raw.insightCounts : {};
  const score = num(raw.score);
  return {
    score: score === undefined ? null : Math.max(0, Math.min(100, score)),
    grade: GRADES.has(raw.grade) ? raw.grade : null,
    interactionP75Ms: nullableNum(raw.interactionP75Ms),
    interactionMaxMs: nullableNum(raw.interactionMaxMs),
    interactions: nonNeg(raw.interactions) ?? 0,
    renders: nonNeg(raw.renders) ?? 0,
    wastedRenders: nonNeg(raw.wastedRenders) ?? 0,
    longTasks: nonNeg(raw.longTasks) ?? 0,
    totalBlockingMs: nonNeg(raw.totalBlockingMs) ?? 0,
    requests: nonNeg(raw.requests) ?? 0,
    failedRequests: nonNeg(raw.failedRequests) ?? 0,
    insightCounts: {
      critical: nonNeg(counts.critical) ?? 0,
      high: nonNeg(counts.high) ?? 0,
      medium: nonNeg(counts.medium) ?? 0,
      low: nonNeg(counts.low) ?? 0,
    },
    budgets: list(raw.budgets, validateBudgetResult, LIMITS.budgets).items,
    topComponents: list(raw.topComponents, validateComponentStat, LIMITS.components).items,
    topRequests: list(raw.topRequests, validateRequestStat, LIMITS.requests).items,
  };
}

// ── Messages ─────────────────────────────────────────────────────────

export function validateHello(raw) {
  if (!isObj(raw)) return null;
  const sessionId = str(raw.sessionId, 120);
  if (!sessionId) return null;
  const cfg = isObj(raw.config) ? raw.config : {};
  const config = {};
  for (const k of ["trackEvents", "trackNetwork", "trackRenders", "trackLongTasks", "trackInteractions", "react"]) {
    config[k] = cfg[k] === true;
  }
  // v2.1: which engine copy is talking ("app" bundled by the page, "injected" by the extension).
  config.mode = cfg.mode === "injected" ? "injected" : "app";
  return {
    sessionId,
    engineVersion: strOr(raw.engineVersion, "?"),
    url: strOr(raw.url, ""),
    title: strOr(raw.title, ""),
    timeOrigin: num(raw.timeOrigin) ?? null,
    config,
  };
}

export function validateSnapshot(raw) {
  if (!isObj(raw)) return null;
  const sessionId = str(raw.sessionId, 120);
  if (!sessionId) return null;
  return {
    sessionId,
    engineVersion: strOr(raw.engineVersion, "?"),
    capturedAt: num(raw.capturedAt) ?? 0,
    timeOrigin: num(raw.timeOrigin) ?? null,
    paused: raw.paused === true,
    insights: validateInsights(raw.insights),
    events: validateEvents(raw.events),
    droppedEvents: nonNeg(raw.droppedEvents) ?? 0,
    traces: validateTraces(raw.traces),
    summary: validateSummary(raw.summary),
    budgets: validateBudgets(raw.budgets),
  };
}

const PAGE_TYPES = new Set(["HELLO", "SNAPSHOT", "RESET", "INSIGHTS_UPDATE", "EVENTS_UPDATE"]);

/**
 * Validates a PageMessage envelope and its payload.
 * Returns { type, payload, version } with a sanitized payload, or null.
 */
export function validatePageMessage(raw) {
  if (!isObj(raw) || raw.source !== "perf-engine" || !PAGE_TYPES.has(raw.type)) return null;
  const version = num(raw.version) ?? 1;
  let payload = null;
  switch (raw.type) {
    case "HELLO":
      payload = validateHello(raw.payload);
      break;
    case "SNAPSHOT":
      payload = validateSnapshot(raw.payload);
      break;
    case "RESET":
      payload = { sessionId: isObj(raw.payload) ? str(raw.payload.sessionId, 120) || null : null };
      break;
    case "INSIGHTS_UPDATE":
      payload = Array.isArray(raw.payload) ? validateInsights(raw.payload) : null;
      break;
    case "EVENTS_UPDATE":
      payload = Array.isArray(raw.payload) ? validateEvents(raw.payload) : null;
      break;
  }
  return payload ? { type: raw.type, version, payload } : null;
}

// ── Export bundle ────────────────────────────────────────────────────

export const EXPORT_FORMAT = "perf-engine-devtools-export";

export function validateHistoryEntry(raw) {
  if (!isObj(raw)) return null;
  const insight = validateInsight(raw.insight);
  if (!insight) return null;
  return {
    insight,
    firstSeen: num(raw.firstSeen) ?? 0,
    lastSeen: num(raw.lastSeen) ?? 0,
    occurrences: Math.max(1, Math.round(nonNeg(raw.occurrences) ?? 1)),
  };
}

/**
 * Validates an imported bundle. `a11y` (optional, v2.2) is the Accessibility view's last audit
 * report, sanitized by that view's own validator.
 */
export function validateBundle(raw) {
  if (!isObj(raw)) return null;
  const snapshot = validateSnapshot(raw.snapshot);
  if (!snapshot) return null;
  return {
    exportedAt: num(raw.exportedAt) ?? null,
    hello: validateHello(raw.hello),
    snapshot,
    insightHistory: list(raw.insightHistory, validateHistoryEntry, LIMITS.insights * 2).items,
    vitals: validateVitals(raw.vitals),
    mode: raw.mode === "devtools" || raw.mode === "injected" || raw.mode === "app" ? raw.mode : null,
    a11y: raw.a11y == null ? null : validateReport(raw.a11y),
  };
}
