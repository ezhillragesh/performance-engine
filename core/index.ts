export * from "./analyzer/engine";
export * from "./analyzer/context";
export * from "./analyzer/rules";
export * from "./analyzer/explain";
export * from "./logger/store";
export * from "./tracker/eventTracker";
export * from "./tracker/networkTracker";
export * from "./tracker/renderTracker";
export * from "./tracker/time";
export * from "./tracker/id";
export * from "./types/events";
export * from "./types/insights";

import { analyzeEvents, getInsightId, type AnalyzeOptions } from "./analyzer/engine";
import { defaultRules, type AnalysisRule } from "./analyzer/rules";
import { clearEvents, getEvents, setMaxStoreSize } from "./logger/store";
import { startEventTracking } from "./tracker/eventTracker";
import { startNetworkTracking } from "./tracker/networkTracker";
import { setRenderTrackingEnabled } from "./tracker/renderTracker";
import { resetSessionId } from "./tracker/id";
import type { Insight } from "./types/insights";

export interface PerfEngineConfig {
  trackEvents: boolean;
  trackNetwork: boolean;
  trackRenders: boolean;
  analysisIntervalMs?: number;
  maxEvents?: number;
  /** Additional analysis rules appended to the defaults. */
  customRules?: AnalysisRule[];
  /** Replace default rules entirely when true (default false). */
  replaceDefaultRules?: boolean;
  /** Enable debug logging of analysis internals. */
  debug?: boolean;
  onInsights?: (insights: Insight[]) => void;
}

const INSIGHT_DEDUPE_WINDOW_MS = 60_000;

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
  resetSessionId();

  if (config.maxEvents !== undefined) {
    setMaxStoreSize(config.maxEvents);
  }

  const stopEventTrackingFn = config.trackEvents ? startEventTracking() : () => undefined;
  const stopNetworkTrackingFn = config.trackNetwork ? startNetworkTracking() : () => undefined;
  setRenderTrackingEnabled(config.trackRenders);

  // Build rule set
  const rules: AnalysisRule[] = config.replaceDefaultRules
    ? (config.customRules ?? [])
    : [...defaultRules, ...(config.customRules ?? [])];

  const analyzeOptions: AnalyzeOptions = {
    rules,
    debug: config.debug ?? false,
  };

  const analysisIntervalMs = config.analysisIntervalMs ?? 5000;
  let latestInsights: Insight[] = [];
  let latestSerialized = "";
  const seenInsights = new Map<string, number>();

  const updateInsights = (): { insights: Insight[]; changed: boolean } => {
    const events = getEvents();
    const insights = analyzeEvents(events, analyzeOptions);
    const serialized = JSON.stringify(insights);
    const changed = serialized !== latestSerialized;
    latestInsights = insights;
    latestSerialized = serialized;
    return { insights, changed };
  };

  const analyzeNow = (): Insight[] => updateInsights().insights;

  const publishInsights = (): void => {
    const { insights, changed } = updateInsights();
    if (!changed) return;

    const now = Date.now();

    for (const [id, timestamp] of seenInsights.entries()) {
      if (now - timestamp > INSIGHT_DEDUPE_WINDOW_MS * 2) {
        seenInsights.delete(id);
      }
    }

    const freshInsights = insights.filter((insight) => {
      const id = getInsightId(insight);
      const lastSeen = seenInsights.get(id);
      seenInsights.set(id, now);
      return !lastSeen || now - lastSeen > INSIGHT_DEDUPE_WINDOW_MS;
    });

    if (freshInsights.length === 0) return;

    config.onInsights?.(freshInsights);
  };

  const intervalId = globalThis.setInterval(publishInsights, analysisIntervalMs);

  const stop = (): void => {
    globalThis.clearInterval(intervalId);
    stopEventTrackingFn();
    stopNetworkTrackingFn();
    setRenderTrackingEnabled(false); // BUG FIX: original had `true`
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
