/**
 * Network tracker: wraps fetch and XMLHttpRequest.
 *
 * - The active trace id is captured when the request *starts*; the trace is
 *   re-activated when the response is delivered so work caused by the
 *   response (renders) is attributed causally.
 * - URLs are sanitised (no query values, no origin for same-origin requests).
 * - fetch resolves at response *headers*; the body may still be downloading.
 *   In browsers the event is therefore recorded once the request's
 *   PerformanceResourceTiming entry arrives (i.e. when the body completed),
 *   falling back to the headers time after RESOURCE_WAIT_MS. XHR is recorded
 *   at `loadend`, which is already after the body.
 * - Installation is ref-counted and idempotent; the original functions are
 *   restored when the last tracker stops.
 */

import type { HttpMethod, NetworkEvent } from "../types/events.js";
import { pushEvent } from "../logger/store.js";
import { activateTrace, captureTraceId } from "../trace/traceContext.js";
import { generateEventId, getCurrentSessionId } from "./id.js";
import { now } from "./time.js";

const KNOWN_METHODS: ReadonlySet<string> = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function normaliseMethod(method: string | undefined | null): NetworkEvent["method"] {
  if (!method) return "GET";
  const upper = String(method).toUpperCase();
  return KNOWN_METHODS.has(upper) ? (upper as HttpMethod) : upper;
}

