/**
 * Network rule: slow request whose response directly drives renders.
 */

import type { RenderEvent } from "../../types/events.js";
import type { Evidence, Insight, Severity } from "../../types/insights.js";
import type { AnalysisContext } from "../context.js";
import { collapseRendersPerCommit, eventEnd } from "../context.js";
import {
  cascadeRoot,
  createInsight,
  ids,
  renderTime,
  roundMs,
  scaledWeight,
  traceEvidence,
  type AnalysisRule,
  type RuleOptions,
} from "./shared.js";

export const SLOW_REQUEST_MS = 500;
/** Renders committed within this window after responseEnd are response-driven. */
export const RESPONSE_RENDER_WINDOW_MS = 200;
const MIN_RESPONSE_RENDERS = 2;

export const networkBlockingRenderRule: AnalysisRule = {
  name: "network-blocking-render",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const requestBudget = options?.budgets?.networkRequestMs ?? 1000;
    const out: Insight[] = [];
    for (const trace of context.traces) {
      if (trace.networkRequests.length === 0 || trace.renders.length < MIN_RESPONSE_RENDERS) continue;
      const renders = collapseRendersPerCommit(trace.commits);
      for (const req of trace.networkRequests) {
        if (req.duration < SLOW_REQUEST_MS) continue;
        const responseEnd = eventEnd(req);
        const after: RenderEvent[] = [];
        for (const r of renders) {
          if (r.timestamp < responseEnd) continue;
          if (r.timestamp > responseEnd + RESPONSE_RENDER_WINDOW_MS) break;
          after.push(r);
        }
        if (after.length < MIN_RESPONSE_RENDERS) continue;
        const root = cascadeRoot(after);
        const { totalMs, known } = renderTime(after);
        const causal = trace.causal && req.traceId === trace.traceId;
        const evidence: Evidence[] = [
          {
            kind: "measurement",
            label: "Request duration",
            value: roundMs(req.duration),
            unit: "ms",
            threshold: SLOW_REQUEST_MS,
            eventIds: [req.eventId],
            weight: scaledWeight(req.duration, SLOW_REQUEST_MS, 0.3, 0.5, 4),
          },
          {
            kind: "measurement",
            label: `Renders within ${RESPONSE_RENDER_WINDOW_MS}ms after the response`,
            value: after.length,
            unit: "count",
            threshold: MIN_RESPONSE_RENDERS,
            eventIds: ids(after),
            weight: 0.25,
          },
          causal
            ? {
                kind: "correlation",
                label: "Renders attributed to the request trace after the response arrived",
                value: "trace",
                eventIds: [trace.trigger.eventId, req.eventId],
                weight: 0.45,
              }
            : traceEvidence(trace, [req.eventId]),
        ];
        const severity: Severity =
          req.duration >= requestBudget * 2 ? "critical" : req.duration >= requestBudget ? "high" : "medium";
        out.push(
          createInsight({
            issueType: "network-blocking-render",
            category: "network",
            severity,
            source: req.url,
            anchor: req.eventId,
            message: `${req.method} ${req.url} took ${Math.round(req.duration)}ms; ${after.length} render(s) waited for its response.`,
            cause: `Rendering of ${root} depends on the response of ${req.url}, so the UI update is delayed by the full request time.`,
            possibleFix: `Show pending/optimistic UI, cache or prefetch ${req.url} (stale-while-revalidate), or split the response so ${root} can render earlier.`,
            evidence,
            delayMs: req.duration,
            renderCostMs: known ? totalMs : undefined,
            traceId: trace.traceId,
            metadata: {
              renderCount: after.length,
              rootComponent: root,
              affectedComponents: Array.from(new Set(after.map((r) => r.componentName))).slice(0, 10),
              interactionType: trace.committedTrigger.eventType,
              timeWindowStart: req.timestamp,
              timeWindowEnd: responseEnd + RESPONSE_RENDER_WINDOW_MS,
              requestUrl: req.url,
              requestDurationMs: roundMs(req.duration),
            },
          }),
        );
      }
    }
    return out;
  },
};
