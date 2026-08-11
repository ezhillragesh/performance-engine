import type { AnalysisContext, RenderChain } from "./context";
import type { NetworkEvent, RenderEvent, TrackedEvent, UIEvent } from "../types/events";
import type { ImpactEstimate, Insight, Severity } from "../types/insights";

export interface AnalysisRule {
  name: string;
  run(context: AnalysisContext): Insight[];
}

// ── Thresholds ───────────────────────────────────────────────────────

const INTERACTION_RENDER_BURST_THRESHOLD = 6;
const INTERACTION_RENDER_BURST_WINDOW_MS = 160;
const INPUT_RENDER_THRESHOLD = 3;
const INPUT_RENDER_WINDOW_MS = 120;
const INTERACTION_RENDER_DELAY_MS = 40;
const INTERACTION_RENDER_DELAY_WINDOW_MS = 1000;
const SLOW_NETWORK_THRESHOLD_MS = 500;
const NETWORK_RENDER_WINDOW_MS = 200;
const NETWORK_RENDER_MIN_COUNT = 2;
const RENDER_COST_MS = 2;
const STATE_THRASH_WINDOW_MS = 300;
const STATE_THRASH_MIN_ALTERNATIONS = 4;
const WASTED_RENDER_MIN_COUNT = 3;
const DEDUPE_BUCKET_MS = 60000;

// ── Shared Helpers ───────────────────────────────────────────────────

interface RenderBurst {
  count: number;
  start: number;
  end: number;
}

function getMaxRenderBurst(renderEvents: RenderEvent[], windowMs: number): RenderBurst | null {
  if (renderEvents.length === 0) {
    return null;
  }

  let maxCount = 0;
  let maxStart = renderEvents[0]!.timestamp;
  let maxEnd = renderEvents[0]!.timestamp;
  let left = 0;

  for (let right = 0; right < renderEvents.length; right += 1) {
    const rightTime = renderEvents[right]!.timestamp;
    while (renderEvents[left] !== undefined && rightTime - renderEvents[left]!.timestamp > windowMs) {
      left += 1;
    }

    const count = right - left + 1;
    if (count > maxCount) {
      maxCount = count;
      maxStart = renderEvents[left]!.timestamp;
      maxEnd = rightTime;
    }
  }

  return { count: maxCount, start: maxStart, end: maxEnd };
}

function summarizeRenderSources(renderEvents: RenderEvent[]): {
  topComponent: string;
  topCount: number;
  componentCount: number;
} {
  const counts = new Map<string, number>();

  for (const event of renderEvents) {
    counts.set(event.componentName, (counts.get(event.componentName) ?? 0) + 1);
  }

  let topComponent = "unknown";
  let topCount = 0;

  for (const [name, count] of counts.entries()) {
    if (count > topCount) {
      topComponent = name;
      topCount = count;
    }
  }

  return { topComponent, topCount, componentCount: counts.size };
}

function clampConfidence(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2));
}

function estimateRenderCost(renderCount: number): number {
  return Math.round(renderCount * RENDER_COST_MS);
}

function buildImpact(estimatedDelayMs: number, renderCount?: number): ImpactEstimate {
  const renderCostMs = typeof renderCount === "number" ? estimateRenderCost(renderCount) : undefined;
  return {
    estimatedDelayMs: Math.max(0, Math.round(estimatedDelayMs)),
    renderCostMs,
  };
}

function getChainOverlap(chain: RenderChain, start: number, end: number): number {
  return Math.max(0, Math.min(chain.end, end) - Math.max(chain.start, start));
}

function selectPrimaryChain(
  chains: RenderChain[],
  start: number,
  end: number,
): RenderChain | null {
  let selected: RenderChain | null = null;
  let bestScore = 0;

  for (const chain of chains) {
    const overlap = getChainOverlap(chain, start, end);
    if (overlap <= 0) continue;

    const score = overlap + chain.renders.length + chain.totalDurationMs * 0.5;
    if (!selected || score > bestScore) {
      selected = chain;
      bestScore = score;
    }
  }

  return selected;
}

function getAffectedComponents(chain: RenderChain | null): string[] {
  if (!chain) return [];

  const affected = new Set<string>();
  for (const render of chain.renders) {
    if (render.componentName !== chain.root.componentName) {
      affected.add(render.componentName);
    }
  }

  return Array.from(affected);
}

function isInputEvent(uiEvent: UIEvent): boolean {
  return uiEvent.eventType === "input" || uiEvent.eventType === "keydown" || uiEvent.eventType === "change";
}

function groupRendersByComponent(events: TrackedEvent[]): Map<string, RenderEvent[]> {
  const map = new Map<string, RenderEvent[]>();
  for (const event of events) {
    if (event.type !== "render") continue;
    const list = map.get(event.componentName);
    if (list) {
      list.push(event);
    } else {
      map.set(event.componentName, [event]);
    }
  }
  return map;
}

