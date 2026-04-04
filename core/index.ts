export * from "./analyzer/engine";
export * from "./analyzer/context";
export * from "./analyzer/rules";
export * from "./logger/store";
export * from "./tracker/eventTracker";
export * from "./tracker/networkTracker";
export * from "./tracker/renderTracker";
export * from "./types";

import { analyzeEvents } from "./analyzer/engine";
import { clearEvents, getEvents } from "./logger/store";
import { startEventTracking, stopEventTracking } from "./tracker/eventTracker";
import { startNetworkTracking, stopNetworkTracking } from "./tracker/networkTracker";
import { setRenderTrackingEnabled } from "./tracker/renderTracker";
import type { Insight } from "./types/insights";

export interface PerfEngineConfig {
  trackEvents: boolean;
  trackNetwork: boolean;
  trackRenders: boolean;
  analysisIntervalMs?: number;
  onInsights?: (insights: Insight[]) => void;
}

export interface PerfEngineSession {
  analyzeNow: () => Insight[];
  getInsights: () => Insight[];
  getEvents: typeof getEvents;
  stop: () => void;
}

let activeSession: PerfEngineSession | null = null;

export function initPerfEngine(config: PerfEngineConfig): PerfEngineSession {
  activeSession?.stop();
  clearEvents();

  const stopEventTrackingFn = config.trackEvents ? startEventTracking() : () => undefined;
  const stopNetworkTrackingFn = config.trackNetwork ? startNetworkTracking() : () => undefined;
  setRenderTrackingEnabled(config.trackRenders);

  const analysisIntervalMs = config.analysisIntervalMs ?? 5000;
  let latestInsights: Insight[] = [];
  let latestSerialized = "";

  const updateInsights = (): { insights: Insight[]; changed: boolean } => {
    const events = getEvents();
    const insights = analyzeEvents(events);
    const serialized = JSON.stringify(insights);
    const changed = serialized !== latestSerialized;
    latestInsights = insights;
    latestSerialized = serialized;
    return { insights, changed };
  };

  const analyzeNow = (): Insight[] => updateInsights().insights;

  const publishInsights = (): void => {
    const { insights, changed } = updateInsights();
    if (!changed) {
      return;
    }

    config.onInsights?.(insights);
  };

  const intervalId = globalThis.setInterval(publishInsights, analysisIntervalMs);

  const stop = (): void => {
    globalThis.clearInterval(intervalId);
    stopEventTrackingFn();
    stopNetworkTrackingFn();
    setRenderTrackingEnabled(true);
    if (activeSession === session) {
      activeSession = null;
    }
  };

  const session: PerfEngineSession = {
    analyzeNow,
    getInsights: () => latestInsights.slice(),
    getEvents,
    stop,
  };

  activeSession = session;
  return session;
}
