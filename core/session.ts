/**
 * Engine session: wires trackers, periodic analysis, publishing and the
 * DevTools bridge. See docs/CORE_API.md.
 */

import type { TrackedEvent } from "./types/events.js";
import type { Insight, PerformanceBudgets, SessionSummary, TraceSummary } from "./types/insights.js";
import { ENGINE_VERSION, type EngineMode, type HelloPayload, type PerfSnapshot } from "./types/protocol.js";
import { analyzeContext } from "./analyzer/engine.js";
import { buildAnalysisContext, DEFAULT_INTERACTION_WINDOW_MS } from "./analyzer/context.js";
import { resolveBudgets } from "./analyzer/budgets.js";
import { computeSummary } from "./analyzer/summary.js";
import { buildTraceSummaries } from "./analyzer/traces.js";
import { defaultRules } from "./analyzer/rules/index.js";
import type { AnalysisRule } from "./analyzer/rules/shared.js";
import {
  clearEvents,
  DEFAULT_MAX_STORE_SIZE,
  getEvents,
  getRecentEvents,
  getStoreStats,
  getStoreVersion,
  isStorePaused,
  resetStore,
  setStorePaused,
} from "./logger/store.js";
import { startEventTracking } from "./tracker/eventTracker.js";
import { startNetworkTracking } from "./tracker/networkTracker.js";
import { startPerformanceTracking } from "./tracker/performanceTracker.js";
import { setRenderTrackingEnabled } from "./tracker/renderTracker.js";
import { generateSessionId, setCurrentSessionId } from "./tracker/id.js";
import { getTimeOrigin, now } from "./tracker/time.js";
import { resetTraceContext, runDetached } from "./trace/traceContext.js";
import { getReactInstrumentationStatus, isReactInstrumented } from "./react/instrumentReact.js";
import { startDevtoolsBridge } from "./bridge/devtoolsBridge.js";
import { clearEngineGlobal, COPY_TOKEN, readEngineGlobal, writeEngineGlobal } from "./runtime/engineGlobal.js";

export interface DevtoolsOptions {
  snapshotIntervalMs?: number;
  maxEvents?: number;
}

export interface PerfEngineConfig {
  /** Default true — DOM interactions (click, dblclick, input, change, keydown, submit, pointerdown). */
  trackEvents?: boolean;
  /** Default true — fetch + XHR. */
  trackNetwork?: boolean;
  /** Default true — accepts trackRender()/instrumentReact()/profiler events. */
  trackRenders?: boolean;
  /** Default true — long-animation-frame, fallback longtask. */
  trackLongTasks?: boolean;
  /** Default true — Event Timing API (INP-style latency). */
  trackInteractions?: boolean;
  /** Default 2000. */
  analysisIntervalMs?: number;
  /** Default 2000 (min 100), reset per session. */
  maxEvents?: number;
  budgets?: Partial<PerformanceBudgets>;
  customRules?: AnalysisRule[];
  replaceDefaultRules?: boolean;
  /** Min window for untagged legacy events, ms. Default 300. */
  interactionWindowMs?: number;
  /** Default true in browsers: starts the DevTools bridge. */
  devtools?: boolean | DevtoolsOptions;
  debug?: boolean;
  /** Full current list, called whenever it changes. */
  onInsights?: (insights: Insight[]) => void;
  /**
   * Default "app". "injected" is used by the extension-injected bundle; an
   * "app" session always replaces an "injected" one (docs/PROTOCOL.md).
   */
  mode?: EngineMode;
}

export interface SnapshotOptions {
  /** Events to include (default 1500). */
  maxEvents?: number;
}

export type PerfEngineFeatures = Omit<HelloPayload["config"], "react" | "mode">;

