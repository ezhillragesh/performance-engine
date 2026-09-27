/**
 * Causal trace context.
 *
 * A trace is opened by a *trigger* UI event at capture time and stays active
 * while tracked work keeps happening: the synchronous handler, microtasks and
 * following frames, until it has been idle for `IDLE_MS` (no attributed work)
 * or a hard cap of `MAX_SEGMENT_MS` is reached. Expiry is evaluated lazily
 * against the clock.
 *
 * The idle clock only starts when the task that (re)activated the trace has
 * finished: a trace is *pinned* until a zero-delay timer fires after that
 * task, so a slow synchronous handler (e.g. 300ms of work before setState)
 * does not expire the trace before the render it causes.
 *
 * Events read `getActiveTraceId()` when they are *created* and never get
 * re-tagged later. Async work (fetch/XHR) captures the id at request start and
 * re-activates it via `activateTrace` when the response arrives. If another
 * interaction is live at that moment, the response only borrows the context
 * for its synchronous continuation and then hands it back (see
 * `activateTrace`).
 */

import type { UIEventType } from "../types/events.js";
import { generateTraceId } from "../tracker/id.js";
import { now } from "../tracker/time.js";

export const TRACE_IDLE_MS = 120;
export const TRACE_MAX_SEGMENT_MS = 2000;
/** pointerdown opens a pending trace that a click within this window joins. */
export const POINTER_JOIN_MS = 500;
/** Follow-up events of one gesture (keydown->input, click->change/submit). */
export const GESTURE_JOIN_MS = 50;
const RING_SIZE = 64;

export const TRIGGER_EVENT_TYPES: ReadonlySet<UIEventType> = new Set<UIEventType>([
  "click",
  "dblclick",
  "keydown",
  "input",
  "change",
  "submit",
  "pointerdown",
]);

/** Follow-up event -> event types of the same gesture it joins. */
const GESTURE_FOLLOWUPS: Partial<Record<UIEventType, ReadonlySet<UIEventType>>> = {
  input: new Set<UIEventType>(["keydown", "pointerdown", "click"]),
  change: new Set<UIEventType>(["keydown", "input", "click", "pointerdown"]),
  submit: new Set<UIEventType>(["click", "keydown", "pointerdown"]),
  dblclick: new Set<UIEventType>(["click", "pointerdown"]),
  click: new Set<UIEventType>(["keydown"]), // Enter/Space on a button synthesises click
};

interface ActiveTrace {
  id: string;
  /** Start of the current active segment (re-activation starts a new one). */
  segmentStart: number;
  lastActivity: number;
  /** Last trigger type attributed to this trace and when it happened. */
  lastTriggerType: UIEventType | null;
  lastTriggerAt: number;
}

export interface TraceRecord {
  traceId: string;
  triggerType: UIEventType | "manual";
  /** Browser event timestamp of the trigger (Event.timeStamp) or capture time. */
  triggerTime: number;
  /** All trigger times of the gesture (pointerdown, click, ...). */
  triggerTimes: number[];
  startedAt: number;
  /** Last time work was attributed to the trace. */
  lastActivity: number;
}

let active: ActiveTrace | null = null;
/** Trace whose idle clock is held until the current task ends (see header). */
let pinned: { id: string; token: number } | null = null;
let pinCounter = 0;
/**
 * Trace hidden by `runDetached`: while set (and still the active trace),
 * `getActiveTraceId()` reports no trace. Cleared as soon as any other trace
 * becomes active, so real user input is never affected.
 */
let detachedId: string | null = null;
let pendingPointer: { traceId: string; at: number } | null = null;
const ring: TraceRecord[] = [];
const ringById = new Map<string, TraceRecord>();

function isExpired(trace: ActiveTrace, t: number): boolean {
  if (pinned !== null && pinned.id === trace.id) return false;
  return t - trace.lastActivity > TRACE_IDLE_MS || t - trace.segmentStart > TRACE_MAX_SEGMENT_MS;
}

const scheduleMicrotask: (cb: () => void) => void =
  typeof queueMicrotask === "function" ? queueMicrotask : (cb) => void Promise.resolve().then(cb);

/** Runs `cb` after the current task (and its microtasks) have finished. */
function scheduleAfterTask(cb: () => void): void {
  if (typeof setTimeout === "function") {
    const handle = setTimeout(cb, 0) as unknown as { unref?: () => void };
    handle.unref?.();
  } else {
    scheduleMicrotask(cb);
  }
}

