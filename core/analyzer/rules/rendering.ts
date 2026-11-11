/**
 * Rendering rules: render bursts, keystroke loops, state thrashing, wasted
 * renders and slow components.
 */

import type { RenderEvent } from "../../types/events.js";
import type { Evidence, Insight, Severity } from "../../types/insights.js";
import type { AnalysisContext, InteractionTrace } from "../context.js";
import { buildCommits, collapseRendersPerCommit, instanceKey } from "../context.js";
import { renderCost } from "../interactions.js";
import { percentile } from "../stats.js";
import {
  affectedComponents,
  cascadeRoot,
  confidenceFromEvidence,
  createInsight,
  ids,
  maxBurst,
  maxSeverity,
  renderTime,
  roundMs,
  scaledWeight,
  severityFromLatency,
  severityFromRatio,
  traceEvidence,
  traceTriggerText,
  type AnalysisRule,
  type RuleOptions,
} from "./shared.js";

/** Cost assumed per render when durations are unknown (flagged as estimate). */
const ESTIMATED_RENDER_MS = 1;

/** One frame at 60Hz: render work below this cannot drop a frame on its own. */
const FRAME_MS = 16;

function minSeverity(a: Severity, b: Severity): Severity {
  return maxSeverity(a, b) === a ? b : a;
}

/**
 * Without timing data (React production builds report no actualDuration /
 * selfBaseDuration; manual tracking without durations) the render cost is
 * unknown, not zero. A render count alone cannot prove a user-visible
 * problem, so count-based render insights are capped here, carry less
 * confidence, and say why.
 */
export const UNKNOWN_COST_MAX_SEVERITY: Severity = "medium";
/** Evidence weights are scaled by this, so confidence (still derived from evidence) drops too. */
export const UNKNOWN_COST_WEIGHT_FACTOR = 0.6;
const UNKNOWN_COST_NOTE =
  "Render timings were unavailable (e.g. a React production build), so the cost is unknown and the severity is based on the render count only.";

/** Applies the unknown-cost cap to an insight built from renders without timings. Id and window are unchanged. */
export function capUnknownRenderCost(insight: Insight): Insight {
  const evidence: Evidence[] = insight.evidence.map((e) => ({ ...e, weight: Math.round(e.weight * UNKNOWN_COST_WEIGHT_FACTOR * 100) / 100 }));
  evidence.push({ kind: "heuristic", label: "Render timings unavailable: severity from render count only", value: "unknown", weight: 0 });
  return {
    ...insight,
    severity: minSeverity(insight.severity, UNKNOWN_COST_MAX_SEVERITY),
    confidence: confidenceFromEvidence(evidence),
    cause: `${insight.cause} ${UNKNOWN_COST_NOTE}`,
    evidence,
    metadata: { ...insight.metadata, renderCostUnknown: true },
  };
}

/** `insight` as is when render timings were measured, else capped (see capUnknownRenderCost). */
function withRenderCost(insight: Insight, known: boolean): Insight {
  return known ? insight : capUnknownRenderCost(insight);
}

/**
 * Severity for render-count rules (bursts, keystroke loops). Without
 * durations (production builds) the count decides. With measured durations
 * the cost does: a cascade that renders in under a quarter frame is low, one
 * under a frame is at most medium however many components it touched, and
 * only frame-dropping cascades escalate (`costFactor` weights keystrokes,
 * which repeat, above one-off clicks).
 */
function renderCountSeverity(countSeverity: Severity, totalMs: number, known: boolean, costFactor: number): Severity {
  if (!known) return countSeverity;
  if (totalMs < FRAME_MS / 4) return "low";
  if (totalMs < FRAME_MS) return minSeverity(countSeverity, "medium");
  return maxSeverity(countSeverity, severityFromLatency(totalMs * costFactor));
}

/**
 * Render-count rules (bursts, keystroke loops) count re-renders only. Mounting
 * the UI an interaction opens (a panel, ten list rows) is its intended effect,
 * not a cascade; the cost of a heavy mount is still reported by the cost-based
 * rules (render latency, slow component, long task). Manual renders without a
 * phase count as re-renders.
 */
function isRerender(render: RenderEvent): boolean {
  return render.phase !== "mount";
}