function currentHref(): string | undefined {
  try {
    return typeof location !== "undefined" && typeof location.href === "string" ? location.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Same-origin -> `/path`, cross-origin -> `host/path`. Query values are
 * removed; parameter names are kept (`/search?q&page`). Hash is dropped.
 */
export function sanitizeUrl(rawUrl: string, baseHref: string | undefined = currentHref()): string {
  try {
    const base = baseHref ?? "http://localhost/";
    const parsed = new URL(rawUrl, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return parsed.protocol; // data:, blob: … never include payloads
    }
    const baseOrigin = new URL(base).origin;
    const prefix = parsed.origin === baseOrigin ? "" : parsed.host;
    let query = "";
    if (parsed.search.length > 1) {
      const names = Array.from(new Set(Array.from(parsed.searchParams.keys())));
      query = `?${names.join("&")}`;
    }
    return `${prefix}${parsed.pathname}${query}`;
  } catch {
    // Unparseable: strip anything after ? or # to be safe.
    return rawUrl.split(/[?#]/)[0] ?? "";
  }
}

function absoluteUrl(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl, currentHref() ?? "http://localhost/").href;
  } catch {
    return undefined;
  }
}

interface ResourceMatch {
  responseEnd: number;
  fromCache: boolean;
  responseSize?: number;
}

interface ResourceEntryLike {
  name: string;
  startTime: number;
  responseEnd: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

function matchFromEntry(entry: ResourceEntryLike): ResourceMatch {
  const match: ResourceMatch = {
    responseEnd: entry.responseEnd,
    fromCache: entry.transferSize === 0 && entry.decodedBodySize > 0,
  };
  if (entry.encodedBodySize > 0) match.responseSize = entry.encodedBodySize;
  return match;
}

/** Best-effort correlation with the PerformanceResourceTiming entry. */
function findResourceTiming(rawUrl: string, start: number): ResourceMatch | undefined {
  try {
    if (typeof performance === "undefined" || typeof performance.getEntriesByName !== "function") {
      return undefined;
    }
    const href = absoluteUrl(rawUrl);
    if (!href) return undefined;
    const entries = performance.getEntriesByName(href, "resource") as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]!;
      if (entry.startTime + 5 < start) break;
      if (!(entry.responseEnd > 0)) continue;
      return matchFromEntry(entry);
    }
  } catch {
    // ignore
  }
  return undefined;
}

interface RequestMeta {
  rawUrl: string;
  method: NetworkEvent["method"];
  start: number;
  traceId: string | undefined;
  initiator: "fetch" | "xhr";
  /** Removes XHR listeners (set while a request is in flight). */
  cleanup?: () => void;
}

interface Outcome {
  status: number;
  error?: string;
  responseSize?: number;
}

function record(meta: RequestMeta, outcome: Outcome, known?: ResourceMatch, observedEnd?: number): void {
  try {
    const end = observedEnd ?? now();
    const timing = known ?? findResourceTiming(meta.rawUrl, meta.start);
    const latest = now();
    const endTime = timing && timing.responseEnd >= meta.start && timing.responseEnd <= latest + 1 ? timing.responseEnd : end;
    const duration = Math.max(0, Math.round((endTime - meta.start) * 100) / 100);
    const event: NetworkEvent = {
      type: "network",
      url: sanitizeUrl(meta.rawUrl),
      method: meta.method,
      duration,
      endTime: meta.start + duration,
      status: outcome.status,
      fromCache: timing?.fromCache ?? false,
      initiator: meta.initiator,
      timestamp: meta.start,
      eventId: generateEventId(),
      sessionId: getCurrentSessionId(),
    };
    const size = timing?.responseSize ?? outcome.responseSize;
    if (size !== undefined) event.responseSize = size;
    if (outcome.error !== undefined) event.error = outcome.error;
    if (meta.traceId !== undefined) event.traceId = meta.traceId;
    pushEvent(event);
  } catch {
    // never throw into the host app
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && (err as { name: unknown }).name === "AbortError") {
    return "aborted";
  }
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function hasRequestCtor(): boolean {
  return typeof Request !== "undefined";
}

function describeFetchInput(input: unknown, init: RequestInit | undefined): { rawUrl: string; method: NetworkEvent["method"] } {
  let rawUrl = "";
  let method: string | undefined = init?.method;
  if (typeof input === "string") {
    rawUrl = input;
  } else if (hasRequestCtor() && input instanceof Request) {
    rawUrl = input.url;
    method = method ?? input.method;
  } else if (input && typeof input === "object" && "href" in input) {
    rawUrl = String((input as URL).href);
  } else if (input !== undefined && input !== null) {
    rawUrl = String(input);
  }
  return { rawUrl, method: normaliseMethod(method) };
}

function contentLength(response: Response): number | undefined {
  try {
    const header = response.headers?.get?.("content-length");
    if (!header) return undefined;
    const size = Number(header);
    return Number.isFinite(size) && size >= 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

// ── deferred fetch recording (body completion) ───────────────────────

/** Max wait for a fetch's resource timing entry before recording with headers timing. */
export const RESOURCE_WAIT_MS = 10_000;

interface PendingFetch {
  meta: RequestMeta;
  outcome: Outcome;
  href: string;
  headersAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

let pendingFetches: PendingFetch[] = [];
let resourceObserver: { disconnect(): void } | null = null;

function resourceTimingObservable(): boolean {
  // Browsers only: Node exposes PerformanceObserver but not for patched fetches.
  if (typeof document === "undefined" || typeof PerformanceObserver === "undefined") return false;
  const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
  return Array.isArray(types) && types.includes("resource");
}

function flushPending(item: PendingFetch, match?: ResourceMatch): void {
  const idx = pendingFetches.indexOf(item);
  if (idx < 0) return;
  pendingFetches.splice(idx, 1);
  if (item.timer !== undefined) clearTimeout(item.timer);
  record(item.meta, item.outcome, match, item.headersAt);
}

function onResourceEntries(entries: readonly ResourceEntryLike[]): void {
  for (const entry of entries) {
    if (!(entry.responseEnd > 0)) continue;
    // Oldest pending request for this URL that started before the entry.
    const item = pendingFetches.find((p) => p.href === entry.name && entry.startTime + 5 >= p.meta.start);
    if (item) flushPending(item, matchFromEntry(entry));
  }
}

function ensureResourceObserver(): boolean {
  if (resourceObserver) return true;
  try {
    const observer = new PerformanceObserver((list) => {
      try {
        onResourceEntries(list.getEntries() as unknown as ResourceEntryLike[]);
      } catch {
        // never throw from an observer callback
      }
    });
    observer.observe({ type: "resource" } as PerformanceObserverInit);
    resourceObserver = observer;
    return true;
  } catch {
    return false;
  }
}

/**
 * Records a fetch whose headers arrived: immediately when the body timing is
 * already known or cannot be observed, else when its resource entry arrives.
 */
function recordFetch(meta: RequestMeta, outcome: Outcome): void {
  const headersAt = now();
  const href = absoluteUrl(meta.rawUrl);
  if (!href || !resourceTimingObservable() || !ensureResourceObserver()) {
    record(meta, outcome, undefined, headersAt);
    return;
  }
  const item: PendingFetch = { meta, outcome, href, headersAt, timer: undefined };
  pendingFetches.push(item);
  item.timer = setTimeout(() => flushPending(item), RESOURCE_WAIT_MS);
  (item.timer as { unref?: () => void }).unref?.();
}

function stopResourceObserver(): void {
  for (const item of pendingFetches.slice()) flushPending(item);
  pendingFetches = [];
  try {
    resourceObserver?.disconnect();
  } catch {
    // ignore
  }
  resourceObserver = null;
}

// ── install state (ref-counted) ──────────────────────────────────────

let refCount = 0;
let restoreFns: Array<() => void> = [];

function installFetch(): void {
  const target = globalThis as { fetch?: typeof fetch };
  const originalFetch = target.fetch;
  if (typeof originalFetch !== "function") return;
  // Cleared on uninstall: if someone wrapped fetch after us we cannot unhook,
  // so the patch stays in their chain as a pure pass-through.
  let live = true;

  const patchedFetch = function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!live) return originalFetch.call(globalThis, input, init);
    let meta: RequestMeta | undefined;
    try {
      const { rawUrl, method } = describeFetchInput(input, init);
      meta = { rawUrl, method, start: now(), traceId: captureTraceId(), initiator: "fetch" };
    } catch {
      meta = undefined;
    }
    const pending = originalFetch.call(globalThis, input, init);
    if (!meta) return pending;
    const m = meta;
    return pending.then(
      (response) => {
        const outcome: Outcome = { status: response.status };
        const len = contentLength(response);
        if (len !== undefined) outcome.responseSize = len;
        if (!response.ok && response.status >= 400) outcome.error = `HTTP ${response.status}`;
        recordFetch(m, outcome);
        // Response window: the caller's continuation runs next and inherits the trace.
        if (m.traceId) activateTrace(m.traceId);
        return response;
      },
      (err: unknown) => {
        record(m, { status: 0, error: errorMessage(err) });
        if (m.traceId) activateTrace(m.traceId);
        throw err;
      },
    );
  };

  target.fetch = patchedFetch as typeof fetch;
  restoreFns.push(() => {
    live = false;
    // Only restore if nobody wrapped fetch after us.
    if (target.fetch === (patchedFetch as typeof fetch)) target.fetch = originalFetch;
    stopResourceObserver();
  });
}

const xhrMeta = new WeakMap<XMLHttpRequest, RequestMeta>();

function installXhr(): void {
  const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (!XHR || !XHR.prototype) return;
  const proto = XHR.prototype;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  let live = true;

  const patchedOpen = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
    if (!live) return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    try {
      // open() on an in-flight request cancels it without firing abort/loadend:
      // detach its listeners (or they would also fire for the next request).
      const previous = xhrMeta.get(this);
      if (previous?.cleanup) {
        previous.cleanup();
        record(previous, { status: 0, error: "aborted" });
      }
      xhrMeta.set(this, {
        rawUrl: typeof url === "string" ? url : String(url),
        method: normaliseMethod(method),
        start: 0,
        traceId: undefined,
        initiator: "xhr",
      });
    } catch {
      // ignore
    }
    // `open` has overloads; forward the original arguments verbatim.
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  };

  const patchedSend = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    try {
      const meta = live ? xhrMeta.get(this) : undefined;
      if (meta) {
        meta.start = now();
        meta.traceId = captureTraceId();
        let failure: string | undefined;
        const xhr = this;
        const onFail = (ev: Event): void => {
          failure = ev.type === "abort" ? "aborted" : ev.type === "timeout" ? "timeout" : "network error";
        };
        const onReady = (): void => {
          if (xhr.readyState === 4 && meta.traceId) activateTrace(meta.traceId);
        };
        const cleanup = (): void => {
          meta.cleanup = undefined;
          xhr.removeEventListener("loadend", onDone);
          xhr.removeEventListener("readystatechange", onReady);
          xhr.removeEventListener("error", onFail);
          xhr.removeEventListener("abort", onFail);
          xhr.removeEventListener("timeout", onFail);
        };
        const onDone = (): void => {
          cleanup();
          const outcome: Outcome = { status: xhr.status };
          if (failure) outcome.error = failure;
          else if (xhr.status >= 400) outcome.error = `HTTP ${xhr.status}`;
          record(meta, outcome);
        };
        this.addEventListener("readystatechange", onReady);
        this.addEventListener("error", onFail);
        this.addEventListener("abort", onFail);
        this.addEventListener("timeout", onFail);
        this.addEventListener("loadend", onDone);
        meta.cleanup = cleanup;
      }
    } catch {
      // bookkeeping failures must not prevent the request
    }
    return originalSend.call(this, body);
  };

  proto.open = patchedOpen as typeof proto.open;
  proto.send = patchedSend;
  restoreFns.push(() => {
    live = false;
    if (proto.open === (patchedOpen as typeof proto.open)) proto.open = originalOpen;
    if (proto.send === patchedSend) proto.send = originalSend;
  });
}

/**
 * Starts tracking network requests. Safe to call multiple times: the
 * patches are installed once and removed when every returned cleanup has run.
 */
export function startNetworkTracking(): () => void {
  if (refCount === 0) {
    restoreFns = [];
    try {
      installFetch();
      installXhr();
    } catch {
      // partial install is fine
    }
  }
  refCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount -= 1;
    if (refCount === 0) {
      for (const restore of restoreFns) {
        try {
          restore();
        } catch {
          // ignore
        }
      }
      restoreFns = [];
    }
  };
}

export function isNetworkTrackingInstalled(): boolean {
  return refCount > 0;
}