/**
 * Holds the idle clock of `id` until the current task ends; when it does, the
 * idle period (and the gesture-join window) is measured from that moment.
 */
function pinUntilTaskEnd(id: string): void {
  if (pinned !== null && pinned.id === id) return;
  pinCounter += 1;
  const token = pinCounter;
  pinned = { id, token };
  scheduleAfterTask(() => {
    if (pinned === null || pinned.token !== token) return;
    pinned = null;
    const t = now();
    if (active && active.id === id) {
      if (t > active.lastActivity) active.lastActivity = t;
      if (active.lastTriggerType !== null && t > active.lastTriggerAt) active.lastTriggerAt = t;
    }
    markActivity(id, t);
  });
}

function remember(record: TraceRecord): void {
  ring.push(record);
  ringById.set(record.traceId, record);
  if (ring.length > RING_SIZE) {
    const removed = ring.shift();
    if (removed) ringById.delete(removed.traceId);
  }
}

function markActivity(traceId: string, t: number): void {
  const record = ringById.get(traceId);
  if (record && t > record.lastActivity) record.lastActivity = t;
}

function addTriggerTime(traceId: string, time: number): void {
  const record = ringById.get(traceId);
  if (record && record.triggerTimes.length < 8) record.triggerTimes.push(time);
}

function setActive(id: string, t: number, triggerType: UIEventType | null): ActiveTrace {
  detachedId = null;
  const next: ActiveTrace = {
    id,
    segmentStart: t,
    lastActivity: t,
    lastTriggerType: triggerType,
    lastTriggerAt: triggerType ? t : Number.NEGATIVE_INFINITY,
  };
  active = next;
  markActivity(id, t);
  pinUntilTaskEnd(id);
  return next;
}

/** The currently active trace id, or undefined when idle. */
export function getActiveTraceId(): string | undefined {
  if (!active) return undefined;
  if (isExpired(active, now())) {
    active = null;
    detachedId = null;
    return undefined;
  }
  if (detachedId === active.id) return undefined;
  return active.id;
}

/**
 * Runs `fn` — and the microtasks it schedules — without attributing anything
 * to the currently active trace. Used for work that is *not* caused by the
 * user's interaction even though it happens while a trace is still open, e.g.
 * the engine's own analysis tick notifying subscribers (a UI that renders
 * engine stats would otherwise be blamed on whatever the user clicked last).
 *
 * The active trace is not ended: work captured after the current microtask
 * checkpoint is attributed to it again, and any newly started or re-activated
 * trace (user input, a response arriving) is unaffected.
 */
export function runDetached<T>(fn: () => T): T {
  const id = active && !isExpired(active, now()) ? active.id : null;
  if (id === null || detachedId !== null) return fn();
  detachedId = id;
  try {
    return fn();
  } finally {
    // Two hops: frameworks flush synchronous updates in a microtask queued by
    // `fn` (e.g. React's useSyncExternalStore), which must also run detached.
    scheduleMicrotask(() =>
      scheduleMicrotask(() => {
        if (detachedId === id) detachedId = null;
      }),
    );
  }
}

/**
 * Returns the active trace id and records that work was attributed to it
 * (extends the idle deadline). Call this when *capturing* an event.
 */
export function captureTraceId(): string | undefined {
  const id = getActiveTraceId();
  if (id && active) {
    const t = now();
    active.lastActivity = t;
    markActivity(id, t);
  }
  return id;
}

/** Starts a new trace explicitly (tests / custom triggers). */
export function beginTrace(
  triggerType: UIEventType | "manual" = "manual",
  triggerTime?: number,
): string {
  const t = now();
  const id = generateTraceId();
  const tt = triggerTime ?? t;
  remember({ traceId: id, triggerType, triggerTime: tt, triggerTimes: [tt], startedAt: t, lastActivity: t });
  setActive(id, t, triggerType === "manual" ? null : triggerType);
  return id;
}

/**
 * Makes `traceId` the active trace for one idle period (the "response
 * window"), e.g. when a request started by that trace resolves.
 *
 * If a *different* trace is still live (the user has started a newer
 * interaction meanwhile), `traceId` only borrows the context for the current
 * synchronous continuation and its microtasks; the live trace is then
 * restored instead of being silently replaced for a whole idle period.
 */