// ── Rule 1: interaction-induced render burst ─────────────────────────

const BURST_MIN_RENDERS = 6;
const BURST_WINDOW_MS = 160;

export const interactionRenderBurstRule: AnalysisRule = {
  name: "interaction-induced-render-burst",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const out: Insight[] = [];
    const budget = options?.budgets?.rendersPerInteraction ?? 25;
    // Traces already explained as a keystroke render loop (a more specific
    // diagnosis of the same renders) are not reported twice.
    const explained = new Set<string>();
    for (const prior of options?.priorInsights ?? []) {
      if (prior.issueType === "keystroke-render-loop" && prior.traceId) explained.add(prior.traceId);
    }
    for (const trace of context.traces) {
      if (trace.renders.length < BURST_MIN_RENDERS) continue;
      if (explained.has(trace.traceId)) continue;
      const renders = collapseRendersPerCommit(trace.commits).filter(isRerender);
      if (renders.length < BURST_MIN_RENDERS) continue;
      const burst = maxBurst(renders, BURST_WINDOW_MS);
      if (burst.count < BURST_MIN_RENDERS) continue;
      const burstRenders = renders.slice(burst.startIdx, burst.endIdx + 1);
      const first = burstRenders[0]!;
      const last = burstRenders[burstRenders.length - 1]!;
      const spanMs = roundMs(last.timestamp - first.timestamp);
      const { totalMs, known } = renderTime(burstRenders);
      const root = cascadeRoot(burstRenders);
      const affected = affectedComponents(burstRenders, root);

      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: `Renders within ${BURST_WINDOW_MS}ms`,
          value: burst.count,
          unit: "count",
          threshold: BURST_MIN_RENDERS,
          eventIds: ids(burstRenders),
          weight: scaledWeight(burst.count, BURST_MIN_RENDERS, 0.35, 0.6, 4),
        },
        traceEvidence(trace, []),
      ];
      if (known) {
        evidence.push({
          kind: "measurement",
          label: "Measured render time",
          value: roundMs(totalMs),
          unit: "ms",
          threshold: 16,
          weight: totalMs > 16 ? 0.25 : 0.1,
        });
      }
      if (affected.length > 0) {
        evidence.push({
          kind: "correlation",
          label: `Cascade from ${root} into ${affected.length} other component(s)`,
          value: affected.length,
          unit: "count",
          weight: 0.15,
        });
      }

      const countSeverity: Severity = burst.count >= budget * 4 ? "critical" : burst.count >= budget ? "high" : "medium";
      const severity = renderCountSeverity(countSeverity, totalMs, known, 1);
      const cause =
        affected.length > 0
          ? `State update in ${root} propagated to ${affected.length} component(s) (${affected.slice(0, 3).join(", ")}).`
          : `State updates in ${root} triggered ${burst.count} renders in ${spanMs}ms.`;

      out.push(withRenderCost(
        createInsight({
          issueType: "interaction-induced-render-burst",
          category: "rendering",
          severity,
          source: root,
          anchor: trace.trigger.eventId,
          message: `${traceTriggerText(trace)} triggered ${burst.count} renders within ${spanMs}ms.`,
          cause,
          possibleFix: `Move state closer to where it is used, memoize children of ${root} (React.memo/useMemo), or batch the updates.`,
          evidence,
          delayMs: known ? totalMs : burst.count * ESTIMATED_RENDER_MS,
          renderCostMs: known ? totalMs : undefined,
          impactEstimated: !known,
          traceId: trace.traceId,
          metadata: {
            renderCount: burst.count,
            interactionType: trace.committedTrigger.eventType,
            rootComponent: root,
            affectedComponents: affected,
            timeWindowStart: trace.startTime,
            timeWindowEnd: trace.endTime,
          },
        }),
        known,
      ));
    }
    return out;
  },
};

// ── Rule 2: keystroke render loop ────────────────────────────────────

const KEYSTROKE_MIN_RENDERS = 3;
const KEYSTROKE_WINDOW_MS = 120;
const INPUT_TRIGGERS = new Set(["input", "keydown", "change"]);

/**
 * True when the trace's keyboard / input events went to a text-entry target:
 * a keystroke render loop is about typing, not shortcuts on `body` or arrow
 * keys on tab buttons. Uses the `editable` flag captured at event time; events
 * from older engines (no flag) fall back to the target descriptor's tag.
 */
