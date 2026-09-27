/**
 * High-resolution monotonic time source (`performance.now()`), falling back
 * to `Date.now()` outside browsers. Overridable for deterministic tests.
 */

type TimeSource = () => number;

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

let source: TimeSource = defaultNow;

export function now(): number {
  return source();
}

/** Replace the clock (tests). Pass `undefined` to restore the default. */
export function setTimeSource(fn: TimeSource | undefined): void {
  source = fn ?? defaultNow;
}

/** `performance.timeOrigin` (epoch ms) or 0 when unavailable. */
export function getTimeOrigin(): number {
  if (typeof performance !== "undefined" && typeof performance.timeOrigin === "number") {
    return performance.timeOrigin;
  }
  return 0;
}
