/**
 * Core Web Vitals (LCP, INP, CLS, FCP, TTFB) with attribution.
 *
 * Same definitions as the `web-vitals` library and the DevTools panel's
 * collector (docs/PROTOCOL.md), without a dependency:
 * - LCP / FCP: latest `largest-contentful-paint` / the `first-contentful-paint`
 *   entry, ignored once the page was hidden before it (a background tab paints
 *   late for reasons the user never saw).
 * - CLS: largest session window (shifts < 1s apart, window ≤ 5s), shifts with
 *   recent input excluded.
 * - INP: ≈ p98 of per-interaction latency: the (n/50)-th longest of the 10
 *   longest interactions, n = `performance.interactionCount` or an estimate
 *   from the interaction id range. Bounded memory however long the page lives.
 * - TTFB: navigation `responseStart`.
 * Times are relative to `activationStart` (prerendered pages).
 *
 * Vitals are page-lifetime metrics: they are not reset by `session.clear()`.
 * The INP interaction is linked to the engine's causal trace when one matches
 * its input time, so "which click is my INP" leads to what it rendered.
 *
 * Everything is defensive and SSR-safe: without PerformanceObserver all
 * values stay null and nothing is installed.
 */

import type { InpAttribution, WebVitalName, WebVitalRating, WebVitals } from "../types/vitals.js";
import { findTraceByTriggerTime } from "../trace/traceContext.js";
import { describeTarget } from "./dom.js";
import { sanitizeUrl } from "./networkTracker.js";

/** Good (≤) / poor (>) thresholds, https://web.dev/articles/vitals. */
export const WEB_VITAL_THRESHOLDS: Readonly<Record<WebVitalName, { readonly good: number; readonly poor: number }>> = Object.freeze({
  lcp: Object.freeze({ good: 2500, poor: 4000 }),
  inp: Object.freeze({ good: 200, poor: 500 }),
  cls: Object.freeze({ good: 0.1, poor: 0.25 }),
  fcp: Object.freeze({ good: 1800, poor: 3000 }),
  ttfb: Object.freeze({ good: 800, poor: 1800 }),
});

