import { logEvent } from "../logger/store";
import { now } from "./time";

let originalFetch: typeof globalThis.fetch | null = null;
let isTracking = false;

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }

  return String(input);
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string | undefined {
  if (init?.method) {
    return init.method;
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method;
  }

  return undefined;
}

export function startNetworkTracking(): () => void {
  if (isTracking || typeof globalThis.fetch !== "function") {
    return stopNetworkTracking;
  }

  originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    const method = resolveMethod(input, init);
    const start = now();

    try {
      const response = await originalFetch!(input as RequestInfo, init);
      const duration = Math.round(now() - start);

      logEvent({
        type: "network",
        url,
        duration,
        timestamp: now(),
        method,
        status: response.status,
        success: response.ok,
      });

      return response;
    } catch (error) {
      const duration = Math.round(now() - start);

      logEvent({
        type: "network",
        url,
        duration,
        timestamp: now(),
        method,
        success: false,
      });

      throw error;
    }
  }) as typeof globalThis.fetch;

  isTracking = true;
  return stopNetworkTracking;
}

export function stopNetworkTracking(): void {
  if (!isTracking || !originalFetch) {
    return;
  }

  globalThis.fetch = originalFetch;
  originalFetch = null;
  isTracking = false;
}
