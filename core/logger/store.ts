/**
 * Bounded, timestamp-ordered event store.
 *
 * - Keeps at most `maxSize` events (oldest 25% trimmed at once to amortise cost).
 * - Late events (e.g. network requests pushed at response time with their start
 *   timestamp) are inserted in order, so `getEvents()` is always sorted.
 * - While paused, pushes are dropped and counted.
 */

import type { TrackedEvent } from "../types/events.js";

export const DEFAULT_MAX_STORE_SIZE = 2000;
const MIN_STORE_SIZE = 100;

let events: TrackedEvent[] = [];
let maxSize = DEFAULT_MAX_STORE_SIZE;
let paused = false;
let trimmedCount = 0;
let pausedDropCount = 0;
/** Incremented on every mutation; cheap change detection for consumers. */
let version = 0;

export interface StoreStats {
  size: number;
  maxSize: number;
  paused: boolean;
  /** Events trimmed because the store was full. */
  trimmedEvents: number;
  /** Events dropped because recording was paused. */
  pausedDrops: number;
  /** trimmedEvents + pausedDrops. */
  droppedEvents: number;
  version: number;
}

export function setMaxStoreSize(size: number): void {
  maxSize = Math.max(MIN_STORE_SIZE, Math.floor(size));
  if (events.length > maxSize) {
    const excess = events.length - maxSize;
    events = events.slice(excess);
    trimmedCount += excess;
    version += 1;
  }
}

export function getMaxStoreSize(): number {
  return maxSize;
}

function trimIfFull(): void {
  if (events.length < maxSize) return;
  const drop = Math.max(1, Math.floor(maxSize * 0.25));
  events = events.slice(drop);
  trimmedCount += drop;
}

/** Binary search: first index whose timestamp is > `ts`. */
function upperBound(ts: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.timestamp <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insert(event: TrackedEvent): void {
  const last = events[events.length - 1];
  if (!last || event.timestamp >= last.timestamp) {
    events.push(event);
  } else {
    events.splice(upperBound(event.timestamp), 0, event);
  }
}

/** Records an event. Returns false when dropped (paused). */
export function pushEvent(event: TrackedEvent): boolean {
  if (paused) {
    pausedDropCount += 1;
    return false;
  }
  trimIfFull();
  insert(event);
  version += 1;
  return true;
}

/** Records a batch (e.g. all renders of one React commit). */
export function pushEvents(batch: readonly TrackedEvent[]): number {
  if (batch.length === 0) return 0;
  if (paused) {
    pausedDropCount += batch.length;
    return 0;
  }
  for (const event of batch) {
    trimIfFull();
    insert(event);
  }
  version += 1;
  return batch.length;
}

export function getEvents(): TrackedEvent[] {
  return events.slice();
}

/** Most recent `count` events (sorted by timestamp). */
export function getRecentEvents(count: number): TrackedEvent[] {
  return count >= events.length ? events.slice() : events.slice(events.length - count);
}

export function getEventCount(): number {
  return events.length;
}

export function getLastEvent(): TrackedEvent | undefined {
  return events[events.length - 1];
}

export function clearEvents(): void {
  events = [];
  trimmedCount = 0;
  pausedDropCount = 0;
  version += 1;
}

export function setStorePaused(value: boolean): void {
  if (paused !== value) {
    paused = value;
    version += 1;
  }
}

export function isStorePaused(): boolean {
  return paused;
}

export function getStoreVersion(): number {
  return version;
}

export function getStoreStats(): StoreStats {
  return {
    size: events.length,
    maxSize,
    paused,
    trimmedEvents: trimmedCount,
    pausedDrops: pausedDropCount,
    droppedEvents: trimmedCount + pausedDropCount,
    version,
  };
}

/** Full reset for a new session: empties the store, resets counters, size and pause state. */
export function resetStore(size: number = DEFAULT_MAX_STORE_SIZE): void {
  clearEvents();
  paused = false;
  setMaxStoreSize(size);
}