function buildDedupeKey(issueType: string, source: string, timestamp: number): string {
  const bucket = Math.floor(timestamp / DEDUPE_BUCKET_MS) * DEDUPE_BUCKET_MS;
  return `${issueType}|${source}|${bucket}`;
}

// ── Rule 1: Interaction-Induced Render Burst ─────────────────────────

export const interactionRenderBurstRule: AnalysisRule = {
  name: "interaction-induced-render-burst",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    for (const interaction of context.interactions) {
      if (interaction.renderEvents.length === 0) continue;

      const burst = getMaxRenderBurst(interaction.renderEvents, INTERACTION_RENDER_BURST_WINDOW_MS);
      if (!burst || burst.count < INTERACTION_RENDER_BURST_THRESHOLD) continue;

      const { topComponent } = summarizeRenderSources(interaction.renderEvents);
      const burstDuration = Math.round(burst.end - burst.start);
      const chain = selectPrimaryChain(interaction.renderChains, burst.start, burst.end);
      const rootComponent = chain?.root.componentName ?? topComponent;
      const affectedComponents = getAffectedComponents(chain);

      const cause =
        affectedComponents.length > 0
          ? `State update in ${rootComponent} propagated to ${affectedComponents.length} component(s) (${affectedComponents.slice(0, 3).join(", ")}).`
          : `State updates in ${rootComponent} triggered ${burst.count} repeated renders in ${burstDuration}ms.`;

      const confidence = clampConfidence(
        0.55 +
          Math.min(0.25, (burst.count - INTERACTION_RENDER_BURST_THRESHOLD) / 10) +
          (affectedComponents.length > 0 ? 0.15 : 0.05),
      );
      const impact = buildImpact(Math.max(burstDuration, estimateRenderCost(burst.count)), burst.count);

      insights.push({
        issueType: "interaction-induced-render-burst",
        severity: "high",
        source: rootComponent,
        message: `User ${interaction.uiEvent.eventType} on ${interaction.uiEvent.target} triggered ${burst.count} renders within ${burstDuration}ms.`,
        cause,
        possibleFix: `Debounce updates in ${rootComponent}, isolate state closer to affected components, or memoize derived values.`,
        confidence,
        impact,
        metadata: {
          renderCount: burst.count,
          interactionType: interaction.uiEvent.eventType,
          rootComponent,
          affectedComponents,
          timeWindowStart: interaction.start,
          timeWindowEnd: interaction.end,
        },
      });
    }

    return insights;
  },
};

// ── Rule 2: Keystroke Render Loop ────────────────────────────────────

export const keystrokeRenderLoopRule: AnalysisRule = {
  name: "keystroke-render-loop",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    for (const interaction of context.interactions) {
      if (!isInputEvent(interaction.uiEvent)) continue;

      const renderEvents = interaction.renderEvents.filter(
        (event) => event.timestamp - interaction.uiEvent.timestamp <= INPUT_RENDER_WINDOW_MS,
      );

      if (renderEvents.length < INPUT_RENDER_THRESHOLD) continue;

      const chain = selectPrimaryChain(interaction.renderChains, interaction.start, interaction.end);
      const rootComponent = chain?.root.componentName ?? renderEvents[0]!.componentName;
      const affectedComponents = getAffectedComponents(chain);
      const confidence = clampConfidence(
        0.6 + Math.min(0.3, renderEvents.length / 10) + (affectedComponents.length > 0 ? 0.1 : 0),
      );
      const impact = buildImpact(
        Math.max(INPUT_RENDER_WINDOW_MS, estimateRenderCost(renderEvents.length)),
        renderEvents.length,
      );

      insights.push({
        issueType: "keystroke-render-loop",
        severity: "high",
        source: rootComponent,
        message: `Input on ${interaction.uiEvent.target} triggered ${renderEvents.length} renders within ${INPUT_RENDER_WINDOW_MS}ms.`,
        cause: `Input handler updates state in ${rootComponent} on every keystroke, propagating renders to ${Math.max(1, affectedComponents.length)} component(s).`,
        possibleFix: `Debounce input updates in ${rootComponent} and isolate state from unrelated components.`,
        confidence,
        impact,
        metadata: {
          renderCount: renderEvents.length,
          interactionType: interaction.uiEvent.eventType,
          rootComponent,
          affectedComponents,
          timeWindowStart: interaction.start,
          timeWindowEnd: interaction.end,
        },
      });
    }

    return insights;
  },
};

// ── Rule 3: Interaction-Render Latency ───────────────────────────────

