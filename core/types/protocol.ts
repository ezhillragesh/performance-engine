/**
 * Page <-> DevTools wire protocol (v2). See docs/PROTOCOL.md.
 */

import type { TrackedEvent } from "./events.js";
import type { Insight, PerformanceBudgets, SessionSummary, TraceSummary } from "./insights.js";
import type { WebVitals } from "./vitals.js";

/** Version of this engine (= the npm package version), reported in HELLO and snapshots. */
export const ENGINE_VERSION = "0.4.0";
export const PROTOCOL_VERSION = 2;
export const PAGE_MESSAGE_SOURCE = "perf-engine";
export const PANEL_MESSAGE_SOURCE = "perf-engine-devtools";

export interface PerfSnapshot {
  sessionId: string;
  engineVersion: string;
  /** performance.now() */
  capturedAt: number;
  /** performance.timeOrigin (epoch ms) for wall-clock display. */
  timeOrigin: number;
  paused: boolean;
  /** Full current list (never the deduped "fresh" subset). */
  insights: Insight[];
  /** Most recent N (default 1500), sorted by timestamp. */
  events: TrackedEvent[];
  /** Events trimmed from the store since session start. */
  droppedEvents: number;
  /** Most recent 100. */
  traces: TraceSummary[];
  summary: SessionSummary;
  budgets: PerformanceBudgets;
  /**
   * Core Web Vitals measured by the engine (v0.4+, absent from older engines).
   * Same flat fields as the DevTools collector's vitals plus `attribution`.
   */
  vitals?: WebVitals;
}

/** Which engine copy is talking: the app's own bundle or the extension-injected one. */
export type EngineMode = "app" | "injected";

export interface HelloPayload {
  sessionId: string;
  engineVersion: string;
  url: string;
  title: string;
  timeOrigin: number;
  config: {
    trackEvents: boolean;
    trackNetwork: boolean;
    trackRenders: boolean;
    trackLongTasks: boolean;
    trackInteractions: boolean;
    /** v0.4+. Absent from older engines. */
    trackWebVitals?: boolean;
    react: boolean;
    /** v2.1+. Absent from older engines: treat as "app". */
    mode?: EngineMode;
  };
}

export interface ResetPayload {
  sessionId: string;
}

interface PageMessageBase<T extends string, P> {
  source: typeof PAGE_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: T;
  payload: P;
  /** performance.now() */
  timestamp: number;
}

export type HelloMessage = PageMessageBase<"HELLO", HelloPayload>;
export type SnapshotMessage = PageMessageBase<"SNAPSHOT", PerfSnapshot>;
export type ResetMessage = PageMessageBase<"RESET", ResetPayload>;

export type PageMessage = HelloMessage | SnapshotMessage | ResetMessage;
export type PageMessageType = PageMessage["type"];

export type PanelCommand =
  | "PING"
  | "ATTACH"
  | "DETACH"
  | "REQUEST_SNAPSHOT"
  | "CLEAR"
  | "PAUSE"
  | "RESUME"
  | "SET_BUDGETS";

export interface PanelCommandMessage {
  source: typeof PANEL_MESSAGE_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: "COMMAND";
  command: PanelCommand;
  /** `Partial<PerformanceBudgets>` for SET_BUDGETS; absent otherwise. */
  payload?: Partial<PerformanceBudgets>;
}
