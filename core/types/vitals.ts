/**
 * Core Web Vitals as measured in the page (see `core/tracker/webVitals.ts`).
 *
 * The flat fields (`lcp`, `lcpTarget`, `cls`, `inp`, `fcp`, `ttfb`,
 * `interactions`) have the same shape as the DevTools panel's own collector
 * (docs/PROTOCOL.md, "DevTools-only layer"), so a snapshot's `vitals` can be
 * shown by the same code. All times are ms relative to navigation start
 * (minus `activationStart` for prerendered pages); `cls` is unitless.
 */

export type WebVitalName = "lcp" | "inp" | "cls" | "fcp" | "ttfb";
export type WebVitalRating = "good" | "needs-improvement" | "poor";

export interface LcpAttribution {
  /** Short CSS-like descriptor of the LCP element, e.g. `img#hero.banner`. */
  target: string;
  /** Sanitised resource URL for image / video LCP (query values stripped). */
  url?: string;
  /** performance.now() of the LCP entry. */
  startTime: number;
}

export interface ClsAttribution {
  /** Element that moved the most in the largest shift of the worst session window. */
  target?: string;
  /** performance.now() of that largest shift. */
  startTime: number;
  /** Score of that single shift. */
  value: number;
}

export interface InpAttribution {
  /** DOM event name of the slowest entry of the interaction, e.g. `click`. */
  name: string;
  target: string;
  interactionId: number;
  /** performance.now() when the input was received. */
  startTime: number;
  inputDelay: number;
  processingMs: number;
  presentationDelay: number;
  /**
   * Causal trace of that interaction when the engine recorded it: the
   * renders, requests and long tasks it caused are in the trace with this id.
   */
  traceId?: string;
}

export interface WebVitalsAttribution {
  lcp?: LcpAttribution;
  cls?: ClsAttribution;
  inp?: InpAttribution;
}

export interface WebVitals {
  /** Largest Contentful Paint, ms. Null until measured or when unsupported. */
  lcp: number | null;
  /** Descriptor of the LCP element (same as `attribution.lcp.target`). */
  lcpTarget: string | null;
  /** Cumulative Layout Shift (largest session window). 0 when supported but nothing shifted. */
  cls: number | null;
  /** Interaction to Next Paint (≈ p98 of interaction latency), ms. Null until an interaction is measured. */
  inp: number | null;
  /** First Contentful Paint, ms. */
  fcp: number | null;
  /** Time to First Byte, ms. */
  ttfb: number | null;
  /** Interactions on the page so far (browser count, or an estimate from interaction ids). */
  interactions: number;
  attribution: WebVitalsAttribution;
}
