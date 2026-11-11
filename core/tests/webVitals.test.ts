import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addInteraction,
  addLayoutShift,
  createClsState,
  createInpState,
  emptyWebVitals,
  estimateInteractionCount,
  inpCandidate,
  rateWebVital,
  startWebVitalsTracking,
  type InpCandidate,
} from "../tracker/webVitals.js";
import { initPerfEngine, type PerfEngineSession } from "../session.js";
import { onUserEvent, resetTraceContext } from "../trace/traceContext.js";
import { setTimeSource } from "../tracker/time.js";

// ── fake PerformanceObserver + DOM bits ─────────────────────────────

type Callback = (list: { getEntries(): unknown[] }) => void;
const observers: { type: string; options: Record<string, unknown>; cb: Callback }[] = [];
const g = globalThis as Record<string, unknown>;
const real = { PerformanceObserver: g.PerformanceObserver, Element: g.Element, document: g.document };

class FakeObserver {
  static supportedEntryTypes: string[] = [];
  constructor(private cb: Callback) {}
  observe(options: { type: string } & Record<string, unknown>): void {
    observers.push({ type: options.type, options, cb: this.cb });
  }
  disconnect(): void {
    for (let i = observers.length - 1; i >= 0; i -= 1) if (observers[i]!.cb === this.cb) observers.splice(i, 1);
  }
}

function emit(type: string, entries: unknown[]): void {
  for (const o of observers.filter((x) => x.type === type)) o.cb({ getEntries: () => entries });
}

/** Minimal Element so describeTarget works in the node environment. */
class FakeElement {
  constructor(
    public tagName: string,
    public id = "",
    private cls = "",
  ) {}
  getAttribute(name: string): string | null {
    return name === "class" ? this.cls || null : null;
  }
}

let visibilityListener: ((event: { timeStamp: number }) => void) | null = null;
const fakeDocument = {
  visibilityState: "visible",
  addEventListener: (type: string, fn: (event: { timeStamp: number }) => void) => {
    if (type === "visibilitychange") visibilityListener = fn;
  },
  removeEventListener: () => {
    visibilityListener = null;
  },
};

const ALL_TYPES = ["largest-contentful-paint", "layout-shift", "paint", "navigation", "event"];
let clock = 0;

beforeEach(() => {
  observers.length = 0;
  FakeObserver.supportedEntryTypes = ALL_TYPES.slice();
  g.PerformanceObserver = FakeObserver;
  g.Element = FakeElement;
  fakeDocument.visibilityState = "visible";
  g.document = fakeDocument;
  clock = 1000;
  setTimeSource(() => clock);
  resetTraceContext();
});

afterEach(() => {
  g.PerformanceObserver = real.PerformanceObserver;
  g.Element = real.Element;
  if (real.document === undefined) delete g.document;
  else g.document = real.document;
  setTimeSource(undefined);
  vi.restoreAllMocks();
});

function candidate(interactionId: number, duration: number, extra: Partial<InpCandidate> = {}): InpCandidate {
  return { name: "click", target: "button", interactionId, startTime: 0, duration, inputDelay: 0, processingMs: duration, presentationDelay: 0, ...extra };
}

