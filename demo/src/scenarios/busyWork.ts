/**
 * INTENTIONAL PERFORMANCE PROBLEMS live here and in the scenario components.
 * Nothing outside `src/scenarios/` should import from this file except the
 * opt-in "Heavy mode" hook used by the Workspace.
 */

let sink = 0

/**
 * Blocks the main thread for `ms` milliseconds with real CPU work.
 * Uses `performance.now()` so the cost is accurate regardless of device speed
 * (the old demo's fixed-iteration loop cost < 1ms and never registered).
 */
export function busyWait(ms: number): number {
  const end = performance.now() + ms
  let acc = sink
  while (performance.now() < end) {
    for (let i = 0; i < 200; i += 1) acc = (acc + Math.sqrt(i * acc + 1)) % 1_000_003
  }
  sink = acc
  return acc
}

/** Yields to the event loop so input and paint can run between chunks. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Performs `totalMs` of CPU work in `chunkMs` slices, yielding between slices. */
export async function chunkedWork(totalMs: number, chunkMs = 8): Promise<void> {
  let remaining = totalMs
  while (remaining > 0) {
    const slice = Math.min(chunkMs, remaining)
    busyWait(slice)
    remaining -= slice
    await yieldToMain()
  }
}

let heavyMode = false
const heavyListeners = new Set<() => void>()

/** Opt-in "Heavy mode": makes every Workspace message row burn CPU while rendering. */
export function setHeavyMode(on: boolean): void {
  heavyMode = on
  for (const listener of heavyListeners) listener()
}

export function isHeavyMode(): boolean {
  return heavyMode
}

export function subscribeHeavyMode(listener: () => void): () => void {
  heavyListeners.add(listener)
  return () => heavyListeners.delete(listener)
}

/** Deliberately expensive work performed per message row when Heavy mode is on. */
export function heavyRowWork(): void {
  if (heavyMode) busyWait(1.5)
}