export function isTextEntryTrace(trace: InteractionTrace): boolean {
  let flagged = false;
  for (const u of trace.uiEvents) {
    if (!INPUT_TRIGGERS.has(u.eventType)) continue;
    if (u.editable === true) return true;
    if (u.editable === false) flagged = true;
  }
  if (flagged) return false;
  return trace.uiEvents.some((u) => INPUT_TRIGGERS.has(u.eventType) && /^(input|textarea)(?![\w-])/.test(u.target));
}

export const keystrokeRenderLoopRule: AnalysisRule = {
  name: "keystroke-render-loop",
  run(context: AnalysisContext): Insight[] {
    const out: Insight[] = [];
    for (const trace of context.traces) {
      const trigger = trace.committedTrigger;
      if (!INPUT_TRIGGERS.has(trigger.eventType)) continue;
      if (trace.renders.length < KEYSTROKE_MIN_RENDERS) continue;
      if (!isTextEntryTrace(trace)) continue;
      const renders = collapseRendersPerCommit(trace.commits).filter(
        (r) => isRerender(r) && r.timestamp >= trigger.timestamp && r.timestamp - trigger.timestamp <= KEYSTROKE_WINDOW_MS,
      );
      if (renders.length < KEYSTROKE_MIN_RENDERS) continue;
      const { totalMs, known } = renderTime(renders);
      const root = cascadeRoot(renders);
      const affected = affectedComponents(renders, root);
      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: `Renders within ${KEYSTROKE_WINDOW_MS}ms of the keystroke`,
          value: renders.length,
          unit: "count",
          threshold: KEYSTROKE_MIN_RENDERS,
          eventIds: ids(renders),
          weight: scaledWeight(renders.length, KEYSTROKE_MIN_RENDERS, 0.35, 0.6, 4),
        },
        traceEvidence(trace, []),
      ];
      if (known) {
        evidence.push({
          kind: "measurement",
          label: "Measured render time per keystroke",
          value: roundMs(totalMs),
          unit: "ms",
          threshold: 16,
          weight: totalMs > 16 ? 0.25 : 0.1,
        });
      }
      const countSeverity: Severity = renders.length >= KEYSTROKE_MIN_RENDERS * 3 ? "high" : "medium";
      out.push(withRenderCost(
        createInsight({
          issueType: "keystroke-render-loop",
          category: "rendering",
          severity: renderCountSeverity(countSeverity, totalMs, known, 2),
          source: root,
          anchor: trace.trigger.eventId,
          message: `Input on ${trigger.target} triggered ${renders.length} renders within ${KEYSTROKE_WINDOW_MS}ms.`,
          cause: `Each keystroke updates state in ${root}, re-rendering ${Math.max(1, affected.length)} other component(s).`,
          possibleFix: `Keep the input state local to the field, debounce derived work (useDeferredValue/useTransition), and memoize expensive children of ${root}.`,
          evidence,
          delayMs: known ? totalMs : renders.length * ESTIMATED_RENDER_MS,
          renderCostMs: known ? totalMs : undefined,
          impactEstimated: !known,
          traceId: trace.traceId,
          metadata: {
            renderCount: renders.length,
            interactionType: trigger.eventType,
            rootComponent: root,
            affectedComponents: affected,
            timeWindowStart: trace.startTime,
            timeWindowEnd: trace.endTime,
          },
        }),
        known,
      ));
    }
    return out;
  },
};

// ── Rule 5: state thrashing ──────────────────────────────────────────

const THRASH_MIN_COMMITS = 4;
const THRASH_MAX_GAP_MS = 80;

