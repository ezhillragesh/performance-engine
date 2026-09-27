/**
 * PerformanceObserver-based trackers:
 * - Long Animation Frames (script attribution), falling back to Long Tasks.
 * - Event Timing (browser-measured interaction latency, the basis of INP).
 *
 * Entries arrive asynchronously, so trace attribution is by time: event
 * timing entries match the trigger whose timestamp is closest (±50ms); long
 * tasks match the trace that was active when they started.
 */

import type { InteractionEvent, LongTaskEvent, LongTaskScript } from "../types/events.js";
import { pushEvent } from "../logger/store.js";
import { findTraceActiveAt, findTraceByTriggerTime } from "../trace/traceContext.js";
import { describeTarget } from "./dom.js";
import { generateEventId, getCurrentSessionId } from "./id.js";

export interface PerformanceTrackingOptions {
  longTasks?: boolean;
  interactions?: boolean;
  /** Event Timing durationThreshold (min 16). */
  eventDurationThresholdMs?: number;
}

/**
 * Entries without an interactionId are kept only for these names. pointer and mouse and touch
 * entries are left out: they are companions of a pointer interaction that already carries the
 * id, and INP ignores them too. Same list as the panel collector (devtoolsLayer/collector.js).
 */
const INTERACTION_EVENT_NAMES = new Set(["click", "dblclick", "keydown", "keyup", "keypress", "input", "change", "submit"]);

const MAX_SCRIPTS = 5;
const LONG_TASK_BLOCKING_THRESHOLD_MS = 50;

