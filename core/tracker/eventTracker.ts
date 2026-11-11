/**
 * UI event tracker: records user interactions and opens causal traces.
 *
 * Only trigger events are captured by default; scroll/focus/blur/keyup/pointerup
 * flood the store without adding causal value (they can be opted in via
 * `types`, but never start traces).
 */

import type { UIEvent, UIEventType } from "../types/events.js";
import { pushEvent } from "../logger/store.js";
import { onUserEvent } from "../trace/traceContext.js";
import { describeLabel, describeTarget, isTextEntryTarget } from "./dom.js";
import { generateEventId, getCurrentSessionId } from "./id.js";
import { now } from "./time.js";

export const DEFAULT_TRACKED_UI_EVENTS: readonly UIEventType[] = [
  "click",
  "dblclick",
  "input",
  "change",
  "keydown",
  "submit",
  "pointerdown",
];

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "AltGraph", "OS"]);

export interface EventTrackingOptions {
  types?: readonly UIEventType[];
}

function isIgnoredKeydown(domEvent: Event): boolean {
  const key = (domEvent as KeyboardEvent).key;
  return (domEvent as KeyboardEvent).repeat === true || (typeof key === "string" && MODIFIER_KEYS.has(key));
}

/**
 * `Event.timeStamp` shares the `performance.now()` time base in modern
 * browsers; ignore it when it clearly does not (old engines, some test DOMs).
 */
function plausibleDomTimestamp(ts: number, captureTime: number): number | undefined {
  if (!Number.isFinite(ts) || ts <= 0) return undefined;
  if (ts > captureTime + 1 || captureTime - ts > 10_000) return undefined;
  return ts;
}

export function createUIEventHandler(): (domEvent: Event) => void {
  return (domEvent: Event): void => {
    try {
      const eventType = domEvent.type as UIEventType;
      if (eventType === "keydown" && isIgnoredKeydown(domEvent)) return;
      const timestamp = now();
      const domTimestamp = plausibleDomTimestamp(domEvent.timeStamp, timestamp);
      const { traceId, startsTrace } = onUserEvent(eventType, domTimestamp);
      const event: UIEvent = {
        type: "ui",
        eventType,
        target: describeTarget(domEvent.target),
        timestamp,
        eventId: generateEventId(),
        sessionId: getCurrentSessionId(),
      };
      const label = describeLabel(domEvent.target);
      if (label !== undefined) event.label = label;
      if (domTimestamp !== undefined) event.domTimestamp = domTimestamp;
      // Lets the analysis tell typing apart from shortcuts / arrow keys on buttons.
      if (eventType === "keydown" || eventType === "input" || eventType === "change") event.editable = isTextEntryTarget(domEvent.target);
      if (traceId !== undefined) event.traceId = traceId;
      if (startsTrace) event.startsTrace = true;
      pushEvent(event);
    } catch {
      // Instrumentation must never break the host app.
    }
  };
}

/** Starts tracking UI events. Returns an idempotent cleanup function. SSR-safe. */
export function startEventTracking(options: EventTrackingOptions = {}): () => void {
  if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
    return () => undefined;
  }
  const types = options.types ?? DEFAULT_TRACKED_UI_EVENTS;
  const handler = createUIEventHandler();
  for (const type of types) {
    document.addEventListener(type, handler, { capture: true, passive: true });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const type of types) {
      document.removeEventListener(type, handler, true);
    }
  };
}
