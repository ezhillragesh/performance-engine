/**
 * Bounded circular event store.
 *
 * Keeps the most recent `maxSize` events and avoids unbounded memory growth.
 */

import type { TrackedEvent } from "../types/events";

const DEFAULT_MAX_SIZE = 2000;

let events: TrackedEvent[] = [];
let maxSize = DEFAULT_MAX_SIZE;

export function setMaxStoreSize(size: number): void {
  maxSize = Math.max(100, size);
  if (events.length > maxSize) {
    events = events.slice(events.length - maxSize);
  }
}

export function pushEvent(event: TrackedEvent): void {
  if (events.length >= maxSize) {
    // Drop oldest 25% to amortise shifting cost.
    events = events.slice(Math.floor(maxSize * 0.25));
  }
  events.push(event);
}

export function getEvents(): TrackedEvent[] {
  return events.slice();
}

export function clearEvents(): void {
  events = [];
}
