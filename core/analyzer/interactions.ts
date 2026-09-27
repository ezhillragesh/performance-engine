/**
 * Derived per-interaction measurements shared by rules, budgets and summaries.
 */

import type { InteractionEvent, LongTaskEvent, RenderEvent } from "../types/events.js";
import type { InteractionTrace, RenderCommit } from "./context.js";

/**
 * Event Timing entries grouped by interactionId (keeping the longest); entries
 * without an interactionId are kept individually.
 */
export function groupInteractionTimings(timings: readonly InteractionEvent[]): InteractionEvent[] {
  const indexById = new Map<number, number>();
  const out: (InteractionEvent | null)[] = [];
  const unassigned: number[] = [];
  for (const t of timings) {
    if (t.interactionId > 0) {
      const idx = indexById.get(t.interactionId);
      if (idx === undefined) {
        indexById.set(t.interactionId, out.length);
        out.push(t);
      } else if (t.duration > out[idx]!.duration) {
        out[idx] = t;
      }
    } else {
      unassigned.push(out.length);
      out.push(t);
    }
  }
  // Entries without an interactionId (mousedown/mouseup, …) that overlap a
  // real interaction are part of that gesture, not a separate sample.
  if (unassigned.length > 0 && indexById.size > 0) {
    const spans: [number, number][] = [];
    for (const idx of indexById.values()) {
      const t = out[idx]!;
      spans.push([t.timestamp, t.timestamp + t.duration]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    // maxEnd[i] = latest end among spans[0..i]: "some span starting before x
    // ends after y" becomes one binary search (O(n log n) overall).
    const maxEnd: number[] = [];
    for (let i = 0; i < spans.length; i += 1) maxEnd.push(Math.max(spans[i]![1], i > 0 ? maxEnd[i - 1]! : -Infinity));
    for (const idx of unassigned) {
      const t = out[idx]!;
      const end = t.timestamp + t.duration;
      let lo = 0;
      let hi = spans.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (spans[mid]![0] <= end) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && maxEnd[lo - 1]! >= t.timestamp) out[idx] = null;
    }
  }
  return out.filter((t): t is InteractionEvent => t !== null);
}

/** Threshold the browser uses for long tasks / LoAF blocking time. */
export const LONG_TASK_THRESHOLD_MS = 50;

/**
 * Length of the longest main-thread task represented by a long-task event.
 *
 * A Long Animation Frame (LoAF) entry's `duration` is the whole frame, which
 * can be long without any task blocking the thread (e.g. several short tasks,
 * or a frame whose rendering was merely delayed): `blockingDuration` is the
 * blocking signal — the time tasks spent beyond 50ms. `0` means "no long task"
 * (the frame is not a main-thread block). Long Tasks API entries are tasks.
 */
export function taskLengthMs(task: LongTaskEvent): number {
  if (task.api !== "long-animation-frame") return task.duration;
  if (!(task.blockingDuration > 0)) return 0;
  return Math.min(task.duration, task.blockingDuration + LONG_TASK_THRESHOLD_MS);
}

/** True when the event represents at least one long (blocking) task. */
export function isBlockingTask(task: LongTaskEvent): boolean {
  return taskLengthMs(task) > 0;
}

/** Start of the user's input for latency purposes (browser timestamp when known). */
export function inputStart(trace: InteractionTrace): number {
  const t = trace.committedTrigger;
  return t.domTimestamp ?? t.timestamp;
}

/** First commit at/after the committed trigger, or null. */
export function firstCommitAfterInput(trace: InteractionTrace): RenderCommit | null {
  const start = trace.committedTrigger.timestamp;
  for (const c of trace.commits) {
    if (c.timestamp >= start) return c;
  }
  return null;
}

/**
 * Cost of one render excluding its children. React's `durationMs`
 * (actualDuration) includes the whole rendered subtree, so summing it over a
 * commit counts nested components several times; the self time
 * (`selfDurationMs`) is used whenever instrumentation reports it.
 */
export function renderCost(render: RenderEvent): number {
  if (render.durationMs > 0 && typeof render.selfDurationMs === "number" && Number.isFinite(render.selfDurationMs) && render.selfDurationMs >= 0) {
    return Math.min(render.selfDurationMs, render.durationMs);
  }
  return render.durationMs;
}
