// Browser entry for extension/vendor/a11y-audit.js (built by core/scripts/build-a11y.mjs).
// Installs window.__PERF_INTEL_A11Y__ = { version, run, highlight, clearHighlight, watch, unwatch,
// dirty, consumeDirty, state, engines, runIbm, runAxe, start, poll, cancel, merge }.
// The additional rule engines are NOT part of this bundle: the panel injects the vendored
// ibm-ace.js / axe.min.js (wrapped by loaders.ts into private globals) on demand. start()/poll()
// exist because inspectedWindow.eval cannot await a promise. The DevTools panel injects the file via
// chrome.devtools.inspectedWindow.eval(source), so it must: need no engine and no page code, be
// idempotent (re-injection keeps the live instance unless the version changed), and never throw.
import { runAxeAudit, type AxeLike } from "./axe.js";
import { A11Y_ENGINE_VERSION, A11Y_IGNORE_ATTR, runA11yAudit } from "./engine.js";
import { runIbmAudit, type AceLike } from "./ibm.js";
import { ACE_GLOBAL_KEY, AXE_GLOBAL_KEY } from "./loaders.js";
import { elementForNodeKey, resolveXPath } from "./sourceUtil.js";
import type { A11yAuditOptions, A11yReport, ListenerLookup } from "./types.js";
import { mergeA11yReports } from "./unify.js";
import { normalizeStandard, type A11yStandard } from "./wcag.js";

const GLOBAL_KEY = "__PERF_INTEL_A11Y__";
const HIGHLIGHT_MS = 2000;
const WATCH_DEBOUNCE_MS = 1000;
const WATCH_MAX_WAIT_MS = 5000;

export interface A11yWatchState {
  version: string;
  watching: boolean;
  dirty: boolean;
  mutations: number;
  lastRunAt: number | null;
}

export interface A11yGlobalApi {
  readonly version: string;
  run(options?: unknown): A11yReport;
  /** Highlights a finding's element (see find()). */
  highlight(selector: string, node?: string): boolean;
  /**
   * Resolves a finding's element: its node key (the exact element the engines reported, while it is
   * still connected), else its selector (CSS, or an XPath for shadow DOM / frame findings).
   */
  find(selector: string, node?: string): Element | null;
  clearHighlight(): void;
  watch(cb?: () => void): boolean;
  unwatch(): void;
  readonly dirty: boolean;
  /** Returns the dirty flag and resets it (the panel polls this in Live mode). */
  consumeDirty(): boolean;
  state(): A11yWatchState;
  /** Versions of the additional engines available in this page (null when not loaded). */
  engines(): { ibm: string | null; axe: string | null };
  runIbm(options?: unknown): Promise<A11yReport>;
  runAxe(options?: unknown): Promise<A11yReport>;
  /** Starts an asynchronous engine run; returns a token for poll() (or "" when the engine is missing). */
  start(engine: string, options?: unknown): string;
  poll(token: string): EnginePoll;
  /** The run cannot be interrupted (the IBM engine is synchronous); its result is discarded. */
  cancel(token: string): boolean;
  /** Merges engine reports into the unified report (see unify.ts). */
  merge(reports: unknown, options?: unknown): A11yReport;
}

export type EnginePoll =
  | { state: "running"; elapsedMs: number }
  | { state: "done"; elapsedMs: number; report: A11yReport }
  | { state: "error"; elapsedMs: number; error: string }
  | { state: "unknown" };

interface EngineOptions {
  standard: A11yStandard;
  maxFindings?: number;
}

function sanitizeEngineOptions(raw: unknown): EngineOptions {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: EngineOptions = { standard: normalizeStandard(o.standard) };
  if (typeof o.maxFindings === "number" && Number.isFinite(o.maxFindings)) out.maxFindings = Math.max(1, Math.min(5000, o.maxFindings));
  return out;
}

function aceObject(): { ace: AceLike; version: string } | null {
  const g = window as unknown as Record<string, unknown>;
  const own = g[ACE_GLOBAL_KEY] as { ace?: AceLike; version?: string } | undefined;
  if (own?.ace && typeof own.ace.Checker === "function") return { ace: own.ace, version: String(own.version || "") };
  // A page (or another tool) may have loaded ace.js itself: use it, never replace it.
  const pageAce = g.ace as AceLike | undefined;
  if (pageAce && typeof pageAce.Checker === "function") return { ace: pageAce, version: "page" };
  return null;
}

function axeObject(): { axe: AxeLike; version: string } | null {
  const g = window as unknown as Record<string, unknown>;
  const own = g[AXE_GLOBAL_KEY] as { axe?: AxeLike; version?: string } | undefined;
  if (own?.axe && typeof own.axe.run === "function") return { axe: own.axe, version: String(own.version || "") };
  const pageAxe = g.axe as AxeLike | undefined;
  if (pageAxe && typeof pageAxe.run === "function" && typeof pageAxe.getRules === "function") return { axe: pageAxe, version: String(pageAxe.version || "page") };
  return null;
}

