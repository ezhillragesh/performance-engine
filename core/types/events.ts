/**
 * Discriminated union types for all tracked runtime events.
 *
 * Every event carries a `type` discriminator so consumers can narrow
 * with a simple `event.type === "..."` check.
 */

interface BaseEvent {
  /** Monotonic timestamp (ms) from `performance.now()`. */
  timestamp: number;
}

// ── UI Events ────────────────────────────────────────────────────────

export type UIEventType =
  | "click"
  | "dblclick"
  | "input"
  | "change"
  | "keydown"
  | "keyup"
  | "focus"
  | "blur"
  | "scroll"
  | "submit"
  | "pointerdown"
  | "pointerup";

export interface UIEvent extends BaseEvent {
  type: "ui";
  eventType: UIEventType;
  /** CSS selector or descriptive label for the target element. */
  target: string;
}

// ── Render Events ────────────────────────────────────────────────────

export interface RenderEvent extends BaseEvent {
  type: "render";
  componentName: string;
  /** Duration of the render commit in ms (0 when unknown). */
  durationMs: number;
  /** Optional snapshot hash to detect wasted renders. */
  propsHash?: string;
  /** Optional previous snapshot hash for comparison. */
  prevPropsHash?: string;
}

// ── Network Events ───────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface NetworkEvent extends BaseEvent {
  type: "network";
  url: string;
  method: HttpMethod;
  /** Total request duration in ms. */
  duration: number;
  /** HTTP status code (0 if the request failed before receiving a response). */
  status: number;
  /** True when the request was served from browser cache. */
  fromCache: boolean;
  /** Response body size in bytes (undefined when unknown). */
  responseSize?: number;
}

// ── Union ────────────────────────────────────────────────────────────

export type TrackedEvent = UIEvent | RenderEvent | NetworkEvent;
