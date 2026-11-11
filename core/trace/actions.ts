/**
 * Framework-agnostic user actions: name a piece of work ("checkout",
 * "route:/inbox", "ws:message") so the renders, requests and long tasks it
 * causes are grouped into one causal trace, exactly like a click.
 *
 * - Outside any trace, `startAction` opens a new trace whose trigger is a
 *   UI event `{ eventType: "action", target: name }`.
 * - Inside a live trace (e.g. called from a click handler), the action joins
 *   that trace by default: the click stays the cause, the action names it
 *   (`TraceSummary.action`). Pass `{ newTrace: true }` to split it off.
 * - Nothing is recorded while no engine session is running (or the session
 *   was not sampled); the handle then just runs your code.
 *
 * Action names are developer-provided labels and are sent to DevTools as is:
 * never put user data (ids, e-mails, search terms) into them.
 */

import type { UIEvent } from "../types/events.js";
import { pushEvent } from "../logger/store.js";
import { generateEventId, getCurrentSessionId } from "../tracker/id.js";
import { now } from "../tracker/time.js";
import { activateTrace, beginTrace, endTrace, getActiveTraceId, runInTrace } from "./traceContext.js";

export const MAX_ACTION_NAME_LENGTH = 80;

export interface ActionOptions {
  /** Open a new trace even when one is active (default false: join it). */
  newTrace?: boolean;
}

export interface ActionHandle {
  /** Trace the action's work is attributed to; undefined when nothing is being recorded. */
  readonly traceId: string | undefined;
  readonly name: string;
  /** True when the action opened its own trace (false when it joined a live one). */
  readonly startsTrace: boolean;
  /**
   * Runs `fn` attributed to the action (use it for a continuation after an
   * `await` that is not a fetch/XHR, which re-attach on their own). When `fn`
   * returns a native Promise, `run` returns a promise that settles the same
   * way right after re-activating the trace, so the caller's continuation is
   * attributed too. Any other result is returned as is.
   */
  run<T>(fn: () => T): T;
  /**
   * Stops attributing new work to the action's own trace now. Idempotent; an
   * action that joined a live trace never ends that trace.
   */
  end(): void;
}

let enabled = false;

/** Set by the session (like render tracking): actions are recorded only while a session runs. */
export function setActionTrackingEnabled(value: boolean): void {
  enabled = value;
}

export function isActionTrackingEnabled(): boolean {
  return enabled;
}

function actionName(name: unknown): string {
  const text = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
  if (!text) return "action";
  return text.length > MAX_ACTION_NAME_LENGTH ? `${text.slice(0, MAX_ACTION_NAME_LENGTH - 1)}…` : text;
}

/** Opens (or joins) the action's trace and records its event. Never throws. */
function record(label: string, options: ActionOptions): { traceId: string | undefined; startsTrace: boolean } {
  if (!enabled) return { traceId: undefined, startsTrace: false };
  try {
    const live = options.newTrace === true ? undefined : getActiveTraceId();
    const traceId = live ?? beginTrace("action");
    const startsTrace = live === undefined;
    const event: UIEvent = {
      type: "ui",
      eventType: "action",
      target: label,
      timestamp: now(),
      eventId: generateEventId(),
      sessionId: getCurrentSessionId(),
      traceId,
    };
    if (startsTrace) event.startsTrace = true;
    pushEvent(event);
    return { traceId, startsTrace };
  } catch {
    return { traceId: undefined, startsTrace: false };
  }
}

/**
 * Starts a named action and returns a handle. Never throws into the host
 * app: when recording fails the handle still runs your code, unattributed.
 */
export function startAction(name: string, options: ActionOptions = {}): ActionHandle {
  const label = actionName(name);
  const { traceId, startsTrace } = record(label, options);
  let ended = false;
  return {
    traceId,
    name: label,
    startsTrace,
    run<T>(fn: () => T): T {
      if (traceId === undefined) return fn();
      ended = false;
      const result = runInTrace(traceId, fn);
      if (!(typeof Promise !== "undefined" && result instanceof Promise)) return result;
      const reactivate = (): void => {
        try {
          if (!ended) activateTrace(traceId);
        } catch {
          // never throw into the host app
        }
      };
      // Chained, not a side branch: a side branch would either mark the caller's promise as
      // handled (hiding unhandled rejections) or create a second, spurious unhandled rejection.
      return result.then(
        (value: unknown) => {
          reactivate();
          return value;
        },
        (error: unknown) => {
          reactivate();
          throw error;
        },
      ) as T;
    },
    end(): void {
      if (ended || traceId === undefined) return;
      ended = true;
      if (!startsTrace) return;
      try {
        endTrace(traceId);
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Runs `fn` as a named action: `trackAction("save", () => api.save(draft))`.
 * Returns `fn`'s result (see `ActionHandle.run` for promises).
 */
export function trackAction<T>(name: string, fn: () => T, options: ActionOptions = {}): T {
  return startAction(name, options).run(fn);
}
