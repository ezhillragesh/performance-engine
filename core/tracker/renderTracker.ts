/**
 * Render tracker: global enable flag + manual `trackRender` API.
 * Automatic React instrumentation lives in `core/react/instrumentReact.ts`.
 */

import type { RenderEvent } from "../types/events.js";
import { isStorePaused, pushEvent } from "../logger/store.js";
import { captureTraceId } from "../trace/traceContext.js";
import { generateEventId, getCurrentSessionId } from "./id.js";
import { now } from "./time.js";

let enabled = false;

export function setRenderTrackingEnabled(value: boolean): void {
  enabled = value;
}

export function isRenderTrackingEnabled(): boolean {
  return enabled;
}

/** True when render events would currently be recorded. */
export function shouldRecordRenders(): boolean {
  return enabled && !isStorePaused();
}

/**
 * Record a component render (manual instrumentation).
 *
 * @param componentName  Display name of the component.
 * @param durationMs     Render duration in ms (0 if unknown).
 * @param propsHash      Optional hash of the current props/state snapshot.
 * @param prevPropsHash  Optional hash of the previous snapshot.
 * @param extra          Additional RenderEvent fields (instanceId, phase, …).
 */
export function trackRender(
  componentName: string,
  durationMs: number = 0,
  propsHash?: string,
  prevPropsHash?: string,
  extra?: Partial<Omit<RenderEvent, "type" | "eventId" | "sessionId">>,
): void {
  if (!enabled) return;
  try {
    const start = extra?.timestamp;
    const event: RenderEvent = {
      source: "manual",
      ...extra,
      type: "render",
      componentName: typeof componentName === "string" && componentName ? componentName : "Anonymous",
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0,
      // A bogus start time (NaN from a failed subtraction) must not be dropped silently.
      timestamp: typeof start === "number" && Number.isFinite(start) ? start : now(),
      eventId: generateEventId(),
      sessionId: getCurrentSessionId(),
    };
    if (propsHash !== undefined) event.propsHash = propsHash;
    if (prevPropsHash !== undefined) event.prevPropsHash = prevPropsHash;
    if (event.traceId === undefined) {
      const traceId = captureTraceId();
      if (traceId !== undefined) event.traceId = traceId;
    }
    pushEvent(event);
  } catch {
    // never throw into the host app
  }
}