export const stateThrashingRule: AnalysisRule = {
  name: "state-thrashing",
  run(context: AnalysisContext): Insight[] {
    const out: Insight[] = [];
    // One render per instance per commit, grouped by instance.
    const perInstance = new Map<string, RenderEvent[]>();
    for (const r of collapseRendersPerCommit(buildCommits(context.renders))) {
      const key = instanceKey(r);
      const list = perInstance.get(key);
      if (list) list.push(r);
      else perInstance.set(key, [r]);
    }

    for (const renders of perInstance.values()) {
      if (renders.length < THRASH_MIN_COMMITS) continue;
      let clusterStart = 0;
      for (let i = 1; i <= renders.length; i += 1) {
        const breaks = i === renders.length || renders[i]!.timestamp - renders[i - 1]!.timestamp > THRASH_MAX_GAP_MS;
        if (!breaks) continue;
        const cluster = renders.slice(clusterStart, i);
        clusterStart = i;
        if (cluster.length < THRASH_MIN_COMMITS) continue;
        const insight = thrashInsight(context, cluster);
        if (insight) out.push(insight);
      }
    }
    return out;
  },
};

function thrashInsight(context: AnalysisContext, cluster: RenderEvent[]): Insight | null {
  // Renders paced by separate user inputs (fast typing) are not thrashing:
  // thrashing needs THRASH_MIN_COMMITS renders from one cause (one trace, or
  // untraced background work). Counting distinct traces alone is not enough —
  // e.g. useDeferredValue legitimately renders twice per keystroke.
  const traces = new Set<string>();
  const perCause = new Map<string, number>();
  for (const r of cluster) {
    if (r.traceId) traces.add(r.traceId);
    const cause = r.traceId ?? "";
    perCause.set(cause, (perCause.get(cause) ?? 0) + 1);
  }
  let largestCause = 0;
  for (const n of perCause.values()) if (n > largestCause) largestCause = n;
  if (largestCause < THRASH_MIN_COMMITS) return null;

  // With fiber instrumentation we know *why* each render happened. A child
  // that only re-renders because its thrashing parent does (props changed,
  // own state never changed) is a symptom — the parent gets the insight.
  const instrumented = cluster.some((r) => r.stateChanged !== undefined);
  if (instrumented && !cluster.some((r) => r.stateChanged === true || r.contextChanged === true)) return null;

  const first = cluster[0]!;
  const last = cluster[cluster.length - 1]!;
  const spanMs = last.timestamp - first.timestamp;
  const avgGap = spanMs / (cluster.length - 1);
  const name = first.componentName;
  const { totalMs, known } = renderTime(cluster);
  let stateChanges = 0;
  for (const r of cluster) if (r.stateChanged) stateChanges += 1;

  const evidence: Evidence[] = [
    {
      kind: "measurement",
      label: "Consecutive renders of one instance",
      value: cluster.length,
      unit: "count",
      threshold: THRASH_MIN_COMMITS,
      eventIds: ids(cluster),
      weight: scaledWeight(cluster.length, THRASH_MIN_COMMITS, 0.35, 0.6, 4),
    },
    {
      kind: "measurement",
      label: "Average gap between renders",
      value: roundMs(avgGap),
      unit: "ms",
      threshold: THRASH_MAX_GAP_MS,
      weight: avgGap < THRASH_MAX_GAP_MS / 4 ? 0.3 : 0.15,
    },
  ];
  if (stateChanges > 0) {
    evidence.push({
      kind: "measurement",
      label: "Renders caused by own state change",
      value: stateChanges,
      unit: "count",
      weight: stateChanges >= cluster.length / 2 ? 0.3 : 0.1,
    });
  }
  const traceId = traces.size === 1 ? traces.values().next().value : undefined;
  const trace = traceId ? context.traceById.get(traceId) : undefined;
  if (trace) evidence.push(traceEvidence(trace, []));

  return withRenderCost(createInsight({
    issueType: "state-thrashing",
    category: "rendering",
    severity: severityFromRatio(cluster.length, THRASH_MIN_COMMITS),
    source: name,
    anchor: first.eventId,
    message: `${name} rendered ${cluster.length} times in ${Math.round(spanMs)}ms (~${Math.round(avgGap)}ms apart).`,
    cause: `State in ${name} is set repeatedly in quick succession — typically effects that update state they depend on, or competing setState calls.`,
    possibleFix: `Consolidate updates in ${name} (useReducer or a single setState), guard effects against redundant updates, and derive values instead of syncing them via state.`,
    evidence,
    delayMs: known ? totalMs : cluster.length * ESTIMATED_RENDER_MS,
    renderCostMs: known ? totalMs : undefined,
    impactEstimated: !known,
    traceId: trace ? trace.traceId : undefined,
    metadata: {
      renderCount: cluster.length,
      rootComponent: name,
      affectedComponents: [],
      instanceId: first.instanceId,
      timeWindowStart: first.timestamp,
      timeWindowEnd: last.timestamp,
    },
  }), known);
}