export const interactionRenderLatencyRule: AnalysisRule = {
  name: "interaction-render-latency",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    for (const interaction of context.interactions) {
      const windowStart = interaction.uiEvent.timestamp;
      const firstRender =
        interaction.renderEvents.find((event) => event.timestamp >= windowStart) ?? null;

      if (!firstRender) continue;

      const delay = Math.round(firstRender.timestamp - windowStart);
      if (delay < INTERACTION_RENDER_DELAY_MS) continue;
      if (delay > INTERACTION_RENDER_DELAY_WINDOW_MS) continue;

      const blockingNetwork = interaction.networkEvents.find(
        (event) =>
          event.timestamp >= windowStart &&
          event.timestamp <= firstRender.timestamp &&
          event.duration > SLOW_NETWORK_THRESHOLD_MS,
      );

      const chain = selectPrimaryChain(interaction.renderChains, interaction.start, interaction.end);
      const rootComponent = chain?.root.componentName ?? firstRender.componentName;
      const affectedComponents = getAffectedComponents(chain);

      const cause = blockingNetwork
        ? `UI update waited for ${blockingNetwork.url} (${blockingNetwork.duration}ms) before ${rootComponent} could render.`
        : `Interaction handler in ${rootComponent} performed synchronous work before the first render.`;

      const possibleFix = blockingNetwork
        ? `Use optimistic updates in ${rootComponent}, cache ${blockingNetwork.url}, or move the request off the critical path.`
        : `Split heavy work in ${rootComponent}, defer non-critical updates, or move computation off the main thread.`;

      const confidence = clampConfidence(
        blockingNetwork ? 0.82 : 0.55 + Math.min(0.25, delay / 300),
      );
      const renderCount = interaction.renderEvents.length;
      const impact = buildImpact(
        Math.max(delay, blockingNetwork?.duration ?? 0),
        renderCount > 0 ? renderCount : undefined,
      );

      const severity: Severity = delay > 250 ? "high" : "medium";

      insights.push({
        issueType: "interaction-render-latency",
        severity,
        source: interaction.uiEvent.target,
        message: `First render after ${interaction.uiEvent.eventType} took ${delay}ms.`,
        cause,
        possibleFix,
        confidence,
        impact,
        metadata: {
          renderCount,
          interactionType: interaction.uiEvent.eventType,
          rootComponent,
          affectedComponents,
          timeWindowStart: interaction.start,
          timeWindowEnd: interaction.end,
        },
      });
    }

    return insights;
  },
};

// ── Rule 4: Network-Blocking Render ──────────────────────────────────

export const networkBlockingRenderRule: AnalysisRule = {
  name: "network-blocking-render",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    const networkEvents = context.events.filter(
      (e): e is NetworkEvent => e.type === "network" && e.duration > SLOW_NETWORK_THRESHOLD_MS,
    );

    const renderEvents = context.events.filter(
      (e): e is RenderEvent => e.type === "render",
    );

    for (const netEvent of networkEvents) {
      const windowEnd = netEvent.timestamp + NETWORK_RENDER_WINDOW_MS;

      const matchingRenders: RenderEvent[] = [];
      for (const r of renderEvents) {
        if (r.timestamp < netEvent.timestamp) continue;
        if (r.timestamp > windowEnd) break;
        matchingRenders.push(r);
      }

      if (matchingRenders.length < NETWORK_RENDER_MIN_COUNT) continue;

      const chain = selectPrimaryChain(context.allRenderChains, netEvent.timestamp, windowEnd);
      const rootComponent = chain?.root.componentName ?? summarizeRenderSources(matchingRenders).topComponent;
      const affectedComponents = getAffectedComponents(chain);
      const confidence = clampConfidence(
        0.65 + Math.min(0.2, netEvent.duration / 1500) + Math.min(0.15, matchingRenders.length / 6),
      );
      const impact = buildImpact(netEvent.duration, matchingRenders.length);

      insights.push({
        issueType: "network-blocking-render",
        severity: "high",
        source: netEvent.url,
        message: `Slow request (${netEvent.duration}ms) was followed by ${matchingRenders.length} renders within ${NETWORK_RENDER_WINDOW_MS}ms.`,
        cause: `Render chain rooted at ${rootComponent} started immediately after ${netEvent.url} responded, indicating a critical dependency.`,
        possibleFix: `Cache or prefetch ${netEvent.url}, or decouple ${rootComponent} rendering from the response.`,
        confidence,
        impact,
        metadata: {
          renderCount: matchingRenders.length,
          rootComponent,
          affectedComponents,
          timeWindowStart: netEvent.timestamp,
          timeWindowEnd: windowEnd,
        },
      });
    }

    return insights;
  },
};

// ── Rule 5: State Thrashing Detection (NEW) ──────────────────────────

