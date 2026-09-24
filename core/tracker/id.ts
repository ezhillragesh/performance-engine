/**
 * Simple ID generation utilities.
 * No external dependencies - uses timestamp + random suffix.
 */

let sessionIdCounter = 0;

function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function generateEventId(): string {
  return `${Date.now()}-${randomSuffix()}`;
}

export function generateTraceId(): string {
  return `trace-${Date.now()}-${randomSuffix()}`;
}

export function generateSessionId(): string {
  sessionIdCounter += 1;
  return `session-${Date.now()}-${sessionIdCounter}`;
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