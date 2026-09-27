/**
 * Analysis context: groups events into interaction traces.
 *
 * Grouping is causal first — events carrying a `traceId` (stamped at capture
 * time) belong to that trace. Only untagged legacy events fall back to time
 * windows, and each untagged event is assigned to at most one window, so
 * windows never overlap. Input events are never mutated.
 */

import type {
  InteractionEvent,
  LongTaskEvent,
  NetworkEvent,
  RenderEvent,
  TrackedEvent,
  UIEvent,
  UIEventType,
} from "../types/events.js";
import { POINTER_JOIN_MS, GESTURE_JOIN_MS, TRACE_IDLE_MS, TRACE_MAX_SEGMENT_MS } from "../trace/traceContext.js";

export interface RenderChain {
  root: RenderEvent;
  renders: RenderEvent[];
  start: number;
  end: number;
  totalDurationMs: number;
}

/** Renders that belong to one React commit (or one burst for manual tracking). */
export interface RenderCommit {
  key: string;
  commitId?: number;
  /** Earliest render start in the commit. */
  timestamp: number;
  /** When the commit was applied (latest render end when unknown). */
  commitTime: number;
  renders: RenderEvent[];
  /** Max render duration in the commit (≈ commit render cost when durations include children). */
  maxDurationMs: number;
}

export interface InteractionTrace {
  traceId: string;
  /** True when grouped by captured traceId; false for time-window fallback. */
  causal: boolean;
  startTime: number;
  endTime: number;
  /** The event that opened the trace (e.g. pointerdown). */
  trigger: UIEvent;
  /** The event that committed the gesture (e.g. the click after pointerdown). */
  committedTrigger: UIEvent;
  events: TrackedEvent[];
  uiEvents: UIEvent[];
  renders: RenderEvent[];
  networkRequests: NetworkEvent[];
  longTasks: LongTaskEvent[];
  interactionTimings: InteractionEvent[];
  renderChains: RenderChain[];
  commits: RenderCommit[];
}

/** Backward-compatible view of a trace (one per gesture). */
export interface InteractionWindow {
  uiEvent: UIEvent;
  start: number;
  end: number;
  events: TrackedEvent[];
  renderEvents: RenderEvent[];
  networkEvents: NetworkEvent[];
  renderChains: RenderChain[];
  chained: boolean;
  traceId: string;
}

export interface AnalysisContext {
  /** All events sorted by timestamp (a copy; never mutated). */
  events: TrackedEvent[];
  uiEvents: UIEvent[];
  renders: RenderEvent[];
  network: NetworkEvent[];
  longTasks: LongTaskEvent[];
  interactionTimings: InteractionEvent[];
  traces: InteractionTrace[];
  traceById: Map<string, InteractionTrace>;
  /** @deprecated use `traces`; kept for older custom rules. */
  interactions: InteractionWindow[];
  allRenderChains: RenderChain[];
  /** Renders not attributed to any trace (background work). */
  untracedRenders: RenderEvent[];
  /** Timestamp of the newest event (0 when empty). */
  latestTimestamp: number;
  interactionWindowMs: number;
  /** eventIds of renders classified as wasted (see createWastedClassifier). */
  wastedRenderIds: ReadonlySet<string>;
}

export interface ContextOptions {
  /** Minimum window for untagged legacy events (default 300ms). */
  interactionWindowMs?: number;
}

export const DEFAULT_INTERACTION_WINDOW_MS = 300;
const RENDER_CHAIN_GAP_MS = 24;
/** Manual renders without commitId within this gap are treated as one commit. */
const MANUAL_COMMIT_GAP_MS = 2;
const CHAINED_INTERACTION_GAP_MS = 80;

const LEGACY_TRIGGERS: ReadonlySet<UIEventType> = new Set<UIEventType>([
  "click",
  "dblclick",
  "keydown",
  "input",
  "change",
  "submit",
  "pointerdown",
]);

const LEGACY_FOLLOWUPS: Partial<Record<UIEventType, ReadonlySet<UIEventType>>> = {
  click: new Set<UIEventType>(["pointerdown", "keydown"]),
  input: new Set<UIEventType>(["keydown", "click", "pointerdown"]),
  change: new Set<UIEventType>(["keydown", "input", "click", "pointerdown"]),
  submit: new Set<UIEventType>(["click", "keydown", "pointerdown"]),
  dblclick: new Set<UIEventType>(["click", "pointerdown"]),
};

