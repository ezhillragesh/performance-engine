import { useSyncExternalStore } from 'react'
import type { PerfSnapshot } from 'performance-engine'
import { session } from '../perf'

/*
 * A tiny external store over `session.subscribe()`.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a cached value, so
 * the latest snapshot is kept in module scope and only replaced when the
 * engine publishes a new one (after each analysis tick) or when the demo
 * explicitly refreshes it (pause / resume / clear).
 */

let current: PerfSnapshot = session.getSnapshot()
const listeners = new Set<() => void>()
let unsubscribeEngine: (() => void) | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribeEngine) {
    unsubscribeEngine = session.subscribe((snapshot) => {
      current = snapshot
      emit()
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && unsubscribeEngine) {
      unsubscribeEngine()
      unsubscribeEngine = null
    }
  }
}

function getSnapshot(): PerfSnapshot {
  return current
}

/**
 * Latest published snapshot, without running an analysis. Use this from event
 * handlers: `session.getInsights()` would analyse synchronously inside the
 * handler and add that cost to the very interaction being measured.
 */
export function getLatestSnapshot(): PerfSnapshot {
  return current
}

/** Re-reads the snapshot immediately (use after pause/resume/clear). */
export function refreshPerfSnapshot(): void {
  current = session.getSnapshot()
  emit()
}

/** Full live snapshot. Re-renders after every analysis tick. */
export function usePerfSnapshot(): PerfSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Select a derived value. Return primitives (numbers, strings, booleans) so
 * the component only re-renders when the selected value actually changes —
 * this keeps the demo's own chrome out of the traces it is trying to show.
 */
export function usePerfSelector<T extends string | number | boolean | null>(
  selector: (snapshot: PerfSnapshot) => T,
): T {
  const read = () => selector(current)
  return useSyncExternalStore(subscribe, read, read)
}
