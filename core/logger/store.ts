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
export const MIN_STORE_SIZE = 100;
/** Hard upper bound: the store is memory the host page pays for. */
export const MAX_STORE_SIZE = 50_000;

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

/**
 * Sets the capacity, clamped to [MIN_STORE_SIZE, MAX_STORE_SIZE]. A value that
 * is not a finite number (NaN, Infinity, a string from untyped config) falls
 * back to the default instead of disabling the bound.
 */
export function setMaxStoreSize(size: number): void {
  const requested = typeof size === "number" && Number.isFinite(size) ? Math.floor(size) : DEFAULT_MAX_STORE_SIZE;
  maxSize = Math.min(MAX_STORE_SIZE, Math.max(MIN_STORE_SIZE, requested));
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

/**
 * The store is ordered by `timestamp`; one NaN would break the binary search
 * for every later insert, so events without a finite timestamp are rejected.
 */
function isStorable(event: TrackedEvent | null | undefined): event is TrackedEvent {
  return typeof event === "object" && event !== null && typeof event.timestamp === "number" && Number.isFinite(event.timestamp);
}

/** Records an event. Returns false when dropped (paused or malformed). */
export function pushEvent(event: TrackedEvent): boolean {
  if (!isStorable(event)) return false;
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
  let stored = 0;
  for (const event of batch) {
    if (!isStorable(event)) continue;
    trimIfFull();
    insert(event);
    stored += 1;
  }
  if (stored > 0) version += 1;
  return stored;
}

export function getEvents(): TrackedEvent[] {
  return events.slice();
}

/** Most recent `count` events (sorted by timestamp). Infinity / NaN return all of them. */
export function getRecentEvents(count: number): TrackedEvent[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : events.length;
  return n >= events.length ? events.slice() : events.slice(events.length - n);
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