// ── helpers ──────────────────────────────────────────────────────────

export function eventEnd(event: TrackedEvent): number {
  switch (event.type) {
    case "network":
      return event.endTime ?? event.timestamp + event.duration;
    case "longtask":
    case "interaction":
      return event.timestamp + event.duration;
    case "render":
      return renderEnd(event);
    default:
      return event.timestamp;
  }
}

/** End of a render: its commit time when known, else start + duration. */
export function renderEnd(render: RenderEvent): number {
  const end = render.timestamp + render.durationMs;
  return typeof render.commitTime === "number" && render.commitTime >= render.timestamp ? render.commitTime : end;
}

function isSorted(events: readonly TrackedEvent[]): boolean {
  for (let i = 1; i < events.length; i += 1) {
    if (events[i]!.timestamp < events[i - 1]!.timestamp) return false;
  }
  return true;
}

export function buildRenderChains(renders: readonly RenderEvent[]): RenderChain[] {
  if (renders.length === 0) return [];
  const chains: RenderChain[] = [];
  let current: RenderEvent[] = [renders[0]!];
  const finish = (list: RenderEvent[]): RenderChain => {
    let total = 0;
    for (const r of list) total += r.durationMs;
    return { root: list[0]!, renders: list, start: list[0]!.timestamp, end: list[list.length - 1]!.timestamp, totalDurationMs: total };
  };
  for (let i = 1; i < renders.length; i += 1) {
    const r = renders[i]!;
    if (r.timestamp - renders[i - 1]!.timestamp <= RENDER_CHAIN_GAP_MS) {
      current.push(r);
    } else {
      chains.push(finish(current));
      current = [r];
    }
  }
  chains.push(finish(current));
  return chains;
}

/**
 * Groups renders (sorted by start) into commits: by commitId (renders of one
 * commit need not be adjacent once sorted by start time, e.g. an interrupted
 * transition), else by near-identical timestamps for manual tracking.
 * Commits are returned in order of their earliest render.
 */
export function buildCommits(renders: readonly RenderEvent[]): RenderCommit[] {
  const commits: RenderCommit[] = [];
  const byId = new Map<number, RenderCommit>();
  let manual: RenderCommit | null = null;
  const add = (commit: RenderCommit, r: RenderEvent): void => {
    commit.renders.push(r);
    if (r.durationMs > commit.maxDurationMs) commit.maxDurationMs = r.durationMs;
    const end = renderEnd(r);
    if (end > commit.commitTime) commit.commitTime = end;
  };
  const open = (r: RenderEvent): RenderCommit => {
    const commit: RenderCommit = {
      key: r.commitId !== undefined ? `c${r.commitId}` : `t${r.eventId}`,
      timestamp: r.timestamp,
      commitTime: renderEnd(r),
      renders: [r],
      maxDurationMs: r.durationMs,
    };
    if (r.commitId !== undefined) commit.commitId = r.commitId;
    commits.push(commit);
    return commit;
  };
  for (const r of renders) {
    if (r.commitId !== undefined) {
      manual = null;
      const existing = byId.get(r.commitId);
      if (existing) add(existing, r);
      else byId.set(r.commitId, open(r));
      continue;
    }
    if (manual && r.timestamp - manual.renders[manual.renders.length - 1]!.timestamp <= MANUAL_COMMIT_GAP_MS) {
      add(manual, r);
      continue;
    }
    manual = open(r);
  }
  return commits;
}

/** Instance identity for grouping: instanceId when known, else component name. */
export function instanceKey(render: RenderEvent): string {
  return render.instanceId ?? render.componentName;
}

/**
 * One render per (commit, instance): StrictMode double renders and multiple
 * manual reports in one commit collapse to a single render.
 */
