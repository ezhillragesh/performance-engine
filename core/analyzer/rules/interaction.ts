/**
 * Interaction rules: first-render latency (from the committed trigger) and
 * browser-measured slow interactions (Event Timing).
 */

import type { InteractionEvent, LongTaskEvent, NetworkEvent } from "../../types/events.js";
import type { Evidence, Insight } from "../../types/insights.js";
import type { AnalysisContext } from "../context.js";
import { eventEnd } from "../context.js";
import { firstCommitAfterInput, groupInteractionTimings, inputStart, isBlockingTask, taskLengthMs } from "../interactions.js";
import {
  cascadeRoot,
  createInsight,
  ids,
  renderTime,
  roundMs,
  scaledWeight,
  severityFromLatency,
  traceEvidence,
  traceTriggerText,
  type AnalysisRule,
  type RuleOptions,
} from "./shared.js";

/** Minimum trigger->first-commit delay to report. */
export const RENDER_LATENCY_MIN_MS = 50;
/** A request counts as blocking when it covers this share of the delay. */
const BLOCKING_SHARE = 0.5;

/** Long tasks overlapping [start, end] (longTasks sorted by timestamp). */
export function overlappingLongTasks(longTasks: readonly LongTaskEvent[], start: number, end: number): LongTaskEvent[] {
  const out: LongTaskEvent[] = [];
  // Tasks longer than 10s are not realistic; bound the backwards search.
  let lo = 0;
  let hi = longTasks.length;
  const from = start - 10_000;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (longTasks[mid]!.timestamp < from) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < longTasks.length; i += 1) {
    const t = longTasks[i]!;
    if (t.timestamp > end) break;
    if (t.timestamp + t.duration >= start && isBlockingTask(t)) out.push(t);
  }
  return out;
}

/** Blocked time of `task` inside [start, end]: bounded by the task length, not the frame. */
function overlapMs(task: LongTaskEvent, start: number, end: number): number {
  const frameOverlap = Math.max(0, Math.min(task.timestamp + task.duration, end) - Math.max(task.timestamp, start));
  return Math.min(frameOverlap, taskLengthMs(task));
}

function scriptSummary(tasks: readonly LongTaskEvent[]): string | undefined {
  let best: { name: string; duration: number } | undefined;
  for (const t of tasks) {
    for (const s of t.scripts ?? []) {
      const name = s.sourceFunctionName ? `${s.sourceFunctionName} (${s.invoker})` : s.invoker;
      if (!best || s.duration > best.duration) best = { name, duration: s.duration };
    }
  }
  return best ? `${best.name}, ${Math.round(best.duration)}ms` : undefined;
}

// ── Rule 3: interaction -> first render latency ─────────────────────

export const interactionRenderLatencyRule: AnalysisRule = {
  name: "interaction-render-latency",
  run(context: AnalysisContext): Insight[] {
    const out: Insight[] = [];
    for (const trace of context.traces) {
      const commit = firstCommitAfterInput(trace);
      if (!commit) continue;
      const t0 = inputStart(trace);
      const delay = commit.timestamp - t0;
      if (delay < RENDER_LATENCY_MIN_MS) continue;

      // Blocking request: must have *finished* before the first render.
      let blocking: NetworkEvent | undefined;
      for (const req of trace.networkRequests) {
        const end = eventEnd(req);
        if (req.timestamp < trace.startTime - 1 || end > commit.timestamp) continue;
        if (req.duration < Math.max(RENDER_LATENCY_MIN_MS, delay * BLOCKING_SHARE)) continue;
        if (!blocking || req.duration > blocking.duration) blocking = req;
      }
      const tasks = overlappingLongTasks(context.longTasks, t0, commit.timestamp);
      let blockedMs = 0;
      for (const t of tasks) blockedMs += overlapMs(t, t0, commit.timestamp);

      const root = cascadeRoot(commit.renders);
      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: `Input to first render (${trace.committedTrigger.domTimestamp !== undefined ? "from browser event time" : "from capture time"})`,
          value: roundMs(delay),
          unit: "ms",
          threshold: RENDER_LATENCY_MIN_MS,
          eventIds: [trace.committedTrigger.eventId, ...ids(commit.renders, 10)],
          weight: scaledWeight(delay, RENDER_LATENCY_MIN_MS, 0.35, 0.6, 6),
        },
        traceEvidence(trace, []),
      ];
      if (blocking) {
        evidence.push({
          kind: "correlation",
          label: `Request ${blocking.url} finished before the first render`,
          value: roundMs(blocking.duration),
          unit: "ms",
          eventIds: [blocking.eventId],
          weight: 0.35,
        });
      }
      if (blockedMs > 0) {
        evidence.push({
          kind: "measurement",
          label: "Main thread blocked by long tasks",
          value: roundMs(blockedMs),
          unit: "ms",
          threshold: 50,
          eventIds: ids(tasks),
          weight: blockedMs >= delay * 0.5 ? 0.35 : 0.15,
        });
      }
      const script = scriptSummary(tasks);
      let cause: string;
      let fix: string;
      if (blocking) {
        cause = `The UI waited for ${blocking.url} (${Math.round(blocking.duration)}ms) before ${root} could render.`;
        fix = `Render optimistic/pending UI immediately, prefetch or cache ${blocking.url}, or move the request off the critical path.`;
      } else if (blockedMs > 0) {
        cause = `The main thread was blocked for ${Math.round(blockedMs)}ms by long tasks${script ? ` (${script})` : ""} before ${root} rendered.`;
        fix = "Break up long tasks (yield with scheduler.yield()/setTimeout), defer non-critical work, or move computation to a worker.";
      } else {
        cause = `Synchronous work in the ${trace.committedTrigger.eventType} handler or in rendering ${root} delayed the first update.`;
        fix = `Split heavy work in the handler, defer non-urgent updates with startTransition, or memoize expensive render work in ${root}.`;
      }
      out.push(
        createInsight({
          issueType: "interaction-render-latency",
          category: "interaction",
          severity: severityFromLatency(delay),
          source: trace.committedTrigger.target,
          anchor: trace.trigger.eventId,
          message: `First render after ${traceTriggerText(trace)} took ${Math.round(delay)}ms.`,
          cause,
          possibleFix: fix,
          evidence,
          delayMs: delay,
          renderCostMs: renderTime(trace.renders).known ? renderTime(trace.renders).totalMs : undefined,
          traceId: trace.traceId,
          metadata: {
            renderCount: trace.renders.length,
            interactionType: trace.committedTrigger.eventType,
            rootComponent: root,
            affectedComponents: [],
            timeWindowStart: trace.startTime,
            timeWindowEnd: trace.endTime,
            blockingRequest: blocking?.url,
            longTaskBlockingMs: blockedMs > 0 ? roundMs(blockedMs) : undefined,
          },
        }),
      );
    }
    return out;
  },
};

