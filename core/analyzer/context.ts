import type { NetworkEvent, RenderEvent, TrackedEvent, UIEvent } from "../types/events";

export interface RenderChain {
  root: RenderEvent;
  renders: RenderEvent[];
  start: number;
  end: number;
  totalDurationMs: number;
}

export interface InteractionWindow {
  uiEvent: UIEvent;
  start: number;
  end: number;
  events: TrackedEvent[];
  renderEvents: RenderEvent[];
  networkEvents: NetworkEvent[];
  renderChains: RenderChain[];
  chained: boolean;
}

export interface AnalysisContext {
  events: TrackedEvent[];
  interactions: InteractionWindow[];
  allRenderChains: RenderChain[];
}

const DEFAULT_INTERACTION_WINDOW_MS = 300;
const INTERACTION_IDLE_THRESHOLD_MS = 120;
const MAX_INTERACTION_WINDOW_MS = 2000;
const RENDER_CHAIN_GAP_MS = 24;
const CHAINED_INTERACTION_GAP_MS = 80;

function finaliseChain(renders: RenderEvent[]): RenderChain {
  const totalDurationMs = renders.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    root: renders[0]!,
    renders,
    start: renders[0]!.timestamp,
    end: renders[renders.length - 1]!.timestamp,
    totalDurationMs,
  };
}

function buildRenderChains(renderEvents: RenderEvent[]): RenderChain[] {
  if (renderEvents.length === 0) {
    return [];
  }

  const chains: RenderChain[] = [];
  let current: RenderEvent[] = [renderEvents[0]!];

  for (let i = 1; i < renderEvents.length; i += 1) {
    const previous = renderEvents[i - 1]!;
    const next = renderEvents[i]!;
    if (next.timestamp - previous.timestamp <= RENDER_CHAIN_GAP_MS) {
      current.push(next);
      continue;
    }
    chains.push(finaliseChain(current));
    current = [next];
  }

  chains.push(finaliseChain(current));
  return chains;
}

function isChainedInteraction(a: UIEvent, b: UIEvent): boolean {
  return b.timestamp - a.timestamp <= CHAINED_INTERACTION_GAP_MS;
}

export function buildAnalysisContext(
  events: TrackedEvent[],
  interactionWindowMs: number = DEFAULT_INTERACTION_WINDOW_MS,
): AnalysisContext {
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const uiEvents = sortedEvents.filter((event): event is UIEvent => event.type === "ui");
  const interactions: InteractionWindow[] = [];

  let startIdx = 0;
  let endIdx = 0;

  for (let uiIdx = 0; uiIdx < uiEvents.length; uiIdx += 1) {
    const uiEvent = uiEvents[uiIdx]!;
    const windowStart = uiEvent.timestamp;
    let windowEnd = uiEvent.timestamp + interactionWindowMs;

    const prevUi = uiIdx > 0 ? uiEvents[uiIdx - 1] : undefined;
    const chained = prevUi !== undefined && isChainedInteraction(prevUi, uiEvent);

    while (startIdx < sortedEvents.length && sortedEvents[startIdx]!.timestamp < windowStart) {
      startIdx += 1;
    }

    if (endIdx < startIdx) {
      endIdx = startIdx;
    }

    let lastActivity = windowStart;
    while (endIdx < sortedEvents.length && sortedEvents[endIdx]!.timestamp <= windowEnd) {
      lastActivity = sortedEvents[endIdx]!.timestamp;
      endIdx += 1;
      const extendedEnd = lastActivity + INTERACTION_IDLE_THRESHOLD_MS;
      if (extendedEnd > windowEnd) {
        windowEnd = Math.min(windowStart + MAX_INTERACTION_WINDOW_MS, extendedEnd);
      }
    }

    const windowEvents = sortedEvents.slice(startIdx, endIdx);
    const renderEvents = windowEvents.filter(
      (event): event is RenderEvent => event.type === "render",
    );
    const networkEvents = windowEvents.filter(
      (event): event is NetworkEvent => event.type === "network",
    );
    const renderChains = buildRenderChains(renderEvents);

    interactions.push({
      uiEvent,
      start: windowStart,
      end: windowEnd,
      events: windowEvents,
      renderEvents,
      networkEvents,
      renderChains,
      chained,
    });
  }

  const chainSet = new Map<number, RenderChain>();
  for (const interaction of interactions) {
    for (const chain of interaction.renderChains) {
      if (!chainSet.has(chain.start)) {
        chainSet.set(chain.start, chain);
      }
    }
  }

  return {
    events: sortedEvents,
    interactions,
    allRenderChains: Array.from(chainSet.values()),
  };
}