export interface PerfEngineSession {
  readonly sessionId: string;
  /** "app" (default) or "injected". */
  readonly mode: EngineMode;
  /** Resolved tracker flags. */
  readonly features: Readonly<PerfEngineFeatures>;
  analyzeNow(): Insight[];
  getInsights(): Insight[];
  getEvents(): TrackedEvent[];
  getTraces(): TraceSummary[];
  getSummary(): SessionSummary;
  getSnapshot(options?: SnapshotOptions): PerfSnapshot;
  getBudgets(): PerformanceBudgets;
  setBudgets(budgets: Partial<PerformanceBudgets>): void;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /** Clears events + insights, keeps trackers. */
  clear(): void;
  /** Fires after each analysis tick that processed new data. */
  subscribe(listener: (snapshot: PerfSnapshot) => void): () => void;
  /** Fires after clear(). */
  onReset(listener: () => void): () => void;
  /** Cheap token that changes whenever the snapshot content would change. */
  getChangeSignature(): string;
  /** Idempotent. */
  stop(): void;
}

const DEFAULT_ANALYSIS_INTERVAL_MS = 2000;
const DEFAULT_SNAPSHOT_EVENTS = 1500;
const MAX_TRACES = 100;

let activeSession: PerfEngineSession | null = null;

export function getActiveSession(): PerfEngineSession | null {
  return activeSession;
}

/** Cheap change signature: ids + the fields a panel would visibly re-render. */
function insightsSignature(insights: readonly Insight[]): string {
  let sig = "";
  for (const i of insights) {
    sig += `${i.id}~${i.severity}~${i.confidence}~${Math.round(i.impact.estimatedDelayMs)}~${i.evidence.length}~${i.metadata?.timeWindowEnd ?? ""}|`;
  }
  return sig;
}

function safeCall<A>(fn: ((arg: A) => void) | undefined, arg: A, debug: boolean): void {
  if (!fn) return;
  try {
    fn(arg);
  } catch (error) {
    if (debug) console.warn("[perf-engine] listener threw", error);
  }
}

/**
 * Stops a session registered by another copy of core on this page (e.g. the
 * extension-injected bundle), so only one engine and one bridge ever run.
 */
function stopForeignSession(debug: boolean): void {
  const registered = readEngineGlobal();
  if (!registered || registered.copy === COPY_TOKEN) return;
  try {
    if (typeof registered.stop === "function") registered.stop();
  } catch (error) {
    if (debug) console.warn("[perf-engine] failed to stop the other engine copy", error);
  }
  // A well-behaved copy unregisters itself; make sure a broken one does not linger.
  if (readEngineGlobal() === registered) clearEngineGlobal(registered.sessionId);
}