// ── slow interaction (Event Timing) ──────────────────────────────────

type Phase = "input delay" | "processing" | "presentation";

function dominantPhase(t: InteractionEvent): Phase {
  if (t.inputDelay >= t.processingMs && t.inputDelay >= t.presentationDelay) return "input delay";
  if (t.processingMs >= t.presentationDelay) return "processing";
  return "presentation";
}

export const slowInteractionRule: AnalysisRule = {
  name: "slow-interaction",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const budget = options?.budgets?.interactionLatencyMs ?? 200;
    const out: Insight[] = [];
    for (const timing of groupInteractionTimings(context.interactionTimings)) {
      if (timing.duration <= budget) continue;
      const trace = timing.traceId ? context.traceById.get(timing.traceId) : undefined;
      const end = timing.timestamp + timing.duration;
      const tasks = overlappingLongTasks(context.longTasks, timing.timestamp, end);
      const phase = dominantPhase(timing);
      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: "Interaction latency (Event Timing)",
          value: roundMs(timing.duration),
          unit: "ms",
          threshold: budget,
          eventIds: [timing.eventId],
          weight: scaledWeight(timing.duration, budget, 0.55, 0.75, 3),
        },
        { kind: "measurement", label: "Input delay", value: roundMs(timing.inputDelay), unit: "ms", weight: phase === "input delay" ? 0.1 : 0.02 },
        { kind: "measurement", label: "Processing (event handlers)", value: roundMs(timing.processingMs), unit: "ms", weight: phase === "processing" ? 0.1 : 0.02 },
        { kind: "measurement", label: "Presentation delay", value: roundMs(timing.presentationDelay), unit: "ms", weight: phase === "presentation" ? 0.1 : 0.02 },
      ];
      let root: string | undefined;
      if (trace) {
        evidence.push(traceEvidence(trace, []));
        if (trace.renders.length > 0) {
          root = cascadeRoot(trace.renders);
          evidence.push({
            kind: "correlation",
            label: `Components rendered by this interaction (root ${root})`,
            value: trace.renders.length,
            unit: "count",
            eventIds: ids(trace.renders, 20),
            weight: 0.15,
          });
        }
      }
      const script = scriptSummary(tasks);
      if (tasks.length > 0) {
        evidence.push({
          kind: "correlation",
          label: script ? `Overlapping long task: ${script}` : "Overlapping long tasks",
          value: tasks.length,
          unit: "count",
          eventIds: ids(tasks),
          weight: 0.2,
        });
      }
      let cause: string;
      let fix: string;
      if (phase === "input delay") {
        cause = `The main thread was busy for ${Math.round(timing.inputDelay)}ms before handlers could run${script ? ` (${script})` : ""}.`;
        fix = "Break up long tasks running around user input (yield to the main thread) and defer non-critical work.";
      } else if (phase === "processing") {
        cause = `Event handlers ran for ${Math.round(timing.processingMs)}ms${root ? `, re-rendering from ${root}` : ""}${script ? ` (${script})` : ""}.`;
        fix = `Do less work synchronously in the handler: wrap non-urgent updates in startTransition, debounce, or memoize expensive renders${root ? ` in ${root}` : ""}.`;
      } else {
        cause = `Rendering, style and layout after the handlers took ${Math.round(timing.presentationDelay)}ms before the next frame was presented.`;
        fix = "Reduce DOM size / layout work caused by the update, avoid layout thrashing, and virtualize large lists.";
      }
      const anchor = trace ? trace.trigger.eventId : timing.interactionId > 0 ? `i${timing.interactionId}` : timing.eventId;
      out.push(
        createInsight({
          issueType: "slow-interaction",
          category: "interaction",
          severity: severityFromLatency(timing.duration),
          source: trace ? trace.committedTrigger.target : timing.target,
          anchor,
          message: `${timing.name} on ${timing.target} took ${Math.round(timing.duration)}ms to present the next frame (budget ${budget}ms).`,
          cause,
          possibleFix: fix,
          evidence,
          delayMs: timing.duration - budget,
          traceId: trace?.traceId,
          metadata: {
            interactionType: timing.name,
            rootComponent: root,
            timeWindowStart: timing.timestamp,
            timeWindowEnd: end,
            dominantPhase: phase,
            inputDelayMs: roundMs(timing.inputDelay),
            processingMs: roundMs(timing.processingMs),
            presentationDelayMs: roundMs(timing.presentationDelay),
          },
        }),
      );
    }
    return out;
  },
};
