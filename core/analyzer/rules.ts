import type { AnalysisContext } from "./context";
import type { NetworkEvent, RenderEvent, TrackedEvent, UIEvent } from "../types/events";
import type { Insight } from "../types/insights";

export interface AnalysisRule {
  name: string;
  run(context: AnalysisContext): Insight[];
}

const INTERACTION_RENDER_BURST_THRESHOLD = 12;
const INTERACTION_RENDER_BURST_WINDOW_MS = 100;
const INPUT_RENDER_THRESHOLD = 6;
const INPUT_RENDER_WINDOW_MS = 80;
const INTERACTION_RENDER_DELAY_MS = 120;
const INTERACTION_RENDER_DELAY_WINDOW_MS = 1000;
const SLOW_NETWORK_THRESHOLD_MS = 500;
const NETWORK_RENDER_WINDOW_MS = 200;

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
  let maxStart = renderEvents[0].timestamp;
  let maxEnd = renderEvents[0].timestamp;

  let left = 0;
  for (let right = 0; right < renderEvents.length; right += 1) {
    const rightTime = renderEvents[right].timestamp;
    while (rightTime - renderEvents[left].timestamp > windowMs) {
      left += 1;
    }

    const count = right - left + 1;
    if (count > maxCount) {
      maxCount = count;
      maxStart = renderEvents[left].timestamp;
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

  for (const [componentName, count] of counts.entries()) {
    if (count > topCount) {
      topComponent = componentName;
      topCount = count;
    }
  }

  return { topComponent, topCount, componentCount: counts.size };
}

function findFirstRenderAfter(
  events: TrackedEvent[],
  timestamp: number,
  maxDelayMs: number,
): RenderEvent | null {
  for (const event of events) {
    if (event.timestamp < timestamp) {
      continue;
    }

    if (event.timestamp - timestamp > maxDelayMs) {
      return null;
    }

    if (event.type === "render") {
      return event;
    }
  }

  return null;
}

function findSlowNetworkBetween(
  events: TrackedEvent[],
  start: number,
  end: number,
): NetworkEvent | null {
  for (const event of events) {
    if (event.timestamp < start) {
      continue;
    }

    if (event.timestamp > end) {
      return null;
    }

    if (event.type === "network" && event.duration > SLOW_NETWORK_THRESHOLD_MS) {
      return event;
    }
  }

  return null;
}

function isInputEvent(uiEvent: UIEvent): boolean {
  return uiEvent.eventType === "input" || uiEvent.eventType === "keydown" || uiEvent.eventType === "change";
}

export const interactionRenderBurstRule: AnalysisRule = {
  name: "interaction-induced-render-burst",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    for (const interaction of context.interactions) {
      if (interaction.renderEvents.length === 0) {
        continue;
      }

      const burst = getMaxRenderBurst(interaction.renderEvents, INTERACTION_RENDER_BURST_WINDOW_MS);
      if (!burst || burst.count < INTERACTION_RENDER_BURST_THRESHOLD) {
        continue;
      }

      const { topComponent, componentCount } = summarizeRenderSources(interaction.renderEvents);
      const burstDuration = Math.round(burst.end - burst.start);

      const cause =
        componentCount > 1
          ? "Parent state updates propagated across multiple components after the interaction."
          : `Repeated state updates inside ${topComponent} cascaded into rapid re-renders.`;

      insights.push({
        issueType: "interaction-induced-render-burst",
        severity: "high",
        source: topComponent,
        message: `User ${interaction.uiEvent.eventType} on ${interaction.uiEvent.target} triggered ${burst.count} renders within ${burstDuration}ms.`,
        cause,
        possibleFix: "Debounce updates, isolate state closer to the leaf component, or memoize derived values.",
      });
    }

    return insights;
  },
};

export const keystrokeRenderLoopRule: AnalysisRule = {
  name: "keystroke-render-loop",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];

    for (const interaction of context.interactions) {
      if (!isInputEvent(interaction.uiEvent)) {
        continue;
      }

      const renderEvents = interaction.renderEvents.filter(
        (event) => event.timestamp - interaction.uiEvent.timestamp <= INPUT_RENDER_WINDOW_MS,
      );

      if (renderEvents.length < INPUT_RENDER_THRESHOLD) {
        continue;
      }

      const { topComponent } = summarizeRenderSources(renderEvents);

      insights.push({
        issueType: "keystroke-render-loop",
        severity: "high",
        source: topComponent,
        message: `Input on ${interaction.uiEvent.target} triggered ${renderEvents.length} renders within ${INPUT_RENDER_WINDOW_MS}ms.`,
        cause: "Each keystroke triggers immediate state updates without debouncing, causing a render loop.",
        possibleFix: "Debounce input handlers, buffer state updates, or move state down to the input component.",
      });
    }

    return insights;
  },
};

export const interactionRenderLatencyRule: AnalysisRule = {
  name: "interaction-render-latency",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];
    const sortedEvents = context.events;

    for (const interaction of context.interactions) {
      const firstRender = findFirstRenderAfter(
        sortedEvents,
        interaction.uiEvent.timestamp,
        INTERACTION_RENDER_DELAY_WINDOW_MS,
      );

      if (!firstRender) {
        continue;
      }

      const delay = Math.round(firstRender.timestamp - interaction.uiEvent.timestamp);
      if (delay < INTERACTION_RENDER_DELAY_MS) {
        continue;
      }

      const blockingNetwork = findSlowNetworkBetween(
        sortedEvents,
        interaction.uiEvent.timestamp,
        firstRender.timestamp,
      );

      const cause = blockingNetwork
        ? `UI update waited for a slow network response from ${blockingNetwork.url}.`
        : "Interaction handler performed synchronous work before triggering a render.";

      const possibleFix = blockingNetwork
        ? "Use optimistic UI updates, cache responses, or move the request off the critical path."
        : "Split expensive work, defer non-critical updates, or move computation off the main thread.";

      insights.push({
        issueType: "interaction-render-latency",
        severity: delay > 250 ? "high" : "medium",
        source: interaction.uiEvent.target,
        message: `First render after ${interaction.uiEvent.eventType} took ${delay}ms.`,
        cause,
        possibleFix,
      });
    }

    return insights;
  },
};

export const networkBlockingRenderRule: AnalysisRule = {
  name: "network-blocking-render",
  run(context: AnalysisContext): Insight[] {
    const insights: Insight[] = [];
    const events = context.events;

    for (const event of events) {
      if (event.type !== "network" || event.duration <= SLOW_NETWORK_THRESHOLD_MS) {
        continue;
      }

      const renderEvents = events.filter(
        (candidate): candidate is RenderEvent =>
          candidate.type === "render" &&
          candidate.timestamp >= event.timestamp &&
          candidate.timestamp <= event.timestamp + NETWORK_RENDER_WINDOW_MS,
      );

      if (renderEvents.length < 4) {
        continue;
      }

      const { topComponent } = summarizeRenderSources(renderEvents);

      insights.push({
        issueType: "network-blocking-render",
        severity: "high",
        source: event.url,
        message: `Slow request (${event.duration}ms) was followed by ${renderEvents.length} renders within ${NETWORK_RENDER_WINDOW_MS}ms.`,
        cause: "The UI render depends on a slow network response on the critical path.",
        possibleFix: "Cache or prefetch data, or decouple rendering from the network response.",
      });
    }

    return insights;
  },
};

export const defaultRules: AnalysisRule[] = [
  interactionRenderBurstRule,
  keystrokeRenderLoopRule,
  interactionRenderLatencyRule,
  networkBlockingRenderRule,
];