export function activateTrace(traceId: string): void {
  const t = now();
  if (active && active.id === traceId && !isExpired(active, t)) {
    detachedId = null;
    active.lastActivity = t;
    markActivity(traceId, t);
    pinUntilTaskEnd(traceId);
    return;
  }
  const live = active && !isExpired(active, t) ? active : null;
  const savedDetached = detachedId;
  const borrowed = setActive(traceId, t, null);
  if (!live) return;
  // Hand the context back once the continuation (and the synchronous
  // framework flushes it queues as microtasks) has run.
  scheduleMicrotask(() =>
    scheduleMicrotask(() => {
      if (active !== borrowed) return;
      const back = now();
      if (back > live.lastActivity) live.lastActivity = back;
      active = live;
      detachedId = savedDetached === live.id ? savedDetached : null;
      markActivity(live.id, back);
    }),
  );
}

/**
 * Runs `fn` with `traceId` active. The trace stays active afterwards for one
 * idle period so microtasks/renders caused by `fn` inherit it.
 */
export function runInTrace<T>(traceId: string, fn: () => T): T {
  activateTrace(traceId);
  try {
    return fn();
  } finally {
    if (active && active.id === traceId) {
      active.lastActivity = now();
      markActivity(traceId, active.lastActivity);
    }
  }
}

export interface TriggerResult {
  traceId: string | undefined;
  /** True when this event opened a new trace. */
  startsTrace: boolean;
}

/**
 * Called by the UI tracker at capture time. Decides whether the event starts
 * a trace, joins the current gesture, or is merely attributed.
 */
export function onUserEvent(eventType: UIEventType, domTimestamp?: number): TriggerResult {
  const t = now();
  if (!TRIGGER_EVENT_TYPES.has(eventType)) {
    return { traceId: captureTraceId(), startsTrace: false };
  }

  if (eventType === "click" && pendingPointer && t - pendingPointer.at <= POINTER_JOIN_MS) {
    const joined = pendingPointer.traceId;
    pendingPointer = null;
    // Re-activate as a fresh segment: the click commits the gesture.
    setActive(joined, t, "click");
    addTriggerTime(joined, domTimestamp ?? t);
    return { traceId: joined, startsTrace: false };
  }

  const current = active && !isExpired(active, t) ? active : null;
  const followsFrom = GESTURE_FOLLOWUPS[eventType];
  if (
    current &&
    followsFrom &&
    current.lastTriggerType !== null &&
    followsFrom.has(current.lastTriggerType) &&
    // Same task as the previous trigger (e.g. click -> submit, keydown ->
    // input after a slow keydown handler), or shortly after it finished.
    ((pinned !== null && pinned.id === current.id) || t - current.lastTriggerAt <= GESTURE_JOIN_MS)
  ) {
    detachedId = null;
    current.lastActivity = t;
    current.lastTriggerType = eventType;
    current.lastTriggerAt = t;
    markActivity(current.id, t);
    addTriggerTime(current.id, domTimestamp ?? t);
    return { traceId: current.id, startsTrace: false };
  }

  const traceId = beginTrace(eventType, domTimestamp);
  pendingPointer = eventType === "pointerdown" ? { traceId, at: t } : null;
  return { traceId, startsTrace: true };
}

/**
 * Trace whose trigger time is closest to `time` within ±`toleranceMs`
 * (used to attribute Event Timing entries).
 */
export function findTraceByTriggerTime(time: number, toleranceMs = 50): string | undefined {
  let best: TraceRecord | undefined;
  let bestDelta = toleranceMs;
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const record = ring[i]!;
    for (const triggerTime of record.triggerTimes) {
      const delta = Math.abs(triggerTime - time);
      if (delta < bestDelta || (delta === bestDelta && !best)) {
        best = record;
        bestDelta = delta;
      }
    }
  }
  return best?.traceId;
}

/** Most recent trace that was active at `time` (used for long tasks). */
export function findTraceActiveAt(time: number): string | undefined {
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const record = ring[i]!;
    const start = Math.min(record.startedAt, record.triggerTime);
    if (time >= start - 1 && time <= record.lastActivity + TRACE_IDLE_MS) {
      return record.traceId;
    }
  }
  return undefined;
}

export function getRecentTraceRecords(): TraceRecord[] {
  return ring.map((r) => ({ ...r, triggerTimes: r.triggerTimes.slice() }));
}

export function resetTraceContext(): void {
  active = null;
  detachedId = null;
  pinned = null;
  pendingPointer = null;
  ring.length = 0;
  ringById.clear();
}
