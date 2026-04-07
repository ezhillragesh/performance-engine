/**
 * Render tracker.
 *
 * Provides a `trackRender` function for manual instrumentation and a flag
 * to globally enable/disable render tracking at runtime.
 *
 * Usage in React (via a tiny HOC or custom hook):
 *   trackRender("MyComponent", renderDurationMs, propsHash, prevPropsHash)
 */

import type { RenderEvent } from "../types/events";
import { pushEvent } from "../logger/store";
import { now } from "./time";

let enabled = false;

export function setRenderTrackingEnabled(value: boolean): void {
  enabled = value;
}

export function isRenderTrackingEnabled(): boolean {
  return enabled;
}

/**
 * Record a component render event.
 *
 * @param componentName  Display name of the component.
 * @param durationMs     Render commit duration in ms (0 if unknown).
 * @param propsHash      Optional hash of current props/state snapshot.
 * @param prevPropsHash  Optional hash of previous props/state snapshot.
 */
export function trackRender(
  componentName: string,
  durationMs: number = 0,
  propsHash?: string,
  prevPropsHash?: string,
): void {
  if (!enabled) {
    return;
  }

  const event: RenderEvent = {
    type: "render",
    componentName,
    durationMs,
    timestamp: now(),
  };

  if (propsHash !== undefined) {
    event.propsHash = propsHash;
  }
  if (prevPropsHash !== undefined) {
    event.prevPropsHash = prevPropsHash;
  }

  pushEvent(event);
}