// ── Rule 6: wasted renders ───────────────────────────────────────────

const WASTED_MIN_COUNT = 3;
/** Background (untraced) renders further apart than this start a new scope. */
const BACKGROUND_SCOPE_GAP_MS = 2500;

interface RenderScope {
  anchor: string;
  renders: RenderEvent[];
  trace?: InteractionTrace;
}

function backgroundScopes(renders: readonly RenderEvent[]): RenderScope[] {
  const scopes: RenderScope[] = [];
  let current: RenderScope | null = null;
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const r of renders) {
    if (!current || r.timestamp - lastTs > BACKGROUND_SCOPE_GAP_MS) {
      current = { anchor: r.eventId, renders: [] };
      scopes.push(current);
    }
    current.renders.push(r);
    lastTs = r.timestamp;
  }
  return scopes;
}

/**
 * Count-based when durations are unknown (production builds). With measured
 * durations the cost decides: many re-renders of a trivially cheap component
 * (an icon, a label) are real but not a meaningful performance problem, so
 * they stay "low" until the wasted time reaches one frame (16ms).
 */
const WASTED_FRAME_MS = 16;
function wastedSeverity(count: number, totalMs: number, known: boolean): Severity {
  const byCount = severityFromRatio(count, WASTED_MIN_COUNT * 2);
  if (!known) return byCount;
  const byCost = severityFromLatency(totalMs * 2);
  return totalMs >= WASTED_FRAME_MS ? maxSeverity(byCount, byCost) : byCost;
}

export const wastedRenderRule: AnalysisRule = {
  name: "wasted-render",
  run(context: AnalysisContext): Insight[] {
    if (context.wastedRenderIds.size < WASTED_MIN_COUNT) return [];
    const out: Insight[] = [];
    const scopes: RenderScope[] = context.traces
      .filter((t) => t.renders.length >= WASTED_MIN_COUNT)
      .map((t) => ({ anchor: t.trigger.eventId, renders: t.renders, trace: t }));
    scopes.push(...backgroundScopes(context.untracedRenders));

    for (const scope of scopes) {
      const collapsed = collapseRendersPerCommit(buildCommits(scope.renders));
      const byComponent = new Map<string, { wasted: RenderEvent[]; updates: number; flagged: number }>();
      for (const r of collapsed) {
        if (r.phase === "mount") continue;
        let entry = byComponent.get(r.componentName);
        if (!entry) {
          entry = { wasted: [], updates: 0, flagged: 0 };
          byComponent.set(r.componentName, entry);
        }
        entry.updates += 1;
        if (context.wastedRenderIds.has(r.eventId)) {
          entry.wasted.push(r);
          if (r.wasted === true) entry.flagged += 1;
        }
      }
      for (const [name, entry] of byComponent) {
        const count = entry.wasted.length;
        if (count < WASTED_MIN_COUNT) continue;
        const pct = (count / Math.max(1, entry.updates)) * 100;
        const { totalMs, known } = renderTime(entry.wasted);
        const evidence: Evidence[] = [
          {
            kind: "measurement",
            label: "Re-renders with no prop, state or context change",
            value: count,
            unit: "count",
            threshold: WASTED_MIN_COUNT,
            eventIds: ids(entry.wasted),
            weight: scaledWeight(count, WASTED_MIN_COUNT, 0.3, 0.55, 4),
          },
          entry.flagged > 0
            ? { kind: "measurement", label: "Detected by fiber comparison", value: entry.flagged, unit: "count", weight: 0.4 }
            : { kind: "measurement", label: "Identical props hash", value: count, unit: "count", weight: 0.3 },
          { kind: "measurement", label: "Share of updates that were wasted", value: Math.round(pct), unit: "%", weight: pct >= 50 ? 0.15 : 0.05 },
        ];
        if (scope.trace) evidence.push(traceEvidence(scope.trace, []));
        const first = entry.wasted[0]!;
        const last = entry.wasted[entry.wasted.length - 1]!;
        out.push(withRenderCost(
          createInsight({
            issueType: "wasted-render",
            category: "rendering",
            severity: wastedSeverity(count, totalMs, known),
            source: name,
            anchor: scope.anchor,
            message: `${name} re-rendered ${count} time(s) without any prop, state or context change (${Math.round(pct)}% of its updates).`,
            cause: `${name} re-renders only because its parent rendered; its inputs were identical.`,
            possibleFix: `Wrap ${name} in React.memo and keep the props it receives referentially stable (useMemo/useCallback), or move the parent's changing state below it.`,
            evidence,
            delayMs: known ? totalMs : count * ESTIMATED_RENDER_MS,
            renderCostMs: known ? totalMs : undefined,
            impactEstimated: !known,
            traceId: scope.trace?.traceId,
            metadata: {
              renderCount: count,
              rootComponent: name,
              affectedComponents: [],
              timeWindowStart: first.timestamp,
              timeWindowEnd: last.timestamp,
            },
          }),
          known,
        ));
      }
    }
    return out;
  },
};