export function collapseRendersPerCommit(commits: readonly RenderCommit[]): RenderEvent[] {
  const out: RenderEvent[] = [];
  for (const commit of commits) {
    if (commit.renders.length === 1) {
      out.push(commit.renders[0]!);
      continue;
    }
    const seen = new Set<string>();
    for (const r of commit.renders) {
      const key = instanceKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/**
 * Wasted-render decision (never inferred from zero durations):
 * - instrumentation flag `wasted`, or
 * - manual hashes: current propsHash equals prevPropsHash, or equals the
 *   propsHash of the previous render of the same instance (only when an
 *   instanceId is known — sibling list items share a component name).
 */
export function createWastedClassifier(): (render: RenderEvent) => boolean {
  const lastHash = new Map<string, string>();
  return (render) => {
    const key = render.instanceId;
    const prev = key !== undefined ? lastHash.get(key) : undefined;
    if (key !== undefined && render.propsHash !== undefined) lastHash.set(key, render.propsHash);
    if (render.phase === "mount") return false;
    if (render.wasted === true) return true;
    if (render.wasted === false) return false;
    if (render.propsHash === undefined) return false;
    if (render.prevPropsHash !== undefined) return render.propsHash === render.prevPropsHash;
    return prev !== undefined && prev === render.propsHash;
  };
}

interface TraceBucket {
  traceId: string;
  causal: boolean;
  events: TrackedEvent[];
}

function finaliseTrace(bucket: TraceBucket): InteractionTrace | null {
  const uiEvents: UIEvent[] = [];
  const renders: RenderEvent[] = [];
  const networkRequests: NetworkEvent[] = [];
  const longTasks: LongTaskEvent[] = [];
  const interactionTimings: InteractionEvent[] = [];
  let endTime = Number.NEGATIVE_INFINITY;
  for (const e of bucket.events) {
    switch (e.type) {
      case "ui":
        uiEvents.push(e);
        break;
      case "render":
        renders.push(e);
        break;
      case "network":
        networkRequests.push(e);
        break;
      case "longtask":
        longTasks.push(e);
        break;
      case "interaction":
        interactionTimings.push(e);
        break;
    }
    const end = eventEnd(e);
    if (end > endTime) endTime = end;
  }
  if (uiEvents.length === 0) return null; // trigger trimmed from the store
  const trigger = uiEvents.find((u) => u.startsTrace) ?? uiEvents[0]!;
  let committedTrigger = trigger;
  for (const u of uiEvents) {
    if (u.timestamp >= trigger.timestamp && u.eventType !== "pointerdown" && LEGACY_TRIGGERS.has(u.eventType)) {
      committedTrigger = u;
      break;
    }
  }
  const commits = buildCommits(renders);
  const startTime = Math.min(trigger.timestamp, bucket.events[0]!.timestamp);
  return {
    traceId: bucket.traceId,
    causal: bucket.causal,
    startTime,
    endTime: Math.max(endTime, trigger.timestamp),
    trigger,
    committedTrigger,
    events: bucket.events,
    uiEvents,
    renders,
    networkRequests,
    longTasks,
    interactionTimings,
    renderChains: buildRenderChains(renders),
    commits,
  };
}

/**
 * Window-based grouping for untagged events (manual instrumentation without
 * the trace context, or events recorded by older engine versions).
 * Linear sweep: each event goes to the latest open window only.
 */
function groupLegacy(untagged: readonly TrackedEvent[], windowMs: number): { buckets: TraceBucket[]; leftovers: TrackedEvent[] } {
  const buckets: TraceBucket[] = [];
  const leftovers: TrackedEvent[] = [];
  let open: { bucket: TraceBucket; start: number; lastActivity: number; lastTrigger: UIEvent } | null = null;

  for (const e of untagged) {
    if (open) {
      const deadline = Math.min(open.start + TRACE_MAX_SEGMENT_MS, Math.max(open.start + windowMs, open.lastActivity + TRACE_IDLE_MS));
      if (e.timestamp > deadline) open = null;
    }
    if (e.type === "ui") {
      if (!LEGACY_TRIGGERS.has(e.eventType)) {
        if (open) {
          open.bucket.events.push(e);
          open.lastActivity = e.timestamp;
        } else {
          leftovers.push(e);
        }
        continue;
      }
      const followsFrom = LEGACY_FOLLOWUPS[e.eventType];
      const gap = open ? e.timestamp - open.lastTrigger.timestamp : Infinity;
      const joins =
        open !== null &&
        followsFrom !== undefined &&
        followsFrom.has(open.lastTrigger.eventType) &&
        gap <= (open.lastTrigger.eventType === "pointerdown" ? POINTER_JOIN_MS : GESTURE_JOIN_MS);
      if (open && joins) {
        open.bucket.events.push(e);
        open.lastActivity = e.timestamp;
        open.lastTrigger = e;
        continue;
      }
      const bucket: TraceBucket = { traceId: `legacy-${e.eventId}`, causal: false, events: [e] };
      buckets.push(bucket);
      open = { bucket, start: e.timestamp, lastActivity: e.timestamp, lastTrigger: e };
      continue;
    }
    if (open) {
      open.bucket.events.push(e);
      open.lastActivity = e.timestamp;
    } else {
      leftovers.push(e);
    }
  }
  return { buckets, leftovers };
}

export function buildAnalysisContext(
  events: readonly TrackedEvent[],
  options: ContextOptions | number = {},
): AnalysisContext {
  const interactionWindowMs =
    typeof options === "number" ? options : options.interactionWindowMs ?? DEFAULT_INTERACTION_WINDOW_MS;
  const sorted = isSorted(events) ? events.slice() : events.slice().sort((a, b) => a.timestamp - b.timestamp);

  const uiEvents: UIEvent[] = [];
  const renders: RenderEvent[] = [];
  const network: NetworkEvent[] = [];
  const longTasks: LongTaskEvent[] = [];
  const interactionTimings: InteractionEvent[] = [];
  const tagged = new Map<string, TraceBucket>();
  const untagged: TrackedEvent[] = [];

  for (const e of sorted) {
    switch (e.type) {
      case "ui":
        uiEvents.push(e);
        break;
      case "render":
        renders.push(e);
        break;
      case "network":
        network.push(e);
        break;
      case "longtask":
        longTasks.push(e);
        break;
      case "interaction":
        interactionTimings.push(e);
        break;
    }
    if (e.traceId) {
      let bucket = tagged.get(e.traceId);
      if (!bucket) {
        bucket = { traceId: e.traceId, causal: true, events: [] };
        tagged.set(e.traceId, bucket);
      }
      bucket.events.push(e);
    } else {
      untagged.push(e);
    }
  }

  const { buckets: legacyBuckets } = groupLegacy(untagged, interactionWindowMs);
  const traces: InteractionTrace[] = [];
  for (const bucket of tagged.values()) {
    const trace = finaliseTrace(bucket);
    if (trace) traces.push(trace);
  }
  for (const bucket of legacyBuckets) {
    const trace = finaliseTrace(bucket);
    if (trace) traces.push(trace);
  }
  traces.sort((a, b) => a.startTime - b.startTime || (a.traceId < b.traceId ? -1 : 1));

  const traceById = new Map<string, InteractionTrace>();
  for (const t of traces) traceById.set(t.traceId, t);

  const isWasted = createWastedClassifier();
  const wastedRenderIds = new Set<string>();
  for (const r of renders) if (isWasted(r)) wastedRenderIds.add(r.eventId);

  const untracedRenders: RenderEvent[] = [];
  for (const r of renders) {
    const id = r.traceId;
    if (id !== undefined && traceById.has(id)) continue;
    untracedRenders.push(r);
  }
  // Legacy-grouped renders have no traceId but do belong to a trace.
  const legacyRenderIds = new Set<string>();
  for (const t of traces) {
    if (t.causal) continue;
    for (const r of t.renders) legacyRenderIds.add(r.eventId);
  }
  const background = legacyRenderIds.size > 0 ? untracedRenders.filter((r) => !legacyRenderIds.has(r.eventId)) : untracedRenders;

  const interactions: InteractionWindow[] = traces.map((t, i) => ({
    uiEvent: t.trigger,
    start: t.startTime,
    end: t.endTime,
    events: t.events,
    renderEvents: t.renders,
    networkEvents: t.networkRequests,
    renderChains: t.renderChains,
    chained: i > 0 && t.trigger.timestamp - traces[i - 1]!.trigger.timestamp <= CHAINED_INTERACTION_GAP_MS,
    traceId: t.traceId,
  }));

  return {
    events: sorted,
    uiEvents,
    renders,
    network,
    longTasks,
    interactionTimings,
    traces,
    traceById,
    interactions,
    allRenderChains: buildRenderChains(renders),
    untracedRenders: background,
    latestTimestamp: sorted.length > 0 ? sorted[sorted.length - 1]!.timestamp : 0,
    interactionWindowMs,
    wastedRenderIds,
  };
}
