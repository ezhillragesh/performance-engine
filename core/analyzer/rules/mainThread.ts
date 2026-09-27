/**
 * Main-thread rule: long tasks / long animation frames, grouped per trace
 * (or per background cluster) so a janky interaction yields one insight.
 */

import type { LongTaskEvent } from "../../types/events.js";
import type { Evidence, Insight } from "../../types/insights.js";
import type { AnalysisContext, InteractionTrace } from "../context.js";
import { taskLengthMs } from "../interactions.js";
import {
  createInsight,
  ids,
  roundMs,
  scaledWeight,
  severityFromLatency,
  traceEvidence,
  traceTriggerText,
  type AnalysisRule,
  type RuleOptions,
} from "./shared.js";

const BACKGROUND_GAP_MS = 1000;

interface TaskGroup {
  anchor: string;
  tasks: LongTaskEvent[];
  trace?: InteractionTrace;
}

interface ScriptTotal {
  name: string;
  duration: number;
  eventId: string;
}

function topScripts(tasks: readonly LongTaskEvent[], limit = 3): ScriptTotal[] {
  const byName = new Map<string, ScriptTotal>();
  for (const t of tasks) {
    for (const s of t.scripts ?? []) {
      const base = [s.sourceFunctionName, s.invoker].filter(Boolean).join(" · ");
      const name = s.sourceURL ? `${base} @ ${s.sourceURL}` : base;
      const entry = byName.get(name);
      if (entry) entry.duration += s.duration;
      else byName.set(name, { name, duration: s.duration, eventId: t.eventId });
    }
  }
  return Array.from(byName.values())
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit);
}

export const longTaskRule: AnalysisRule = {
  name: "long-task",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const budget = options?.budgets?.longTaskMs ?? 50;
    const groups: TaskGroup[] = [];
    for (const trace of context.traces) {
      const tasks = trace.longTasks.filter((t) => taskLengthMs(t) >= budget);
      if (tasks.length > 0) groups.push({ anchor: trace.trigger.eventId, tasks, trace });
    }
    let current: TaskGroup | null = null;
    let lastEnd = Number.NEGATIVE_INFINITY;
    for (const t of context.longTasks) {
      if (taskLengthMs(t) < budget) continue;
      if (t.traceId && context.traceById.has(t.traceId)) continue;
      if (!current || t.timestamp - lastEnd > BACKGROUND_GAP_MS) {
        current = { anchor: t.eventId, tasks: [] };
        groups.push(current);
      }
      current.tasks.push(t);
      lastEnd = Math.max(lastEnd, t.timestamp + t.duration);
    }

    const out: Insight[] = [];
    for (const group of groups) {
      let longest = 0;
      let blocking = 0;
      let total = 0;
      for (const t of group.tasks) {
        const length = taskLengthMs(t);
        if (length > longest) longest = length;
        blocking += t.blockingDuration;
        total += length;
      }
      const scripts = topScripts(group.tasks);
      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: "Longest main-thread task",
          value: roundMs(longest),
          unit: "ms",
          threshold: budget,
          eventIds: ids(group.tasks),
          weight: scaledWeight(longest, budget, 0.45, 0.65, 4),
        },
        {
          kind: "measurement",
          label: "Total blocking time",
          value: roundMs(blocking),
          unit: "ms",
          weight: blocking >= 100 ? 0.2 : 0.05,
        },
      ];
      for (const s of scripts) {
        evidence.push({
          kind: "measurement",
          label: `Script: ${s.name}`,
          value: roundMs(s.duration),
          unit: "ms",
          eventIds: [s.eventId],
          weight: 0.1,
        });
      }
      if (group.trace) evidence.push(traceEvidence(group.trace, []));
      const first = group.tasks[0]!;
      const last = group.tasks[group.tasks.length - 1]!;
      const top = scripts[0];
      const where = group.trace ? ` during ${traceTriggerText(group.trace)}` : "";
      out.push(
        createInsight({
          issueType: "long-task",
          category: "main-thread",
          severity: severityFromLatency(longest),
          source: top?.name ?? "main thread",
          anchor: group.anchor,
          message: `${group.tasks.length} long task(s)${where} blocked the main thread (longest ${Math.round(longest)}ms, ${Math.round(blocking)}ms blocking).`,
          cause: top
            ? `Most time was spent in ${top.name} (${Math.round(top.duration)}ms).`
            : "JavaScript, style or layout work ran for longer than 50ms without yielding.",
          possibleFix:
            "Break the work into smaller chunks (scheduler.yield()/setTimeout), defer non-critical work, or move it to a Web Worker.",
          evidence,
          delayMs: blocking,
          traceId: group.trace?.traceId,
          metadata: {
            timeWindowStart: first.timestamp,
            timeWindowEnd: last.timestamp + last.duration,
            longTaskCount: group.tasks.length,
            totalTaskMs: roundMs(total),
            api: first.api,
          },
        }),
      );
    }
    return out;
  },
};