// ── slow component ───────────────────────────────────────────────────

export const slowComponentRule: AnalysisRule = {
  name: "slow-component",
  run(context: AnalysisContext, options: RuleOptions): Insight[] {
    const budget = options?.budgets?.componentRenderMs ?? 16;
    const byName = new Map<string, { costs: number[]; over: RenderEvent[]; total: number }>();
    for (const r of context.renders) {
      const cost = renderCost(r);
      if (!(cost > 0)) continue;
      let entry = byName.get(r.componentName);
      if (!entry) {
        entry = { costs: [], over: [], total: 0 };
        byName.set(r.componentName, entry);
      }
      entry.costs.push(cost);
      entry.total += cost;
      if (cost > budget) entry.over.push(r);
    }

    const out: Insight[] = [];
    for (const [name, entry] of byName) {
      if (entry.over.length === 0) continue;
      let maxCost = 0;
      for (const c of entry.costs) if (c > maxCost) maxCost = c;
      if (entry.over.length < 2 && maxCost < budget * 2) continue;
      const p95 = percentile(entry.costs, 95) ?? 0;
      let excess = 0;
      for (const r of entry.over) excess += renderCost(r) - budget;
      const slowest = entry.over.slice().sort((a, b) => renderCost(b) - renderCost(a)).slice(0, 10);
      const evidence: Evidence[] = [
        {
          kind: "measurement",
          label: "Slowest render",
          value: roundMs(maxCost),
          unit: "ms",
          threshold: budget,
          eventIds: ids(slowest),
          weight: scaledWeight(maxCost, budget, 0.35, 0.6, 4),
        },
        { kind: "measurement", label: "p95 render time", value: roundMs(p95), unit: "ms", threshold: budget, weight: p95 > budget ? 0.3 : 0.1 },
        {
          kind: "measurement",
          label: "Renders over budget",
          value: entry.over.length,
          unit: "count",
          weight: Math.min(0.3, 0.05 * entry.over.length),
        },
      ];
      const first = entry.over[0]!;
      const last = entry.over[entry.over.length - 1]!;
      out.push(
        createInsight({
          issueType: "slow-component",
          category: "rendering",
          severity: maxSeverity(severityFromRatio(p95, budget), severityFromRatio(maxCost, budget * 2)),
          source: name,
          anchor: "aggregate",
          message: `${name} exceeded the ${budget}ms render budget ${entry.over.length} time(s) (max ${roundMs(maxCost)}ms, p95 ${roundMs(p95)}ms).`,
          cause: `${name} does expensive work while rendering (large lists, heavy computation or deep subtrees).`,
          possibleFix: `Memoize expensive computations in ${name} (useMemo), virtualize long lists, or split it so less re-renders per update.`,
          evidence,
          delayMs: excess,
          renderCostMs: entry.total,
          metadata: {
            renderCount: entry.costs.length,
            rootComponent: name,
            affectedComponents: [],
            timeWindowStart: first.timestamp,
            timeWindowEnd: last.timestamp,
            p95Ms: roundMs(p95),
            maxMs: roundMs(maxCost),
          },
        }),
      );
    }
    return out;
  },
};