export function initPerfEngine(config: PerfEngineConfig = {}): PerfEngineSession {
  activeSession?.stop();
  const mode: EngineMode = config.mode === "injected" ? "injected" : "app";
  stopForeignSession(config.debug ?? false);

  const debug = config.debug ?? false;
  const sessionId = generateSessionId();
  setCurrentSessionId(sessionId);
  resetStore(config.maxEvents ?? DEFAULT_MAX_STORE_SIZE);
  resetTraceContext();

  const features: PerfEngineFeatures = Object.freeze({
    trackEvents: config.trackEvents ?? true,
    trackNetwork: config.trackNetwork ?? true,
    trackRenders: config.trackRenders ?? true,
    trackLongTasks: config.trackLongTasks ?? true,
    trackInteractions: config.trackInteractions ?? true,
  });

  const cleanups: Array<() => void> = [];
  const guard = (start: () => () => void): void => {
    try {
      cleanups.push(start());
    } catch (error) {
      if (debug) console.warn("[perf-engine] tracker failed to start", error);
    }
  };
  if (features.trackEvents) guard(() => startEventTracking());
  // Server-side fetch is shared across requests: only patch it in browsers.
  if (features.trackNetwork && typeof window !== "undefined") guard(() => startNetworkTracking());
  if (features.trackLongTasks || features.trackInteractions) {
    guard(() => startPerformanceTracking({ longTasks: features.trackLongTasks, interactions: features.trackInteractions }));
  }
  setRenderTrackingEnabled(features.trackRenders);

  const rules: readonly AnalysisRule[] = config.replaceDefaultRules
    ? (config.customRules ?? [])
    : insertBeforeBudgetRule(defaultRules, config.customRules ?? []);
  const interactionWindowMs = config.interactionWindowMs ?? DEFAULT_INTERACTION_WINDOW_MS;
  let budgets = resolveBudgets(config.budgets);
  let budgetsRev = 0;

  let insights: Insight[] = [];
  let signature = "";
  let summary: SessionSummary | null = null;
  let traces: TraceSummary[] = [];
  let analyzedVersion = -1;
  let analyzedBudgetsRev = -1;
  let analyzing = false;
  let stopped = false;
  const listeners = new Set<(snapshot: PerfSnapshot) => void>();
  const resetListeners = new Set<() => void>();

  /**
   * How subscribers hear about a finished analysis:
   * - "now": synchronously (explicit API calls: analyzeNow, clear, setBudgets).
   * - "tick": synchronously but detached from the active trace — the timer is
   *   engine work, so UI updates it causes must not be blamed on the user's
   *   last interaction.
   * - "defer": lazy refresh from a getter (getInsights/getSnapshot, possibly
   *   inside an app event handler); delivered by the next tick instead of
   *   re-entering app code from inside its own handler.
   */
  type Notify = "now" | "tick" | "defer";
  let pendingInsights = false;
  let pendingSnapshot = false;

  const notify = (mode: "now" | "tick"): void => {
    const deliver = (): void => {
      if (pendingInsights) {
        pendingInsights = false;
        safeCall(config.onInsights, insights.slice(), debug);
      }
      if (pendingSnapshot) {
        pendingSnapshot = false;
        if (listeners.size > 0) {
          const snapshot = getSnapshot();
          for (const listener of Array.from(listeners)) safeCall(listener, snapshot, debug);
        }
      }
    };
    if (mode === "tick") runDetached(deliver);
    else deliver();
  };

  const runAnalysis = (force: boolean, mode: Notify): void => {
    if (analyzing) return;
    const version = getStoreVersion();
    if (!force && version === analyzedVersion && budgetsRev === analyzedBudgetsRev && summary) {
      if (mode !== "defer" && (pendingInsights || pendingSnapshot)) notify(mode);
      return;
    }
    analyzing = true;
    let changed = false;
    try {
      const context = buildAnalysisContext(getEvents(), { interactionWindowMs });
      const next = analyzeContext(context, { rules, budgets, debug, interactionWindowMs });
      summary = computeSummary(context, next, budgets);
      traces = buildTraceSummaries(context, next, MAX_TRACES);
      analyzedVersion = version;
      analyzedBudgetsRev = budgetsRev;
      const nextSignature = insightsSignature(next);
      changed = nextSignature !== signature;
      insights = next;
      signature = nextSignature;
    } catch (error) {
      if (debug) console.warn("[perf-engine] analysis failed", error);
    } finally {
      analyzing = false;
    }
    if (changed) pendingInsights = true;
    pendingSnapshot = true;
    if (mode !== "defer") notify(mode);
  };

  const ensureFresh = (): void => {
    if (!analyzing && (getStoreVersion() !== analyzedVersion || budgetsRev !== analyzedBudgetsRev || !summary)) {
      runAnalysis(false, "defer");
    }
  };

  const getSummary = (): SessionSummary => {
    ensureFresh();
    // summary is only null if the very first analysis threw.
    return summary ?? computeSummary([], [], budgets);
  };

  const getSnapshot = (options: SnapshotOptions = {}): PerfSnapshot => {
    ensureFresh();
    const stats = getStoreStats();
    return {
      sessionId,
      engineVersion: ENGINE_VERSION,
      capturedAt: now(),
      timeOrigin: getTimeOrigin(),
      paused: stats.paused,
      insights: insights.slice(),
      events: getRecentEvents(Math.max(0, options.maxEvents ?? DEFAULT_SNAPSHOT_EVENTS)),
      droppedEvents: stats.droppedEvents,
      traces: traces.slice(),
      summary: getSummary(),
      budgets: { ...budgets },
    };
  };

  const intervalMs = Math.max(50, config.analysisIntervalMs ?? DEFAULT_ANALYSIS_INTERVAL_MS);
  let reactChecked = false;
  const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
    if (debug && !reactChecked && features.trackRenders) {
      reactChecked = true;
      if (getReactInstrumentationStatus() === "waiting") {
        console.warn(
          "[perf-engine] instrumentReact() is installed but React never registered with the DevTools hook: " +
            "import the engine before react-dom (see docs/CORE_API.md). No React renders will be recorded.",
        );
      }
    }
    try {
      runAnalysis(false, "tick");
    } catch {
      // never throw from the timer
    }
  }, intervalMs);
  // Do not keep Node (SSR/tests) processes alive.
  (intervalId as { unref?: () => void }).unref?.();

  let stopBridge: () => void = () => undefined;

  const session: PerfEngineSession = {
    sessionId,
    mode,
    features,
    analyzeNow(): Insight[] {
      runAnalysis(true, "now");
      return insights.slice();
    },
    getInsights(): Insight[] {
      ensureFresh();
      return insights.slice();
    },
    getEvents,
    getTraces(): TraceSummary[] {
      ensureFresh();
      return traces.slice();
    },
    getSummary,
    getSnapshot,
    getBudgets: () => ({ ...budgets }),
    setBudgets(partial: Partial<PerformanceBudgets>): void {
      budgets = resolveBudgets(partial, budgets);
      budgetsRev += 1;
      runAnalysis(true, "now");
    },
    pause: () => setStorePaused(true),
    resume: () => setStorePaused(false),
    isPaused: isStorePaused,
    clear(): void {
      clearEvents();
      runAnalysis(true, "now");
      for (const listener of Array.from(resetListeners)) safeCall(listener, undefined, debug);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onReset(listener) {
      resetListeners.add(listener);
      return () => {
        resetListeners.delete(listener);
      };
    },
    getChangeSignature: () => `${getStoreVersion()}|${budgetsRev}|${isStorePaused()}|${signature}`,
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(intervalId);
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // ignore
        }
      }
      try {
        stopBridge();
      } catch {
        // ignore
      }
      listeners.clear();
      resetListeners.clear();
      clearEngineGlobal(sessionId);
      if (activeSession === session) {
        activeSession = null;
        // Global flags belong to the active session only.
        setRenderTrackingEnabled(false);
        setStorePaused(false);
      }
    },
  };

  if (config.devtools !== false && typeof window !== "undefined") {
    const devtoolsOptions: DevtoolsOptions = typeof config.devtools === "object" ? config.devtools : {};
    try {
      stopBridge = startDevtoolsBridge(session, {
        snapshotIntervalMs: devtoolsOptions.snapshotIntervalMs,
        maxEvents: devtoolsOptions.maxEvents,
        getConfig: () => ({ ...features, react: isReactInstrumented(), mode }),
        deferInitialHello: mode === "injected",
      });
    } catch (error) {
      if (debug) console.warn("[perf-engine] devtools bridge failed to start", error);
    }
  }

  activeSession = session;
  writeEngineGlobal({ kind: mode, sessionId, stop: () => session.stop(), copy: COPY_TOKEN, engineVersion: ENGINE_VERSION });
  return session;
}

/** Custom rules run before the budget rule so it can see their coverage. */
function insertBeforeBudgetRule(base: readonly AnalysisRule[], extra: readonly AnalysisRule[]): AnalysisRule[] {
  if (extra.length === 0) return base.slice();
  const idx = base.findIndex((r) => r.name === "budget-exceeded");
  if (idx < 0) return [...base, ...extra];
  return [...base.slice(0, idx), ...extra, ...base.slice(idx)];
}