export const stateThrashingRule: AnalysisRule = {
  name: "state-thrashing",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];
    const rendersByComponent = groupRendersByComponent(context.events);

    for (const [componentName, renders] of rendersByComponent.entries()) {
      if (renders.length < STATE_THRASH_MIN_ALTERNATIONS) continue;

      let left = 0;
      for (let right = STATE_THRASH_MIN_ALTERNATIONS - 1; right < renders.length; right += 1) {
        const leftRender = renders[left]!;
        const rightRender = renders[right]!;
        const windowDuration = rightRender.timestamp - leftRender.timestamp;

        if (windowDuration <= STATE_THRASH_WINDOW_MS) {
          const count = right - left + 1;
          const avgGap = windowDuration / (count - 1);

          if (avgGap < 80) {
            const confidence = clampConfidence(
              0.5 + Math.min(0.3, count / 12) + Math.min(0.2, 1 - avgGap / 80),
            );

            insights.push({
              issueType: "state-thrashing",
              severity: count >= 8 ? "high" : "medium",
              source: componentName,
              message: `${componentName} rendered ${count} times in ${Math.round(windowDuration)}ms with ~${Math.round(avgGap)}ms between renders.`,
              cause: `State in ${componentName} is being set rapidly in alternation, likely from competing effects or unguarded setState calls.`,
              possibleFix: `Consolidate state updates in ${componentName} using useReducer, batch updates, or add guards to prevent redundant setState calls.`,
              confidence,
              impact: buildImpact(windowDuration, count),
              metadata: {
                renderCount: count,
                rootComponent: componentName,
                affectedComponents: [],
                timeWindowStart: leftRender.timestamp,
                timeWindowEnd: rightRender.timestamp,
                dedupeKey: buildDedupeKey("state-thrashing", componentName, leftRender.timestamp),
              },
            });

            left = right + 1;
          }
        }

        while (left < right && renders[right]!.timestamp - renders[left]!.timestamp > STATE_THRASH_WINDOW_MS) {
          left += 1;
        }
      }
    }

    return insights;
  },
};

// ── Rule 6: Wasted Render Detection (NEW) ────────────────────────────

export const wastedRenderRule: AnalysisRule = {
  name: "wasted-render",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];
    const rendersByComponent = groupRendersByComponent(context.events);

    for (const [componentName, renders] of rendersByComponent.entries()) {
      if (renders.length < WASTED_RENDER_MIN_COUNT) continue;

      let wastedCount = 0;
      let firstWasted: number | undefined;
      let lastWasted: number | undefined;

      for (let i = 1; i < renders.length; i += 1) {
        const prev = renders[i - 1]!;
        const curr = renders[i]!;

        const isWasted =
          curr.propsHash !== undefined &&
          curr.prevPropsHash !== undefined &&
          curr.propsHash === curr.prevPropsHash;

        const isLikelyWasted =
          !isWasted &&
          curr.durationMs === 0 &&
          prev.durationMs === 0 &&
          curr.timestamp - prev.timestamp < 50;

        if (isWasted || isLikelyWasted) {
          wastedCount += 1;
          if (firstWasted === undefined) firstWasted = curr.timestamp;
          lastWasted = curr.timestamp;
        }
      }

      if (wastedCount < WASTED_RENDER_MIN_COUNT) continue;

      const confidence = clampConfidence(
        0.45 + Math.min(0.35, wastedCount / 10) +
          (renders.some((r) => r.propsHash !== undefined) ? 0.2 : 0),
      );

      insights.push({
        issueType: "wasted-render",
        severity: wastedCount >= 6 ? "high" : "medium",
        source: componentName,
        message: `${componentName} had ${wastedCount} wasted render(s) out of ${renders.length} total.`,
        cause: `${componentName} re-rendered without meaningful prop or state changes, wasting CPU cycles.`,
        possibleFix: `Wrap ${componentName} with React.memo, use useMemo for derived values, or add shallow-equality checks to prevent unnecessary re-renders.`,
        confidence,
        impact: buildImpact(estimateRenderCost(wastedCount), wastedCount),
        metadata: {
          renderCount: wastedCount,
          rootComponent: componentName,
          affectedComponents: [],
          timeWindowStart: firstWasted,
          timeWindowEnd: lastWasted,
          dedupeKey: buildDedupeKey("wasted-render", componentName, firstWasted ?? 0),
        },
      });
    }

    return insights;
  },
};

// ── Default rule set ─────────────────────────────────────────────────

export const defaultRules: AnalysisRule[] = [
  interactionRenderBurstRule,
  keystrokeRenderLoopRule,
  interactionRenderLatencyRule,
  networkBlockingRenderRule,
  stateThrashingRule,
  wastedRenderRule,
];