function supportedEntryTypes(): readonly string[] {
  if (typeof PerformanceObserver === "undefined") return [];
  const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
  return Array.isArray(types) ? types : [];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// Structural shapes (not all TS DOM libs ship LoAF / Event Timing types).
interface LoafScriptLike {
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  duration?: number;
}

interface LoafEntryLike {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  scripts?: LoafScriptLike[];
}

interface EventTimingEntryLike {
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
  interactionId?: number;
  target?: EventTarget | null;
}

function processingOf(entry: EventTimingEntryLike): number {
  const start = entry.processingStart ?? entry.startTime;
  return Math.max(0, (entry.processingEnd ?? start) - start);
}

/**
 * Picks the entry to report for one interaction. pointerdown, pointerup and click of one gesture
 * share an interactionId, and Chrome rounds durations to 8ms, so they often tie. On a tie the
 * entry that ran the handler (most processing time) wins, not a pointerdown without listeners.
 */
export function isBetterInteractionEntry(candidate: { duration: number; processing: number }, current: { duration: number; processing: number } | undefined): boolean {
  if (!current) return true;
  if (candidate.duration !== current.duration) return candidate.duration > current.duration;
  return candidate.processing > current.processing;
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.split(/[?#]/)[0];
}

export function mapLoafScripts(scripts: readonly LoafScriptLike[] | undefined): LongTaskScript[] | undefined {
  if (!scripts || scripts.length === 0) return undefined;
  const mapped: LongTaskScript[] = [];
  for (const script of scripts) {
    const item: LongTaskScript = {
      invoker: script.invoker || script.invokerType || "unknown",
      duration: round(script.duration ?? 0),
    };
    const sourceURL = stripQuery(script.sourceURL);
    if (sourceURL) item.sourceURL = sourceURL;
    if (script.sourceFunctionName) item.sourceFunctionName = script.sourceFunctionName;
    mapped.push(item);
  }
  mapped.sort((a, b) => b.duration - a.duration);
  return mapped.slice(0, MAX_SCRIPTS);
}

export function longTaskFromEntry(entry: LoafEntryLike, api: LongTaskEvent["api"]): LongTaskEvent {
  const blocking =
    api === "long-animation-frame" && typeof entry.blockingDuration === "number"
      ? entry.blockingDuration
      : Math.max(0, entry.duration - LONG_TASK_BLOCKING_THRESHOLD_MS);
  const event: LongTaskEvent = {
    type: "longtask",
    api,
    duration: round(entry.duration),
    blockingDuration: round(blocking),
    timestamp: entry.startTime,
    eventId: generateEventId(),
    sessionId: getCurrentSessionId(),
  };
  const scripts = api === "long-animation-frame" ? mapLoafScripts(entry.scripts) : undefined;
  if (scripts) event.scripts = scripts;
  const traceId = findTraceActiveAt(entry.startTime);
  if (traceId) event.traceId = traceId;
  return event;
}

export function interactionFromEntry(entry: EventTimingEntryLike): InteractionEvent {
  const processingStart = entry.processingStart ?? entry.startTime;
  const processingEnd = entry.processingEnd ?? processingStart;
  const end = entry.startTime + entry.duration;
  const event: InteractionEvent = {
    type: "interaction",
    name: entry.name,
    interactionId: entry.interactionId ?? 0,
    duration: round(entry.duration),
    inputDelay: round(Math.max(0, processingStart - entry.startTime)),
    processingMs: round(Math.max(0, processingEnd - processingStart)),
    presentationDelay: round(Math.max(0, end - processingEnd)),
    target: describeTarget(entry.target ?? null),
    timestamp: entry.startTime,
    eventId: generateEventId(),
    sessionId: getCurrentSessionId(),
  };
  const traceId = findTraceByTriggerTime(entry.startTime, 50);
  if (traceId) event.traceId = traceId;
  return event;
}

function observe(type: string, options: Record<string, unknown>, onEntries: (entries: PerformanceEntry[]) => void): (() => void) | null {
  try {
    const observer = new PerformanceObserver((list) => {
      try {
        onEntries(list.getEntries());
      } catch {
        // never throw from an observer callback
      }
    });
    observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
    return () => {
      try {
        observer.disconnect();
      } catch {
        // ignore
      }
    };
  } catch {
    return null;
  }
}

/** Starts PerformanceObserver tracking. Idempotent cleanup; no-op without PerformanceObserver. */
export function startPerformanceTracking(options: PerformanceTrackingOptions = {}): () => void {
  const types = supportedEntryTypes();
  if (types.length === 0) return () => undefined;
  const cleanups: Array<() => void> = [];

  if (options.longTasks !== false) {
    if (types.includes("long-animation-frame")) {
      const stop = observe("long-animation-frame", {}, (entries) => {
        for (const entry of entries) {
          pushEvent(longTaskFromEntry(entry as unknown as LoafEntryLike, "long-animation-frame"));
        }
      });
      if (stop) cleanups.push(stop);
    } else if (types.includes("longtask")) {
      const stop = observe("longtask", {}, (entries) => {
        for (const entry of entries) {
          pushEvent(longTaskFromEntry(entry as unknown as LoafEntryLike, "longtask"));
        }
      });
      if (stop) cleanups.push(stop);
    }
  }

  if (options.interactions !== false && types.includes("event")) {
    // One event per interaction: the best entry of each interactionId (isBetterInteractionEntry).
    // Entries of one gesture normally arrive in the same batch, so the choice is made per batch;
    // a better entry arriving in a later batch is still reported.
    const emitted = new Map<number, { duration: number; processing: number }>();
    const threshold = Math.max(16, options.eventDurationThresholdMs ?? 16);
    const stop = observe("event", { durationThreshold: threshold }, (entries) => {
      const batch: EventTimingEntryLike[] = [];
      const bestInBatch = new Map<number, number>(); // interactionId -> index in batch
      for (const raw of entries) {
        const entry = raw as unknown as EventTimingEntryLike;
        const interactionId = entry.interactionId ?? 0;
        if (interactionId <= 0) {
          if (INTERACTION_EVENT_NAMES.has(entry.name)) batch.push(entry);
          continue;
        }
        const score = { duration: entry.duration, processing: processingOf(entry) };
        if (!isBetterInteractionEntry(score, emitted.get(interactionId))) continue;
        emitted.set(interactionId, score);
        if (emitted.size > 500) {
          const oldest = emitted.keys().next().value;
          if (oldest !== undefined) emitted.delete(oldest);
        }
        const at = bestInBatch.get(interactionId);
        if (at === undefined) {
          bestInBatch.set(interactionId, batch.length);
          batch.push(entry);
        } else {
          batch[at] = entry; // better entry of the same interaction replaces it in place
        }
      }
      for (const entry of batch) pushEvent(interactionFromEntry(entry));
    });
    if (stop) cleanups.push(stop);
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const cleanup of cleanups) cleanup();
  };
}
