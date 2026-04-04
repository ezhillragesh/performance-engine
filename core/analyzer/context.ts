import type { NetworkEvent, RenderEvent, TrackedEvent, UIEvent } from "../types/events";

export interface InteractionWindow {
  uiEvent: UIEvent;
  start: number;
  end: number;
  events: TrackedEvent[];
  renderEvents: RenderEvent[];
  networkEvents: NetworkEvent[];
}

export interface AnalysisContext {
  events: TrackedEvent[];
  interactions: InteractionWindow[];
}

const DEFAULT_INTERACTION_WINDOW_MS = 300;

export function buildAnalysisContext(
  events: TrackedEvent[],
  interactionWindowMs: number = DEFAULT_INTERACTION_WINDOW_MS,
): AnalysisContext {
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const uiEvents = sortedEvents.filter((event): event is UIEvent => event.type === "ui");
  const interactions: InteractionWindow[] = [];

  let startIdx = 0;
  let endIdx = 0;

  for (const uiEvent of uiEvents) {
    const windowStart = uiEvent.timestamp;
    const windowEnd = uiEvent.timestamp + interactionWindowMs;

    while (startIdx < sortedEvents.length && sortedEvents[startIdx].timestamp < windowStart) {
      startIdx += 1;
    }

    if (endIdx < startIdx) {
      endIdx = startIdx;
    }

    while (endIdx < sortedEvents.length && sortedEvents[endIdx].timestamp <= windowEnd) {
      endIdx += 1;
    }

    const windowEvents = sortedEvents.slice(startIdx, endIdx);
    const renderEvents = windowEvents.filter(
      (event): event is RenderEvent => event.type === "render",
    );
    const networkEvents = windowEvents.filter(
      (event): event is NetworkEvent => event.type === "network",
    );

    interactions.push({
      uiEvent,
      start: windowStart,
      end: windowEnd,
      events: windowEvents,
      renderEvents,
      networkEvents,
    });
  }

  return { events: sortedEvents, interactions };
}
