/**
 * Network request tracker.
 *
 * Intercepts fetch and XMLHttpRequest to record network events.
 */

import type { HttpMethod } from "../types/events";
import { pushEvent } from "../logger/store";
import { now } from "./time";
import { generateEventId, getCurrentSessionId } from "./id";

function normaliseMethod(method: string | undefined): HttpMethod {
  const upper = (method ?? "GET").toUpperCase();
  const valid: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  return (valid.includes(upper as HttpMethod) ? upper : "GET") as HttpMethod;
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url, globalThis.location?.href);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Starts tracking network requests. Returns a cleanup function. */
export function startNetworkTracking(): () => void {
  const originalFetch = globalThis.fetch;
  const cleanups: Array<() => void> = [];

  // ── Fetch interception ──────────────────────────────────────────

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const start = now();
    const method = normaliseMethod(init?.method ?? (input instanceof Request ? input.method : undefined));
    const url = typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();

    try {
      const response = await originalFetch.call(globalThis, input, init);
      pushEvent({
        type: "network",
        url: shortenUrl(url),
        method,
        duration: Math.round(now() - start),
        status: response.status,
        fromCache: false,
        timestamp: start,
        eventId: generateEventId(),
        sessionId: getCurrentSessionId(),
      });
      return response;
    } catch (err) {
      pushEvent({
        type: "network",
        url: shortenUrl(url),
        method,
        duration: Math.round(now() - start),
        status: 0,
        fromCache: false,
        timestamp: start,
        eventId: generateEventId(),
        sessionId: getCurrentSessionId(),
      });
      throw err;
    }
  };

  cleanups.push(() => {
    globalThis.fetch = originalFetch;
  });

  // ── XMLHttpRequest interception ─────────────────────────────────

  const XHR = globalThis.XMLHttpRequest;
  if (XHR) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      (this as unknown as Record<string, unknown>).__perfMethod = normaliseMethod(method);
      (this as unknown as Record<string, unknown>).__perfUrl = typeof url === "string" ? url : url.toString();
      return (originalOpen as Function).call(this, method, url, ...rest);
    };

    XHR.prototype.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
      const start = now();
      const method = ((this as unknown as Record<string, unknown>).__perfMethod ?? "GET") as HttpMethod;
      const url = ((this as unknown as Record<string, unknown>).__perfUrl ?? "") as string;

      const onDone = (): void => {
        pushEvent({
          type: "network",
          url: shortenUrl(url),
          method,
          duration: Math.round(now() - start),
          status: this.status,
          fromCache: false,
          timestamp: start,
          eventId: generateEventId(),
          sessionId: getCurrentSessionId(),
        });
        this.removeEventListener("loadend", onDone);
      };

      this.addEventListener("loadend", onDone);
      return originalSend.call(this, body);
    };

    cleanups.push(() => {
      XHR.prototype.open = originalOpen;
      XHR.prototype.send = originalSend;
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

export function stopNetworkTracking(): void {
  // Kept for backward compat; prefer the cleanup returned by startNetworkTracking.
}
