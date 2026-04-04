import type { TrackedEvent } from "../types/events";

const events: TrackedEvent[] = [];

export function logEvent(event: TrackedEvent): void {
  events.push({ ...event });
}

export function getEvents(): TrackedEvent[] {
  return events.map((event) => ({ ...event }));
}

export function clearEvents(): void {
  events.length = 0;
}
