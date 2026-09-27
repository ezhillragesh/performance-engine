import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normaliseMethod, sanitizeUrl, startNetworkTracking } from "../tracker/networkTracker.js";
import { getEvents, resetStore } from "../logger/store.js";
import { beginTrace, getActiveTraceId, resetTraceContext } from "../trace/traceContext.js";
import { setTimeSource } from "../tracker/time.js";
import type { NetworkEvent } from "../types/events.js";

interface Deferred {
  resolve: (value: Response) => void;
  reject: (reason: unknown) => void;
}

const g = globalThis as { fetch?: typeof fetch; XMLHttpRequest?: unknown };
const realFetch = g.fetch;
const realXhr = g.XMLHttpRequest;
let pending: Deferred[] = [];
let fakeFetch: typeof fetch;
let clock = 0;

function fakeResponse(status = 200): Response {
  return { status, ok: status < 400, headers: new Headers({ "content-length": "12" }) } as Response;
}

class FakeXHR extends EventTarget {
  readyState = 0;
  status = 0;
  open(_method: string, _url: string): void {
    this.readyState = 1;
  }
  send(): void {}
  finish(status: number): void {
    this.readyState = 4;
    this.status = status;
    this.dispatchEvent(new Event("readystatechange"));
    this.dispatchEvent(new Event("load"));
    this.dispatchEvent(new Event("loadend"));
  }
}

function networkEvents(): NetworkEvent[] {
  return getEvents().filter((e): e is NetworkEvent => e.type === "network");
}

beforeEach(() => {
  clock = 100;
  setTimeSource(() => clock);
  resetStore();
  resetTraceContext();
  pending = [];
  fakeFetch = ((() =>
    new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    })) as unknown) as typeof fetch;
  g.fetch = fakeFetch;
  g.XMLHttpRequest = FakeXHR;
});

afterEach(() => {
  g.fetch = realFetch;
  g.XMLHttpRequest = realXhr;
  setTimeSource(undefined);
});

describe("sanitizeUrl (#27)", () => {
  it("keeps only the path for same-origin and host+path for cross-origin", () => {
    expect(sanitizeUrl("https://app.example.com/a/b?x=1&x=2&y#frag", "https://app.example.com/page")).toBe("/a/b?x&y");
    expect(sanitizeUrl("https://api.example.com/v1/users?email=a@b.c", "https://app.example.com/")).toBe(
      "api.example.com/v1/users?email",
    );
    expect(sanitizeUrl("/relative/path", "https://app.example.com/")).toBe("/relative/path");
    expect(sanitizeUrl("data:text/plain;base64,SGVsbG8=", "https://app.example.com/")).toBe("data:");
  });

  it("keeps unknown methods verbatim (#29)", () => {
    expect(normaliseMethod("propfind")).toBe("PROPFIND");
    expect(normaliseMethod(undefined)).toBe("GET");
    expect(normaliseMethod("post")).toBe("POST");
  });
});

