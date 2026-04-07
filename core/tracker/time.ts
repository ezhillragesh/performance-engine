/**
 * High-resolution monotonic time source.
 * Falls back to Date.now() in environments without performance.now().
 */

export function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