function jsonSafe<T>(v: T): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    return v;
  }
}

function sanitizeOptions(raw: unknown): A11yAuditOptions {
  const out: A11yAuditOptions = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.rules)) out.rules = o.rules.filter((r): r is string => typeof r === "string").slice(0, 200);
  if (o.include === "errors" || o.include === "all") out.include = o.include;
  if (typeof o.maxFindings === "number" && Number.isFinite(o.maxFindings)) out.maxFindings = Math.max(1, Math.min(5000, o.maxFindings));
  if (typeof o.timeBudgetMs === "number" && Number.isFinite(o.timeBudgetMs)) out.timeBudgetMs = Math.max(10, Math.min(10_000, o.timeBudgetMs));
  if (typeof o.listeners === "function") out.listeners = o.listeners as ListenerLookup;
  return out;
}

function createApi(): A11yGlobalApi {
  let box: HTMLElement | null = null;
  let boxTimer: ReturnType<typeof setTimeout> | undefined;
  let boxFrame = 0;
  let observer: MutationObserver | null = null;
  let callback: (() => void) | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let firstPending = 0;
  let dirty = false;
  let mutations = 0;
  let lastRunAt: number | null = null;

  const isOurs = (n: Node | null): boolean => {
    for (let p: Node | null = n; p; p = p.parentNode) {
      if (p.nodeType === 1 && (p as Element).hasAttribute(A11Y_IGNORE_ATTR)) return true;
    }
    return false;
  };

  function clearHighlight(): void {
    try {
      if (boxTimer !== undefined) clearTimeout(boxTimer);
      boxTimer = undefined;
      if (boxFrame) cancelAnimationFrame(boxFrame);
      boxFrame = 0;
      box?.remove();
    } catch {
      /* never throw */
    }
    box = null;
  }

  function find(selector: string, node?: string): Element | null {
    try {
      const byKey = typeof node === "string" && node ? elementForNodeKey(node) : null;
      if (byKey) return byKey;
      if (typeof selector !== "string" || !selector) return null;
      return selector.startsWith("/") ? resolveXPath(document, selector) : document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function highlight(selector: string, node?: string): boolean {
    clearHighlight();
    try {
      const el = find(selector, node);
      if (!el) return false;
      try {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
      } catch {
        el.scrollIntoView();
      }
      const b = document.createElement("div");
      b.setAttribute(A11Y_IGNORE_ATTR, "highlight");
      b.setAttribute("aria-hidden", "true");
      const base =
        "all:initial!important;position:fixed!important;pointer-events:none!important;z-index:2147483647!important;" +
        "box-sizing:border-box!important;border:2px solid #ff3b30!important;border-radius:3px!important;" +
        "background:rgba(255,59,48,.14)!important;box-shadow:0 0 0 1px rgba(255,255,255,.9),0 0 0 4px rgba(255,59,48,.35)!important;display:block!important;";
      const place = () => {
        if (!box) return;
        const r = el.getBoundingClientRect();
        const w = Math.max(4, r.width);
        const h = Math.max(4, r.height);
        box.style.cssText = `${base}left:${r.left - (w - r.width) / 2}px!important;top:${r.top - (h - r.height) / 2}px!important;width:${w}px!important;height:${h}px!important;`;
        boxFrame = requestAnimationFrame(place); // follow scroll/layout until removed
      };
      box = b;
      (document.documentElement || document.body).appendChild(b);
      place();
      boxTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
      return true;
    } catch {
      clearHighlight();
      return false;
    }
  }

  function fire(): void {
    debounce = undefined;
    firstPending = 0;
    dirty = true;
    try {
      callback?.();
    } catch {
      /* page callbacks must not break the watcher */
    }
  }

  function onMutations(records: MutationRecord[]): void {
    try {
      let relevant = false;
      for (const r of records) {
        if (isOurs(r.target)) continue;
        if (r.type === "childList") {
          const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
          if (nodes.length && nodes.every((n) => n.nodeType === 1 && (n as Element).hasAttribute(A11Y_IGNORE_ATTR))) continue;
        }
        relevant = true;
        break;
      }
      if (!relevant) return;
      mutations++;
      const now = Date.now();
      if (!firstPending) firstPending = now;
      if (debounce !== undefined) clearTimeout(debounce);
      // Debounced 1 s; a continuously mutating page still gets flagged every 5 s at most.
      debounce = setTimeout(fire, now - firstPending >= WATCH_MAX_WAIT_MS ? 0 : WATCH_DEBOUNCE_MS);
    } catch {
      /* never throw */
    }
  }

  function watch(cb?: () => void): boolean {
    try {
      if (typeof cb === "function") callback = cb;
      if (observer) return true;
      if (typeof MutationObserver !== "function" || !document.documentElement) return false;
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      return true;
    } catch {
      observer = null;
      return false;
    }
  }

  function unwatch(): void {
    try {
      observer?.disconnect();
      if (debounce !== undefined) clearTimeout(debounce);
    } catch {
      /* ignore */
    }
    observer = null;
    callback = null;
    debounce = undefined;
    firstPending = 0;
  }

  interface Job {
    started: number;
    done: boolean;
    report?: A11yReport;
    error?: string;
    cancelled: boolean;
  }
  const jobs = new Map<string, Job>();
  let jobSeq = 0;

  function missing(engine: "ibm" | "axe"): A11yReport {
    return { ...runA11yAudit(null, {}), engine, error: "Rule engine not loaded" };
  }

  async function runIbm(options?: unknown): Promise<A11yReport> {
    const o = sanitizeEngineOptions(options);
    const e = aceObject();
    if (!e) return missing("ibm");
    return jsonSafe(await runIbmAudit(e.ace, document, { standard: o.standard, maxFindings: o.maxFindings, version: e.version !== "page" ? e.version : undefined }));
  }

  async function runAxe(options?: unknown): Promise<A11yReport> {
    const o = sanitizeEngineOptions(options);
    const e = axeObject();
    if (!e) return missing("axe");
    return jsonSafe(await runAxeAudit(e.axe, document, { standard: o.standard, maxFindings: o.maxFindings }));
  }

  function start(engine: string, options?: unknown): string {
    try {
      const fn = engine === "ibm" ? (aceObject() ? runIbm : null) : engine === "axe" ? (axeObject() ? runAxe : null) : null;
      if (!fn) return "";
      // Drop stale jobs (a panel that went away never polls again).
      for (const [k, j] of jobs) if (Date.now() - j.started > 300_000) jobs.delete(k);
      const token = engine + "-" + ++jobSeq + "-" + Date.now().toString(36);
      const job: Job = { started: Date.now(), done: false, cancelled: false };
      jobs.set(token, job);
      // Yield first so the eval that started the job returns before the (possibly long) scan.
      setTimeout(() => {
        fn(options)
          .then((report) => {
            job.report = report;
          })
          .catch((err: unknown) => {
            job.error = err instanceof Error ? err.message.slice(0, 300) : "Audit failed";
          })
          .finally(() => {
            job.done = true;
            if (job.cancelled) jobs.delete(token);
          });
      }, 0);
      return token;
    } catch {
      return "";
    }
  }

  function poll(token: string): EnginePoll {
    const job = typeof token === "string" ? jobs.get(token) : undefined;
    if (!job) return { state: "unknown" };
    const elapsedMs = Date.now() - job.started;
    if (!job.done) return { state: "running", elapsedMs };
    jobs.delete(token);
    if (job.report) return { state: "done", elapsedMs, report: job.report };
    return { state: "error", elapsedMs, error: job.error || "Audit failed" };
  }

  function cancel(token: string): boolean {
    const job = jobs.get(token);
    if (!job) return false;
    job.cancelled = true;
    if (job.done) jobs.delete(token);
    return true;
  }

  function merge(reports: unknown, options?: unknown): A11yReport {
    const list = Array.isArray(reports) ? (reports as A11yReport[]) : [];
    const o = options && typeof options === "object" ? (options as Record<string, unknown>) : {};
    return jsonSafe(mergeA11yReports(list, { standard: normalizeStandard(o.standard) }));
  }

  function run(options?: unknown): A11yReport {
    let report: A11yReport;
    try {
      report = runA11yAudit(document, sanitizeOptions(options));
    } catch (err) {
      report = runA11yAudit(null, {});
      report.error = err instanceof Error ? err.message : "Audit failed";
    }
    dirty = false;
    lastRunAt = Date.now();
    try {
      return JSON.parse(JSON.stringify(report)) as A11yReport; // guarantee a JSON-safe value for eval()
    } catch {
      return report;
    }
  }

  return {
    version: A11Y_ENGINE_VERSION,
    run,
    highlight,
    find,
    clearHighlight,
    watch,
    unwatch,
    get dirty() {
      return dirty;
    },
    consumeDirty() {
      const d = dirty;
      dirty = false;
      return d;
    },
    state() {
      return { version: A11Y_ENGINE_VERSION, watching: !!observer, dirty, mutations, lastRunAt };
    },
    engines() {
      const i = aceObject();
      const x = axeObject();
      return { ibm: i ? i.version : null, axe: x ? x.version : null };
    },
    runIbm,
    runAxe,
    start,
    poll,
    cancel,
    merge,
  };
}

/** Idempotent install; replaces an older version (stopping its watcher/overlay). */
export function installA11yGlobal(): void {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const g = window as unknown as Record<string, unknown>;
    const existing = g[GLOBAL_KEY] as Partial<A11yGlobalApi> | undefined;
    if (existing && existing.version === A11Y_ENGINE_VERSION) return;
    try {
      existing?.unwatch?.();
      existing?.clearHighlight?.();
    } catch {
      /* stale instance */
    }
    Object.defineProperty(g, GLOBAL_KEY, { value: createApi(), configurable: true, writable: true, enumerable: false });
  } catch {
    /* never throw into the page */
  }
}

installA11yGlobal();