describe("web vitals math", () => {
  it("rates with inclusive good thresholds", () => {
    expect(rateWebVital("lcp", 2500)).toBe("good");
    expect(rateWebVital("lcp", 2501)).toBe("needs-improvement");
    expect(rateWebVital("cls", 0.26)).toBe("poor");
    expect(rateWebVital("inp", null)).toBeNull();
    expect(rateWebVital("ttfb", Number.NaN)).toBeNull();
  });

  it("CLS is the largest session window (gap < 1s, window < 5s)", () => {
    const s = createClsState();
    addLayoutShift(s, 0, 0.1);
    addLayoutShift(s, 500, 0.1); // same window: 0.2
    addLayoutShift(s, 3000, 0.05); // gap > 1s: new window
    expect(s.max).toBeCloseTo(0.2);
    expect(s.windowId).toBe(2);
    for (let t = 3500; t < 8000; t += 500) addLayoutShift(s, t, 0.01); // 0.05 + 9 × 0.01 = 0.14
    expect(s.windowId).toBe(2);
    addLayoutShift(s, 8000, 0.01); // 5s after the window opened: a new window
    expect(s.windowId).toBe(3);
    expect(s.max).toBeCloseTo(0.2);
    expect(addLayoutShift(s, 10_000, 0)).toBe(false);
  });

  it("INP ignores one outlier per 50 interactions and keeps only 10 candidates", () => {
    const s = createInpState();
    for (let i = 1; i <= 120; i += 1) addInteraction(s, candidate(i * 7, i)); // durations 1..120
    expect(s.longest).toHaveLength(10);
    expect(estimateInteractionCount(s)).toBe(120);
    expect(inpCandidate(s, 120)!.duration).toBe(118); // floor(120 / 50) = 2 outliers skipped
    expect(inpCandidate(s, 10)!.duration).toBe(120);
    // Several entries of one interaction: the longest counts, once.
    addInteraction(s, candidate(120 * 7, 500));
    expect(s.longest.filter((c) => c.interactionId === 840)).toHaveLength(1);
    expect(inpCandidate(s, 1)!.duration).toBe(500);
    expect(addInteraction(s, candidate(0, 900))).toBe(false); // no interactionId: not an interaction
  });
});

describe("startWebVitalsTracking", () => {
  it("is inert without PerformanceObserver (SSR)", () => {
    delete g.PerformanceObserver;
    delete g.document;
    const tracker = startWebVitalsTracking();
    expect(tracker.read()).toEqual(emptyWebVitals());
    tracker.stop();
  });

  it("measures LCP / FCP / TTFB relative to activationStart, with LCP attribution", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ activationStart: 100 }] as unknown as PerformanceEntryList);
    const tracker = startWebVitalsTracking();
    const before = tracker.revision();
    emit("navigation", [{ responseStart: 350 }]);
    emit("paint", [{ name: "first-paint", startTime: 400 }, { name: "first-contentful-paint", startTime: 600 }]);
    emit("largest-contentful-paint", [
      { startTime: 700, element: new FakeElement("H1") },
      { startTime: 1900, element: new FakeElement("IMG", "hero", "banner wide extra"), url: "https://cdn.example.com/hero.jpg?token=secret" },
    ]);
    const v = tracker.read();
    expect(v).toMatchObject({ ttfb: 250, fcp: 500, lcp: 1800, lcpTarget: "img#hero.banner.wide", cls: 0, inp: null });
    expect(v.attribution.lcp).toEqual({ target: "img#hero.banner.wide", url: "cdn.example.com/hero.jpg?token", startTime: 1900 });
    expect(tracker.revision()).toBeGreaterThan(before);
    tracker.stop();
  });

  it("ignores paints after the page was first hidden", () => {
    const tracker = startWebVitalsTracking();
    emit("largest-contentful-paint", [{ startTime: 500, element: new FakeElement("P") }]);
    fakeDocument.visibilityState = "hidden";
    visibilityListener?.({ timeStamp: 800 });
    emit("largest-contentful-paint", [{ startTime: 1200, element: new FakeElement("IMG") }]);
    expect(tracker.read()).toMatchObject({ lcp: 500, lcpTarget: "p" });
    tracker.stop();
  });

  it("a page loaded in the background reports no LCP / FCP", () => {
    fakeDocument.visibilityState = "hidden";
    const tracker = startWebVitalsTracking();
    emit("paint", [{ name: "first-contentful-paint", startTime: 300 }]);
    emit("largest-contentful-paint", [{ startTime: 300, element: new FakeElement("P") }]);
    expect(tracker.read()).toMatchObject({ lcp: null, fcp: null });
    tracker.stop();
  });

  it("CLS excludes shifts after input and attributes the largest shift of the worst window", () => {
    const tracker = startWebVitalsTracking();
    const node = new FakeElement("DIV", "ad");
    emit("layout-shift", [
      { startTime: 100, value: 0.02, sources: [{ node: new FakeElement("P") }] },
      { startTime: 300, value: 0.08, sources: [{ node: null }, { node }] },
      { startTime: 400, value: 0.01, sources: [] },
      { startTime: 450, value: 0.5, hadRecentInput: true },
    ]);
    const v = tracker.read();
    expect(v.cls).toBeCloseTo(0.11);
    expect(v.attribution.cls).toEqual({ target: "div#ad", startTime: 300, value: 0.08 });
    tracker.stop();
  });

  it("INP: the p98 interaction with its phases and the causal trace of that click", () => {
    clock = 5000;
    const { traceId } = onUserEvent("click", 5000);
    const tracker = startWebVitalsTracking();
    emit("event", [
      { name: "pointerdown", interactionId: 14, startTime: 5001, duration: 120, processingStart: 5005, processingEnd: 5006, target: new FakeElement("BUTTON", "save") },
      { name: "click", interactionId: 14, startTime: 5002, duration: 312, processingStart: 5010, processingEnd: 5250, target: new FakeElement("BUTTON", "save") },
      { name: "mousemove", interactionId: 0, startTime: 5003, duration: 900 },
    ]);
    const v = tracker.read();
    expect(v.inp).toBe(312);
    expect(v.interactions).toBe(1);
    expect(v.attribution.inp).toEqual({
      name: "click",
      target: "button#save",
      interactionId: 14,
      startTime: 5002,
      inputDelay: 8,
      processingMs: 240,
      presentationDelay: 64,
      traceId,
    });
    tracker.stop();
    expect(observers).toHaveLength(0);
  });

  it("read() returns a detached, JSON-safe copy", () => {
    const tracker = startWebVitalsTracking();
    const a = tracker.read();
    a.lcp = 1;
    expect(tracker.read().lcp).toBeNull();
    expect(JSON.parse(JSON.stringify(tracker.read()))).toEqual(tracker.read());
    tracker.stop();
  });
});

