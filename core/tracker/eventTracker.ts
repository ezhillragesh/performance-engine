/**
 * UI event tracker.
 *
 * Listens for user interactions on the document and pushes UIEvents
 * into the event store.
 */

import type { UIEventType } from "../types/events";
import { pushEvent } from "../logger/store";
import { now } from "./time";

const TRACKED_EVENTS: UIEventType[] = [
  "click",
  "dblclick",
  "input",
  "change",
  "keydown",
  "keyup",
  "focus",
  "blur",
  "scroll",
  "submit",
  "pointerdown",
  "pointerup",
];

function describeTarget(el: EventTarget | null): string {
  if (!el || !(el instanceof Element)) {
    return "unknown";
  }

  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string"
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";

  return `${tag}${id}${cls}` || tag;
}

/** Starts tracking UI events. Returns a cleanup function. */
export function startEventTracking(): () => void {
  const handler = (domEvent: Event): void => {
    pushEvent({
      type: "ui",
      eventType: domEvent.type as UIEventType,
      target: describeTarget(domEvent.target),
      timestamp: now(),
    });
  };

  for (const eventType of TRACKED_EVENTS) {
    document.addEventListener(eventType, handler, { capture: true, passive: true });
  }

  return () => {
    for (const eventType of TRACKED_EVENTS) {
      document.removeEventListener(eventType, handler, true);
    }
  };
}
