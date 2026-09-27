// Pure formatting helpers. No DOM access — safe to import from Node.

export const SEVERITIES = ["critical", "high", "medium", "low"];
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 4;
}

export function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Math.min/Math.max over an iterable that return `fallback` instead of ±Infinity when empty. */
export function safeMin(values, fallback = null) {
  let out = null;
  for (const v of values) if (isNum(v) && (out === null || v < out)) out = v;
  return out === null ? fallback : out;
}

export function safeMax(values, fallback = null) {
  let out = null;
  for (const v of values) if (isNum(v) && (out === null || v > out)) out = v;
  return out === null ? fallback : out;
}

export function percentile(values, p) {
  const sorted = values.filter(isNum).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = clamp(Math.ceil((p / 100) * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[idx];
}

export function formatMs(ms, { signed = false } = {}) {
  if (!isNum(ms)) return "—";
  const sign = signed && ms > 0 ? "+" : ms < 0 ? "−" : "";
  const abs = Math.abs(ms);
  let body;
  if (abs === 0) body = "0 ms";
  else if (abs < 1) body = `${abs.toFixed(2)} ms`;
  else if (abs < 10) body = `${abs.toFixed(1)} ms`;
  else if (abs < 1000) body = `${Math.round(abs)} ms`;
  else if (abs < 60000) body = `${(abs / 1000).toFixed(abs < 10000 ? 2 : 1)} s`;
  else {
    const m = Math.floor(abs / 60000);
    const s = Math.round((abs % 60000) / 1000);
    body = `${m}m ${String(s).padStart(2, "0")}s`;
  }
  return sign + body;
}

export function formatBytes(bytes) {
  if (!isNum(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPct(value, digits = 0) {
  if (!isNum(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatCount(n) {
  if (!isNum(n)) return "—";
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function formatValue(value, unit) {
  if (typeof value === "string") return value;
  if (!isNum(value)) return "—";
  if (unit === "ms") return formatMs(value);
  if (unit === "%") return formatPct(value, value < 10 ? 1 : 0);
  if (unit === "count") return formatCount(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

const ISSUE_TITLES = {
  "interaction-induced-render-burst": "Render burst after interaction",
  "keystroke-render-loop": "Keystroke render loop",
  "interaction-render-latency": "Slow render after interaction",
  "network-blocking-render": "Network blocking render",
  "state-thrashing": "State thrashing",
  "wasted-render": "Wasted renders",
  "slow-interaction": "Slow interaction",
  "long-task": "Long main-thread task",
  "slow-component": "Slow component",
  "budget-exceeded": "Budget exceeded",
};

export function humanizeIssueType(type) {
  if (typeof type !== "string" || type === "") return "Unknown issue";
  if (ISSUE_TITLES[type]) return ISSUE_TITLES[type];
  const words = type.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function humanizeCategory(category) {
  const map = { rendering: "Rendering", network: "Network", "main-thread": "Main thread", interaction: "Interaction", budget: "Budget" };
  return map[category] || (typeof category === "string" ? category : "Other");
}

export function capitalize(text) {
  return typeof text === "string" && text ? text[0].toUpperCase() + text.slice(1) : "";
}

/** "3s ago", "2m ago" from a millisecond age. */
export function formatAgo(ageMs) {
  if (!isNum(ageMs)) return "—";
  if (ageMs < 1500) return "just now";
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Wall-clock HH:MM:SS.mmm for a page-relative timestamp. */
export function formatWallTime(timeOrigin, timestamp) {
  if (!isNum(timeOrigin) || !isNum(timestamp)) return "—";
  return formatClock(timeOrigin + timestamp, true);
}

export function formatClock(epochMs, withMs = false) {
  if (!isNum(epochMs)) return "—";
  const d = new Date(epochMs);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}

/** Short display form of an id; the engine's type prefix ("session-", "trace-") carries no information. */
export function shortId(id, len = 8) {
  if (typeof id !== "string") return "—";
  const bare = id.replace(/^(session|trace)-/, "");
  return bare.length > len ? bare.slice(0, len) : bare;
}

export function shortUrl(url, max = 80) {
  if (typeof url !== "string") return "";
  let out = url;
  try {
    const u = new URL(url);
    out = u.host + u.pathname + u.search;
  } catch {
    /* already path-like */
  }
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** "Nice" axis ticks (1/2/5 × 10^n steps) covering [min, max]. */
export function niceTicks(min, max, targetCount = 6) {
  if (!isNum(min) || !isNum(max) || max <= min) return { step: 1, ticks: [] };
  const raw = (max - min) / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks = [];
  const first = Math.ceil(min / step) * step;
  for (let t = first; t <= max + step * 1e-9 && ticks.length < 200; t += step) ticks.push(t);
  return { step, ticks };
}

export function statusClass(status) {
  if (!isNum(status) || status === 0) return "error";
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (status >= 300) return "redirect";
  return "ok";
}

export function gradeLabel(grade) {
  if (grade === "good") return "Good";
  if (grade === "needs-improvement") return "Needs improvement";
  if (grade === "poor") return "Poor";
  return "—";
}

export function gradeFromScore(score) {
  if (!isNum(score)) return null;
  return score >= 90 ? "good" : score >= 50 ? "needs-improvement" : "poor";
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