describe("session integration", () => {
  let session: PerfEngineSession | null = null;
  afterEach(() => {
    session?.stop();
    session = null;
  });

  it("snapshots carry vitals; clear() keeps them; changes move the change signature", () => {
    session = initPerfEngine({ trackEvents: false, trackLongTasks: false, trackInteractions: false, devtools: false });
    const sig = session.getChangeSignature();
    emit("largest-contentful-paint", [{ startTime: 1500, element: new FakeElement("IMG") }]);
    expect(session.getChangeSignature()).not.toBe(sig);
    expect(session.getSnapshot().vitals).toMatchObject({ lcp: 1500, lcpTarget: "img" });
    session.clear();
    expect(session.getWebVitals().lcp).toBe(1500);
  });

  it("an analysis tick notifies subscribers when only the vitals changed", () => {
    vi.useFakeTimers();
    try {
      session = initPerfEngine({ analysisIntervalMs: 100, devtools: false });
      const listener = vi.fn();
      session.subscribe(listener);
      vi.advanceTimersByTime(100);
      listener.mockClear();
      vi.advanceTimersByTime(300);
      expect(listener).not.toHaveBeenCalled(); // nothing changed
      emit("layout-shift", [{ startTime: 10, value: 0.3 }]);
      vi.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0].vitals.cls).toBe(0.3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("trackWebVitals: false installs no vitals observers and reports nulls", () => {
    session = initPerfEngine({ trackWebVitals: false, trackLongTasks: false, trackInteractions: false, devtools: false });
    expect(observers).toHaveLength(0);
    expect(session.features.trackWebVitals).toBe(false);
    expect(session.getWebVitals()).toEqual(emptyWebVitals());
  });
});