/** Rating of one vital; null when there is no value. */
export function rateWebVital(name: WebVitalName, value: number | null | undefined): WebVitalRating | null {
  const t = WEB_VITAL_THRESHOLDS[name];
  if (!t || typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

export function emptyWebVitals(): WebVitals {
  return { lcp: null, lcpTarget: null, cls: null, inp: null, fcp: null, ttfb: null, interactions: 0, attribution: {} };
}

// ── pure bookkeeping (exported for tests) ───────────────────────────

export interface ClsState {
  /** Largest window so far. */
  max: number;
  cur: number;
  first: number;
  last: number;
  count: number;
  /** Increments when a shift opens a new session window. */
  windowId: number;
}

export function createClsState(): ClsState {
  return { max: 0, cur: 0, first: 0, last: 0, count: 0, windowId: 0 };
}

/**
 * Adds one shift (without recent input). Returns true when the current
 * window became (or grew as) the largest one.
 */
export function addLayoutShift(s: ClsState, startTime: number, value: number): boolean {
  if (!(value > 0) || !Number.isFinite(startTime)) return false;
  if (s.count > 0 && startTime - s.last < 1000 && startTime - s.first < 5000) {
    s.cur += value;
  } else {
    s.cur = value;
    s.first = startTime;
    s.windowId += 1;
  }
  s.last = startTime;
  s.count += 1;
  if (s.cur > s.max) {
    s.max = s.cur;
    return true;
  }
  return false;
}

const INP_KEEP = 10;
/** Chrome increments interactionId by 7 per interaction (web-vitals' interactionCount polyfill). */
const INTERACTION_ID_STEP = 7;

export interface InpCandidate extends InpAttribution {
  duration: number;
}

export interface InpState {
  /** Longest interactions, sorted by duration descending (≤ 10). */
  longest: InpCandidate[];
  minId: number;
  maxId: number;
}

export function createInpState(): InpState {
  return { longest: [], minId: Number.POSITIVE_INFINITY, maxId: 0 };
}

/** Records one Event Timing entry of an interaction. Returns true when the kept set changed. */
export function addInteraction(s: InpState, candidate: InpCandidate): boolean {
  const id = candidate.interactionId;
  if (!(id > 0) || !Number.isFinite(candidate.duration)) return false;
  if (id < s.minId) s.minId = id;
  if (id > s.maxId) s.maxId = id;
  const existing = s.longest.find((c) => c.interactionId === id);
  if (existing) {
    if (candidate.duration <= existing.duration) return false;
    Object.assign(existing, candidate);
  } else {
    const shortest = s.longest[s.longest.length - 1];
    if (s.longest.length >= INP_KEEP && shortest && candidate.duration <= shortest.duration) return false;
    s.longest.push({ ...candidate });
  }
  s.longest.sort((a, b) => b.duration - a.duration);
  if (s.longest.length > INP_KEEP) s.longest.length = INP_KEEP;
  return true;
}

export function estimateInteractionCount(s: InpState): number {
  if (s.maxId <= 0) return 0;
  return Math.round((s.maxId - s.minId) / INTERACTION_ID_STEP) + 1;
}

/** INP candidate for `interactionCount` interactions: one outlier ignored per 50. */
export function inpCandidate(s: InpState, interactionCount: number): InpCandidate | null {
  if (s.longest.length === 0) return null;
  const n = Math.max(interactionCount, s.longest.length);
  return s.longest[Math.min(s.longest.length - 1, Math.floor(n / 50))]!;
}

// ── tracker ──────────────────────────────────────────────────────────

export interface WebVitalsTracker {
  /** Current values (a fresh JSON-safe object). */
  read(): WebVitals;
  /** Increments whenever a value or its attribution changed. */
  revision(): number;
  /** Idempotent. Values read afterwards are the last measured ones. */
  stop(): void;
}

// Structural entry shapes (not all TS DOM libs ship them).
interface LcpEntryLike {
  startTime: number;
  element?: Element | null;
  url?: string;
}
interface LayoutShiftLike {
  startTime: number;
  value: number;
  hadRecentInput?: boolean;
  sources?: { node?: Node | null }[];
}
interface PaintLike {
  name: string;
  startTime: number;
}
interface NavigationLike {
  responseStart?: number;
  activationStart?: number;
}
interface EventEntryLike {
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
  interactionId?: number;
  target?: EventTarget | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function supportedTypes(): readonly string[] {
  try {
    if (typeof PerformanceObserver === "undefined") return [];
    const types = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] }).supportedEntryTypes;
    return Array.isArray(types) ? types : [];
  } catch {
    return [];
  }
}

function activationStart(): number {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as NavigationLike | undefined;
    return nav && typeof nav.activationStart === "number" && nav.activationStart > 0 ? nav.activationStart : 0;
  } catch {
    return 0;
  }
}

function browserInteractionCount(): number | undefined {
  try {
    const count = (performance as unknown as { interactionCount?: unknown }).interactionCount;
    return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : undefined;
  } catch {
    return undefined;
  }
}

function sourceTarget(sources: LayoutShiftLike["sources"]): string | undefined {
  if (!Array.isArray(sources)) return undefined;
  for (const source of sources) {
    if (source && source.node) {
      const target = describeTarget(source.node as EventTarget);
      if (target !== "unknown") return target;
    }
  }
  return undefined;
}

/**
 * Starts measuring. Never throws; without PerformanceObserver (Node, old
 * browsers) every value stays null.
 */
