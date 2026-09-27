/**
 * ID generation. Uses `crypto.randomUUID` when available, otherwise a
 * counter + random suffix (unique within the page, collision-resistant enough
 * across pages).
 */

let counter = 0;

function hasRandomUUID(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function";
}

function fallbackId(): string {
  counter += 1;
  return `${counter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function uniqueId(): string {
  if (hasRandomUUID()) {
    try {
      return crypto.randomUUID();
    } catch {
      // Insecure contexts may throw; fall through.
    }
  }
  return fallbackId();
}

export function generateEventId(): string {
  return uniqueId();
}

export function generateTraceId(): string {
  return `trace-${uniqueId()}`;
}

export function generateSessionId(): string {
  return `session-${uniqueId()}`;
}

let currentSessionId: string | null = null;

export function getCurrentSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = generateSessionId();
  }
  return currentSessionId;
}

export function setCurrentSessionId(id: string): void {
  currentSessionId = id;
}

export function resetSessionId(): void {
  currentSessionId = null;
}
