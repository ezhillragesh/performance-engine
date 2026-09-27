// Web Vitals thresholds + rating (docs/PROTOCOL.md v2.1). Pure — safe to import from Node.
import { formatMs, isNum } from "./format.js";

export const VITALS = [
  { key: "lcp", label: "LCP", name: "Largest Contentful Paint", good: 2500, poor: 4000, unit: "ms" },
  { key: "inp", label: "INP", name: "Interaction to Next Paint", good: 200, poor: 500, unit: "ms" },
  { key: "cls", label: "CLS", name: "Cumulative Layout Shift", good: 0.1, poor: 0.25, unit: "" },
  { key: "fcp", label: "FCP", name: "First Contentful Paint", good: 1800, poor: 3000, unit: "ms" },
  { key: "ttfb", label: "TTFB", name: "Time to First Byte", good: 800, poor: 1800, unit: "ms" },
];

/** "good" | "needs-improvement" | "poor" | null (no value). Good is inclusive (≤). */
export function rateVital(meta, value) {
  if (!isNum(value)) return null;
  if (value <= meta.good) return "good";
  if (value <= meta.poor) return "needs-improvement";
  return "poor";
}

export function formatVital(meta, value) {
  if (!isNum(value)) return "—";
  if (meta.unit === "ms") return formatMs(value);
  return value < 0.001 && value > 0 ? "< 0.001" : value.toFixed(value >= 1 ? 2 : 3).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

/** Threshold caption, e.g. "≤ 2.50 s good · > 4.00 s poor". */
export function vitalThresholds(meta) {
  const f = (v) => (meta.unit === "ms" ? formatMs(v) : String(v));
  return `≤ ${f(meta.good)} good · > ${f(meta.poor)} poor`;
}
