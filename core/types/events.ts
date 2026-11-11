/**
 * Discriminated union types for all tracked runtime events.
 *
 * Every event carries a `type` discriminator so consumers can narrow
 * with a simple `event.type === "..."` check.
 *
 * All `timestamp` values are monotonic `performance.now()` milliseconds
 * relative to the page's time origin.
 */

interface BaseEvent {
  /** Monotonic timestamp (ms) from `performance.now()`. For spans, this is the start. */
  timestamp: number;
  /** Unique identifier for this specific event. */
  eventId: string;
  /**
   * Causal trace this event belongs to. Assigned at capture time by the
   * trace context (see `core/trace/traceContext.ts`), never inferred later.
   */
  traceId?: string;
  /** Session identifier for the tracking session. */
  sessionId: string;
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
  | "pointerup"
  /** A programmatic user action recorded with `startAction()` / `trackAction()` (target = action name). */
  | "action";

export interface UIEvent extends BaseEvent {
  type: "ui";
  eventType: UIEventType;
  /** Short CSS-like descriptor of the target element, e.g. `button#save.primary`. */
  target: string;
  /** Human label for the target (aria-label, title, or trimmed text content). */
  label?: string;
  /** Browser event timestamp (`Event.timeStamp`); `timestamp - domTimestamp` = input delay. */
  domTimestamp?: number;
  /** True when this event started a new causal trace. */
  startsTrace?: boolean;
  /**
   * keydown / input / change only (v0.4): true when the target takes text entry
   * (text-like input, textarea, contenteditable, role textbox / searchbox /
   * combobox). Decided at capture time from the element type, never its value.
   * Absent from older engines and manual events.
   */
  editable?: boolean;
}

// ── Render Events ────────────────────────────────────────────────────

export type RenderSource = "manual" | "react-hook" | "react-profiler";
export type RenderPhase = "mount" | "update" | "nested-update";

/**
 * One component render. `timestamp` is when the render *started* (React's
 * `actualStartTime` when available, else commit time minus `durationMs`);
 * `commitTime` is when the commit containing it was applied. Consumers draw a
 * render as `[timestamp, timestamp + durationMs]`.
 */
export interface RenderEvent extends BaseEvent {
  type: "render";
  componentName: string;
  /** Stable id of the component instance (e.g. fiber identity), so N list items are not one component. */
  instanceId?: string;
  /** Duration of the render in ms, including children when known (0 when unknown). */
  durationMs: number;
  /** Render time excluding children, when known (React `selfBaseDuration`). */
  selfDurationMs?: number;
  /** Monotonic time the commit containing this render was applied, when known. */
  commitTime?: number;
  phase?: RenderPhase;
  source?: RenderSource;
  /** Monotonic id of the React commit this render belongs to. */
  commitId?: number;
  /** Nearest tracked parent component name. */
  parentComponent?: string;
  /** Names of props whose identity changed since the previous render. */
  changedProps?: string[];
  /** True when state/hooks changed since the previous render. */
  stateChanged?: boolean;
  /** True when context values changed since the previous render. */
  contextChanged?: boolean;
  /**
   * True when the component re-rendered with no prop, state or context change
   * (i.e. only because its parent rendered). Set by instrumentation.
   */
  wasted?: boolean;
  /** Optional snapshot hash to detect wasted renders (manual instrumentation). */
  propsHash?: string;
  /** Optional previous snapshot hash for comparison. */
  prevPropsHash?: string;
}

// ── Network Events ───────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface NetworkEvent extends BaseEvent {
  type: "network";
  /**
   * Sanitised URL: pathname (same-origin) or host + pathname (cross-origin).
   * Query values are stripped; only parameter names are kept, e.g. `/api/items?page&q`.
   */
  url: string;
  /** Upper-cased HTTP method; unknown methods are kept verbatim. */
  method: HttpMethod | (string & {});
  /** Total request duration in ms. */
  duration: number;
  /** Monotonic end time (timestamp + duration). */
  endTime?: number;
  /** HTTP status code (0 if the request failed before receiving a response). */
  status: number;
  /** True when the request was served from browser cache. */
  fromCache: boolean;
  /** Response body size in bytes (undefined when unknown). */
  responseSize?: number;
  initiator?: "fetch" | "xhr";
  /** Error message when the request failed or was aborted. */
  error?: string;
}

// ── Main-thread Events ───────────────────────────────────────────────

export interface LongTaskScript {
  /** e.g. `BUTTON#save.onclick`, `TimerHandler:setTimeout`, `Response.json.then`. */
  invoker: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  duration: number;
}

/** A main-thread block (> 50ms) from Long Animation Frames or Long Tasks API. */
export interface LongTaskEvent extends BaseEvent {
  type: "longtask";
  duration: number;
  /** Portion of the task beyond 50ms (the part that blocks input). */
  blockingDuration: number;
  api: "long-animation-frame" | "longtask";
  /** Script attribution (LoAF only). */
  scripts?: LongTaskScript[];
}

/** Interaction latency measured by the browser (Event Timing API — basis of INP). */
export interface InteractionEvent extends BaseEvent {
  type: "interaction";
  /** DOM event name, e.g. `click`, `keydown`, `pointerup`. */
  name: string;
  /** Browser interactionId grouping events of one user gesture (0 when absent). */
  interactionId: number;
  /** Input received -> next frame presented, in ms. */
  duration: number;
  inputDelay: number;
  processingMs: number;
  presentationDelay: number;
  target: string;
}

// ── Union ────────────────────────────────────────────────────────────

export type TrackedEvent = UIEvent | RenderEvent | NetworkEvent | LongTaskEvent | InteractionEvent;
export type TrackedEventType = TrackedEvent["type"];