export function startWebVitalsTracking(): WebVitalsTracker {
  const vitals = emptyWebVitals();
  let rev = 0;
  const cleanups: Array<() => void> = [];
  const types = supportedTypes();
  const has = (type: string): boolean => types.includes(type);
  const cls = createClsState();
  const inp = createInpState();
  const changed = (): void => {
    rev += 1;
  };

  // First time the page was hidden: paints after it are not what the user saw.
  let firstHidden = Number.POSITIVE_INFINITY;
  try {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      if (document.visibilityState === "hidden") firstHidden = 0;
      const onVisibility = (event: Event): void => {
        if (document.visibilityState === "hidden" && firstHidden === Number.POSITIVE_INFINITY) {
          firstHidden = typeof event.timeStamp === "number" && event.timeStamp > 0 ? event.timeStamp : 0;
        }
      };
      document.addEventListener("visibilitychange", onVisibility, true);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility, true));
    }
  } catch {
    // ignore
  }

  const observe = (type: string, options: Record<string, unknown>, onEntry: (entry: unknown) => void): void => {
    if (!has(type)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        try {
          for (const entry of list.getEntries()) onEntry(entry);
        } catch {
          // never throw from an observer callback
        }
      });
      observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
      cleanups.push(() => {
        try {
          observer.disconnect();
        } catch {
          // ignore
        }
      });
    } catch {
      // unsupported option / type: that vital stays null
    }
  };

  if (has("layout-shift")) vitals.cls = 0;

  observe("largest-contentful-paint", {}, (raw) => {
    const e = raw as LcpEntryLike;
    if (!(e.startTime < firstHidden)) return;
    vitals.lcp = round2(Math.max(0, e.startTime - activationStart()));
    const target = describeTarget((e.element ?? null) as EventTarget | null);
    vitals.lcpTarget = target;
    vitals.attribution.lcp = { target, startTime: round2(e.startTime) };
    if (typeof e.url === "string" && e.url) vitals.attribution.lcp.url = sanitizeUrl(e.url);
    changed();
  });

  // Largest single shift of the current session window (its attribution once the window is the worst).
  let windowLargest: { windowId: number; attribution: NonNullable<WebVitals["attribution"]["cls"]> } | null = null;
  observe("layout-shift", {}, (raw) => {
    const e = raw as LayoutShiftLike;
    if (e.hadRecentInput || !(e.value > 0) || !Number.isFinite(e.startTime)) return;
    const grew = addLayoutShift(cls, e.startTime, e.value);
    if (!windowLargest || windowLargest.windowId !== cls.windowId || e.value > windowLargest.attribution.value) {
      const attribution: NonNullable<WebVitals["attribution"]["cls"]> = { startTime: round2(e.startTime), value: Math.round(e.value * 10000) / 10000 };
      const target = sourceTarget(e.sources);
      if (target !== undefined) attribution.target = target;
      windowLargest = { windowId: cls.windowId, attribution };
    }
    if (!grew) return;
    vitals.cls = Math.round(cls.max * 10000) / 10000;
    vitals.attribution.cls = { ...windowLargest.attribution };
    changed();
  });

  observe("paint", {}, (raw) => {
    const e = raw as PaintLike;
    if (e.name !== "first-contentful-paint" || !(e.startTime < firstHidden)) return;
    vitals.fcp = round2(Math.max(0, e.startTime - activationStart()));
    changed();
  });

  observe("navigation", {}, (raw) => {
    const e = raw as NavigationLike;
    if (typeof e.responseStart !== "number" || !(e.responseStart > 0)) return;
    vitals.ttfb = round2(Math.max(0, e.responseStart - activationStart()));
    changed();
  });

  observe("event", { durationThreshold: 16 }, (raw) => {
    const e = raw as EventEntryLike;
    const interactionId = e.interactionId ?? 0;
    if (!(interactionId > 0)) return;
    const processingStart = e.processingStart ?? e.startTime;
    const processingEnd = e.processingEnd ?? processingStart;
    const candidate: InpCandidate = {
      name: String(e.name),
      target: describeTarget(e.target ?? null),
      interactionId,
      startTime: round2(e.startTime),
      duration: e.duration,
      inputDelay: round2(Math.max(0, processingStart - e.startTime)),
      processingMs: round2(Math.max(0, processingEnd - processingStart)),
      presentationDelay: round2(Math.max(0, e.startTime + e.duration - processingEnd)),
    };
    const traceId = findTraceByTriggerTime(e.startTime, 50);
    if (traceId !== undefined) candidate.traceId = traceId;
    if (addInteraction(inp, candidate)) changed();
  });

  let stopped = false;
  return {
    read(): WebVitals {
      const count = browserInteractionCount() ?? estimateInteractionCount(inp);
      const pick = inpCandidate(inp, count);
      vitals.interactions = Math.max(count, inp.longest.length);
      vitals.inp = pick ? round2(pick.duration) : null;
      if (pick) {
        const { duration: _duration, ...attribution } = pick;
        vitals.attribution.inp = attribution;
      } else {
        delete vitals.attribution.inp;
      }
      return JSON.parse(JSON.stringify(vitals)) as WebVitals;
    },
    revision: () => rev,
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
