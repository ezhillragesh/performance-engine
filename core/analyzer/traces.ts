/**
 * Trace summaries: an interaction and everything it caused, as a span tree
 * ready to visualise.
 *
 * Parenting: longtask/network spans -> interaction; a commit span -> the
 * latest request of the trace whose response ended before the commit (the
 * response caused it), else -> interaction; render spans -> their commit.
 */

import type { NetworkEvent } from "../types/events.js";
import type { Insight, TraceSpan, TraceSummary } from "../types/insights.js";
import type { AnalysisContext, InteractionTrace } from "./context.js";
import { eventEnd } from "./context.js";
import { groupInteractionTimings, isBlockingTask, taskLengthMs } from "./interactions.js";

/** Render spans per trace are capped to bound snapshot size. */
const MAX_RENDER_SPANS = 200;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function spansFor(trace: InteractionTrace, latencyMs: number | undefined): { spans: TraceSpan[]; end: number } {
  const spans: TraceSpan[] = [];
  const rootId = `${trace.traceId}:interaction`;
  const trigger = trace.trigger;
  const start = Math.min(trigger.domTimestamp ?? trigger.timestamp, trace.startTime);
  let end = trace.endTime;
  if (latencyMs !== undefined) end = Math.max(end, start + latencyMs);

  const root: TraceSpan = {
    id: rootId,
    kind: "interaction",
    label: `${trace.committedTrigger.eventType} ${trace.committedTrigger.label ?? trace.committedTrigger.target}`,
    start: round(start),
    end: round(end),
    eventId: trigger.eventId,
    detail: trace.committedTrigger.target,
  };
  spans.push(root);

  for (const task of trace.longTasks) {
    // A long frame without a blocking task is not a long task (see taskLengthMs).
    if (!isBlockingTask(task)) continue;
    const top = task.scripts?.[0];
    spans.push({
      id: `${trace.traceId}:lt:${task.eventId}`,
      kind: "longtask",
      label: `Long task ${Math.round(taskLengthMs(task))}ms`,
      start: round(task.timestamp),
      end: round(task.timestamp + task.duration),
      parentId: rootId,
      eventId: task.eventId,
      detail: top ? top.sourceFunctionName ?? top.invoker : undefined,
    });
  }

  const requests: { req: NetworkEvent; spanId: string; end: number }[] = [];
  for (const req of trace.networkRequests) {
    const spanId = `${trace.traceId}:net:${req.eventId}`;
    const reqEnd = eventEnd(req);
    requests.push({ req, spanId, end: reqEnd });
    spans.push({
      id: spanId,
      kind: "network",
      label: `${req.method} ${req.url}`,
      start: round(req.timestamp),
      end: round(reqEnd),
      parentId: rootId,
      eventId: req.eventId,
      detail: `${req.status}${req.error ? ` ${req.error}` : ""} · ${Math.round(req.duration)}ms`,
    });
  }
  requests.sort((a, b) => a.end - b.end);

  let renderSpans = 0;
  for (const commit of trace.commits) {
    let parentId = rootId;
    for (const r of requests) {
      if (r.end <= commit.timestamp) parentId = r.spanId;
      else break;
    }
    const commitId = `${trace.traceId}:commit:${commit.key}`;
    spans.push({
      id: commitId,
      kind: "commit",
      label: `Commit (${commit.renders.length} render${commit.renders.length === 1 ? "" : "s"})`,
      start: round(commit.timestamp),
      end: round(commit.commitTime),
      parentId,
      detail: commit.commitId !== undefined ? `commit #${commit.commitId}` : undefined,
    });
    for (const r of commit.renders) {
      if (renderSpans >= MAX_RENDER_SPANS) break;
      renderSpans += 1;
      spans.push({
        id: `${trace.traceId}:render:${r.eventId}`,
        kind: "render",
        label: r.componentName,
        start: round(r.timestamp),
        end: round(r.timestamp + r.durationMs),
        parentId: commitId,
        eventId: r.eventId,
        detail: r.wasted ? "wasted" : r.phase,
      });
    }
  }
  return { spans, end };
}

/** Maps insights to traces via `traceId`, `metadata.traceId` and evidence event ids. */
function insightIdsByTrace(traces: readonly InteractionTrace[], insights: readonly Insight[]): Map<string, string[]> {
  const eventTrace = new Map<string, string>();
  for (const trace of traces) {
    for (const e of trace.events) eventTrace.set(e.eventId, trace.traceId);
  }
  const out = new Map<string, string[]>();
  const add = (traceId: string, insightId: string): void => {
    const list = out.get(traceId);
    if (!list) out.set(traceId, [insightId]);
    else if (!list.includes(insightId)) list.push(insightId);
  };
  for (const insight of insights) {
    const direct = insight.traceId ?? (typeof insight.metadata?.traceId === "string" ? insight.metadata.traceId : undefined);
    if (direct) add(direct, insight.id);
    for (const ev of insight.evidence ?? []) {
      for (const id of ev.eventIds ?? []) {
        const traceId = eventTrace.get(id);
        if (traceId) add(traceId, insight.id);
      }
    }
  }
  return out;
}

/** Summaries of the most recent `limit` traces (all by default), oldest first. */
export function buildTraceSummaries(
  context: AnalysisContext,
  insights: readonly Insight[] = [],
  limit: number = Number.POSITIVE_INFINITY,
): TraceSummary[] {
  const traces = limit < context.traces.length ? context.traces.slice(context.traces.length - Math.max(0, limit)) : context.traces;
  const byTrace = insightIdsByTrace(traces, insights);
  const summaries: TraceSummary[] = [];
  for (const trace of traces) {
    const timings = groupInteractionTimings(trace.interactionTimings);
    let latencyMs: number | undefined;
    for (const t of timings) if (latencyMs === undefined || t.duration > latencyMs) latencyMs = t.duration;
    const { spans, end } = spansFor(trace, latencyMs);
    const start = spans[0]!.start;
    let longTaskMs = 0;
    for (const t of trace.longTasks) longTaskMs += taskLengthMs(t);
    const components: string[] = [];
    const seen = new Set<string>();
    for (const r of trace.renders) {
      if (!seen.has(r.componentName)) {
        seen.add(r.componentName);
        components.push(r.componentName);
      }
    }
    const summary: TraceSummary = {
      traceId: trace.traceId,
      trigger: {
        eventType: trace.committedTrigger.eventType,
        target: trace.committedTrigger.target,
        timestamp: trace.trigger.timestamp,
      },
      start,
      end: round(end),
      durationMs: round(end - start),
      renderCount: trace.renders.length,
      networkCount: trace.networkRequests.length,
      longTaskMs: round(longTaskMs),
      components,
      eventIds: trace.events.map((e) => e.eventId),
      insightIds: byTrace.get(trace.traceId) ?? [],
      spans,
    };
    if (trace.committedTrigger.label !== undefined) summary.trigger.label = trace.committedTrigger.label;
    if (latencyMs !== undefined) summary.latencyMs = round(latencyMs);
    summaries.push(summary);
  }
  return summaries;
}