describe("fetch tracking", () => {
  it("captures the trace at request start and re-activates it for the response", async () => {
    const stop = startNetworkTracking();
    const traceId = beginTrace("click");
    const request = g.fetch!("/api/items?id=5&token=abc", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 0)); // the click task ends
    clock += 5000; // original trace long expired
    expect(getActiveTraceId()).toBeUndefined();
    pending[0]!.resolve(fakeResponse());
    const activeInContinuation = await request.then(() => getActiveTraceId());
    expect(activeInContinuation).toBe(traceId);
    const [event] = networkEvents();
    expect(event).toMatchObject({
      url: "/api/items?id&token",
      method: "POST",
      status: 200,
      traceId,
      duration: 5000,
      endTime: 5100,
      responseSize: 12,
      initiator: "fetch",
    });
    stop();
  });

  it("records failures with an error message and rethrows", async () => {
    const stop = startNetworkTracking();
    const request = g.fetch!("/api/fail");
    pending[0]!.reject(new TypeError("Failed to fetch"));
    await expect(request).rejects.toThrow("Failed to fetch");
    expect(networkEvents()[0]).toMatchObject({ status: 0, error: "Failed to fetch" });
    stop();
  });

  it("reads method from Request objects", async () => {
    const stop = startNetworkTracking();
    const request = g.fetch!(new Request("http://localhost/x", { method: "PUT" }));
    pending[0]!.resolve(fakeResponse(404));
    await request;
    expect(networkEvents()[0]).toMatchObject({ method: "PUT", status: 404, error: "HTTP 404" });
    stop();
  });

  it("installs once with ref-counting and restores on last stop (#30)", async () => {
    const stopA = startNetworkTracking();
    const patched = g.fetch;
    const stopB = startNetworkTracking();
    expect(g.fetch).toBe(patched);
    expect(g.fetch).not.toBe(fakeFetch);
    const request = g.fetch!("/once");
    pending[0]!.resolve(fakeResponse());
    await request;
    expect(networkEvents()).toHaveLength(1);
    stopA();
    stopA();
    expect(g.fetch).toBe(patched);
    stopB();
    expect(g.fetch).toBe(fakeFetch);
  });
});

describe("XHR tracking", () => {
  it("records the request and re-activates its trace when the response is ready", () => {
    const stop = startNetworkTracking();
    const traceId = beginTrace("click");
    const xhr = new (g.XMLHttpRequest as typeof FakeXHR)();
    let activeInHandler: string | undefined;
    xhr.addEventListener("load", () => {
      activeInHandler = getActiveTraceId();
    });
    xhr.open("get", "https://other.example.com/api/list?page=2");
    xhr.send();
    clock += 3000;
    xhr.finish(200);
    expect(activeInHandler).toBe(traceId);
    expect(networkEvents()[0]).toMatchObject({
      url: "other.example.com/api/list?page",
      method: "GET",
      status: 200,
      initiator: "xhr",
      traceId,
      duration: 3000,
    });
    stop();
  });
});

describe("fetch body completion (resource timing)", () => {
  it("records the fetch when its resource entry arrives, with the body end as endTime", async () => {
    const gg = globalThis as Record<string, unknown>;
    const realPO = gg.PerformanceObserver;
    const hadDocument = "document" in gg;
    let deliver: ((entries: unknown[]) => void) | undefined;
    class FakePO {
      static supportedEntryTypes = ["resource"];
      constructor(cb: (list: { getEntries(): unknown[] }) => void) {
        deliver = (entries) => cb({ getEntries: () => entries });
      }
      observe(): void {}
      disconnect(): void {}
    }
    gg.PerformanceObserver = FakePO;
    if (!hadDocument) gg.document = {};
    try {
      const stop = startNetworkTracking();
      const request = g.fetch!("http://localhost/api/big");
      clock += 50; // headers after 50ms
      pending[0]!.resolve(fakeResponse());
      await request;
      expect(networkEvents()).toHaveLength(0); // body still downloading
      clock += 400;
      deliver!([{ name: "http://localhost/api/big", startTime: 100, responseEnd: 530, transferSize: 900, encodedBodySize: 800, decodedBodySize: 800 }]);
      expect(networkEvents()[0]).toMatchObject({ url: "/api/big", duration: 430, endTime: 530, responseSize: 800 });
      stop();
    } finally {
      gg.PerformanceObserver = realPO;
      if (!hadDocument) delete gg.document;
    }
  });
});

describe("XHR re-open", () => {
  it("open() on an in-flight request detaches its listeners: no duplicate event", () => {
    const stop = startNetworkTracking();
    const xhr = new (g.XMLHttpRequest as typeof FakeXHR)();
    xhr.open("GET", "/first");
    xhr.send();
    clock += 10;
    xhr.open("GET", "/second"); // cancels /first without firing loadend
    xhr.send();
    clock += 20;
    xhr.finish(200);
    const events = networkEvents();
    expect(events.map((e) => [e.url, e.status, e.error])).toEqual([
      ["/first", 0, "aborted"],
      ["/second", 200, undefined],
    ]);
    stop();
  });
});
