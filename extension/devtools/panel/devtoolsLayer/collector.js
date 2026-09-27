// Passive page collector for DevTools-only mode (docs/PROTOCOL.md "DevTools-only layer").
//
// The collector is installed into the inspected page with chrome.devtools.inspectedWindow.eval
// (not subject to page CSP) and polled with a cursor. The page-side functions below are
// serialised with Function.prototype.toString, so they must stay self-contained: no imports,
// no closures over module scope, ES2017 syntax only. The same functions are exported so the
// vitals math can be unit-tested in Node.
//
// Everything read back from the page is untrusted: the panel validates it (validate.js) before use.

export const COLLECTOR_VERSION = 1;
export const COLLECTOR_CAP = 1500;
export const POLL_INTERVAL_MS = 1500;
const GLOBAL = "__PERF_INTEL_COLLECTOR__";

// ── Page-side pure helpers (serialised into the page) ────────────────

/**
 * CLS session windows (web-vitals definition): shifts less than 1s apart and within 5s of the
 * window's first shift add up; CLS is the largest window. Shifts with recent input are ignored
 * by the caller. Mutates and returns `s`.
 */
export function clsAdd(s, startTime, value) {
  if (s.count > 0 && startTime - s.last < 1000 && startTime - s.first < 5000) {
    s.cur += value;
  } else {
    s.cur = value;
    s.first = startTime;
  }
  s.last = startTime;
  s.count += 1;
  if (s.cur > s.max) s.max = s.cur;
  return s;
}

/**
 * INP bookkeeping (web-vitals approach): keep the 10 longest interactions (max entry duration per
 * interactionId) plus a count of distinct interactions. Mutates and returns `s`.
 */
export function inpAdd(s, interactionId, duration) {
  if (!(interactionId > 0)) return s;
  if (!s.seen[interactionId]) {
    s.seen[interactionId] = 1;
    s.count += 1;
  }
  let found = null;
  for (let i = 0; i < s.longest.length; i++) {
    if (s.longest[i].id === interactionId) {
      found = s.longest[i];
      break;
    }
  }
  if (found) {
    if (duration > found.d) found.d = duration;
  } else if (s.longest.length < 10 || duration > s.longest[s.longest.length - 1].d) {
    s.longest.push({ id: interactionId, d: duration });
  }
  s.longest.sort(function (a, b) {
    return b.d - a.d;
  });
  if (s.longest.length > 10) s.longest.length = 10;
  return s;
}

/** INP ≈ p98 of per-interaction latency: the (n/50)-th longest interaction. */
export function inpValue(s, interactionCount) {
  if (!s.longest.length) return null;
  const n = typeof interactionCount === "number" && interactionCount >= s.count ? interactionCount : s.count;
  const idx = Math.min(s.longest.length - 1, Math.floor(n / 50));
  return s.longest[idx].d;
}

/** Short CSS-like descriptor, e.g. `button#save.primary` (same shape as core describeTarget). */
export function describeNode(node) {
  try {
    if (!node || node.nodeType !== 1) return node && node.nodeType === 9 ? "document" : "unknown";
    const tag = String(node.tagName || "").toLowerCase() || "unknown";
    const id = node.id ? "#" + String(node.id).slice(0, 60) : "";
    const raw = (node.getAttribute && node.getAttribute("class")) || "";
    const cls = raw.trim() ? "." + raw.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return (tag + id + cls).slice(0, 200);
  } catch (e) {
    return "unknown";
  }
}

/**
 * Installs the collector on `window[GLOBAL]`. Idempotent: a collector of the same version is left
 * alone; an older version is stopped and replaced. Returns plain JSON.
 */
export function installCollector(VERSION, CAP, NAME, H) {
  const w = window;
  const existing = w[NAME];
  if (existing && existing.v === VERSION && typeof existing.read === "function") {
    return { installed: true, fresh: false, v: VERSION, timeOrigin: performance.timeOrigin };
  }
  if (existing && typeof existing.stop === "function") {
    try {
      existing.stop();
    } catch (e) {
      /* ignore */
    }
  }
  const PO = typeof PerformanceObserver === "function" ? PerformanceObserver : null;
  const types = PO && Array.isArray(PO.supportedEntryTypes) ? PO.supportedEntryTypes : [];
  const has = function (t) {
    return types.indexOf(t) >= 0;
  };
  // Entries without an interactionId are kept only for these names. mouse*/touch* are left out:
  // they are companions of a pointer interaction that already carries the id (INP ignores them too).
  const NAMES = { click: 1, dblclick: 1, keydown: 1, keyup: 1, keypress: 1, input: 1, change: 1, submit: 1 };
  const r2 = function (n) {
    return Math.round(n * 100) / 100;
  };
  const activation = function () {
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      return nav && nav.activationStart > 0 ? nav.activationStart : 0;
    } catch (e) {
      return 0;
    }
  };
  const stripQuery = function (u) {
    return typeof u === "string" && u ? u.split(/[?#]/)[0].slice(0, 300) : undefined;
  };

  const c = {
    v: VERSION,
    cursor: 0,
    entries: [],
    dropped: 0,
    vitals: { lcp: null, lcpTarget: null, cls: has("layout-shift") ? 0 : null, inp: null, fcp: null, ttfb: null, interactions: 0 },
    supported: {
      loaf: has("long-animation-frame"),
      longtask: has("longtask"),
      event: has("event"),
      lcp: has("largest-contentful-paint"),
      cls: has("layout-shift"),
      paint: has("paint"),
      navigation: has("navigation"),
    },
    observers: [],
  };
  const cls = { count: 0, cur: 0, max: 0, first: 0, last: 0 };
  const inp = { count: 0, seen: {}, longest: [] };
  const perInteraction = {};

  function push(item) {
    c.cursor += 1;
    item.seq = c.cursor;
    c.entries.push(item);
    if (c.entries.length > CAP + 100) {
      const extra = c.entries.length - CAP;
      c.entries.splice(0, extra);
      c.dropped += extra;
    }
  }

  function observe(type, opts, fn) {
    if (!PO || !has(type)) return;
    try {
      const o = new PO(function (list) {
        try {
          const es = list.getEntries();
          for (let i = 0; i < es.length; i++) fn(es[i]);
        } catch (e) {
          /* never throw into the page */
        }
      });
      const init = { type: type, buffered: true };
      for (const k in opts) init[k] = opts[k];
      o.observe(init);
      c.observers.push(o);
    } catch (e) {
      /* unsupported option */
    }
  }

  if (has("long-animation-frame")) {
    observe("long-animation-frame", {}, function (e) {
      const scripts = [];
      const list = e.scripts || [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        scripts.push({
          invoker: String(s.invoker || s.invokerType || "unknown").slice(0, 200),
          sourceURL: stripQuery(s.sourceURL),
          sourceFunctionName: s.sourceFunctionName ? String(s.sourceFunctionName).slice(0, 200) : undefined,
          duration: r2(s.duration || 0),
        });
      }
      scripts.sort(function (a, b) {
        return b.duration - a.duration;
      });
      push({ kind: "loaf", startTime: e.startTime, duration: r2(e.duration), blockingDuration: r2(e.blockingDuration || 0), scripts: scripts.slice(0, 5) });
    });
  } else {
    observe("longtask", {}, function (e) {
      push({ kind: "longtask", startTime: e.startTime, duration: r2(e.duration) });
    });
  }

  observe("event", { durationThreshold: 16 }, function (e) {
    const id = e.interactionId || 0;
    if (id > 0) H.inpAdd(inp, id, e.duration);
    if (id <= 0 && !NAMES[e.name]) return;
    const ps = typeof e.processingStart === "number" ? e.processingStart : e.startTime;
    const pe = typeof e.processingEnd === "number" ? e.processingEnd : ps;
    if (id > 0) {
      // pointerdown/pointerup/click of one gesture share an id: keep only better entries. Durations
      // are rounded to 8ms, so ties are common; then the entry that ran the handler (most
      // processing time) wins over e.g. a pointerdown without listeners.
      const prev = perInteraction[id];
      const proc = pe - ps;
      if (prev && (e.duration < prev.d || (e.duration === prev.d && proc <= prev.p))) return;
      perInteraction[id] = { d: e.duration, p: proc };
    }
    push({
      kind: "event",
      name: String(e.name).slice(0, 40),
      interactionId: id,
      startTime: e.startTime,
      duration: r2(e.duration),
      inputDelay: r2(Math.max(0, ps - e.startTime)),
      processingMs: r2(Math.max(0, pe - ps)),
      presentationDelay: r2(Math.max(0, e.startTime + e.duration - pe)),
      target: H.describeNode(e.target),
    });
  });

  observe("largest-contentful-paint", {}, function (e) {
    c.vitals.lcp = r2(Math.max(0, e.startTime - activation()));
    c.vitals.lcpTarget = H.describeNode(e.element);
  });
  observe("layout-shift", {}, function (e) {
    if (e.hadRecentInput) return;
    H.clsAdd(cls, e.startTime, e.value);
    c.vitals.cls = Math.round(cls.max * 10000) / 10000;
  });
  observe("paint", {}, function (e) {
    if (e.name === "first-contentful-paint") c.vitals.fcp = r2(Math.max(0, e.startTime - activation()));
  });
  observe("navigation", {}, function (e) {
    if (e.responseStart > 0) c.vitals.ttfb = r2(Math.max(0, e.responseStart - activation()));
  });

  c.read = function (since) {
    const from = typeof since === "number" && since >= 0 ? since : 0;
    const out = [];
    for (let i = 0; i < c.entries.length; i++) if (c.entries[i].seq > from) out.push(c.entries[i]);
    const count = typeof performance.interactionCount === "number" ? performance.interactionCount : inp.count;
    c.vitals.inp = H.inpValue(inp, count);
    c.vitals.interactions = Math.max(count, inp.count);
    return JSON.parse(
      JSON.stringify({
        v: c.v,
        cursor: c.cursor,
        entries: out,
        dropped: c.dropped,
        vitals: c.vitals,
        supported: c.supported,
        timeOrigin: performance.timeOrigin,
        now: performance.now(),
        href: String(location.href),
        origin: String(location.origin),
        title: String(document.title || ""),
      }),
    );
  };
  c.stop = function () {
    for (let i = 0; i < c.observers.length; i++) {
      try {
        c.observers[i].disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    c.observers = [];
  };
  try {
    Object.defineProperty(w, NAME, { value: c, configurable: true, writable: true, enumerable: false });
  } catch (e) {
    w[NAME] = c;
  }
  return { installed: true, fresh: true, v: VERSION, timeOrigin: performance.timeOrigin, supported: c.supported };
}

// ── Expressions sent through inspectedWindow.eval ────────────────────

/** Source that installs the collector; evaluates to a plain status object. */
export const COLLECTOR_SOURCE =
  "/*perf-intel:install*/(function(){" +
  `var H={clsAdd:${clsAdd.toString()},inpAdd:${inpAdd.toString()},inpValue:${inpValue.toString()},describeNode:${describeNode.toString()}};` +
  `try{return (${installCollector.toString()})(${COLLECTOR_VERSION},${COLLECTOR_CAP},${JSON.stringify(GLOBAL)},H);}` +
  "catch(e){return {installed:false,error:String(e&&e.message||e)};}})()";

/** Poll expression: entries after `cursor`, or `{ missing: true }` when the collector is gone. */
export function pollExpression(cursor) {
  const c = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0;
  return (
    `/*perf-intel:poll*/(function(){var c=window[${JSON.stringify(GLOBAL)}];` +
    `if(!c||c.v!==${COLLECTOR_VERSION}||typeof c.read!=="function")return {missing:true};` +
    `return c.read(${c});})()`
  );
}

// ── Panel-side mapping (pure) ────────────────────────────────────────

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nonNeg = (v) => (isNum(v) && v > 0 ? v : 0);
const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Maps one collector entry to a LongTaskEvent / InteractionEvent (core/types/events.ts), or null. */
export function mapCollectorEntry(e, sessionId = "devtools") {
  if (!e || typeof e !== "object" || !isNum(e.startTime) || !isNum(e.seq)) return null;
  const base = { timestamp: e.startTime, eventId: `col-${e.seq}`, sessionId };
  if (e.kind === "loaf" || e.kind === "longtask") {
    const duration = nonNeg(e.duration);
    const loaf = e.kind === "loaf";
    const ev = {
      ...base,
      type: "longtask",
      duration,
      blockingDuration: loaf ? nonNeg(e.blockingDuration) : Math.max(0, duration - 50),
      api: loaf ? "long-animation-frame" : "longtask",
    };
    if (loaf && Array.isArray(e.scripts) && e.scripts.length) {
      ev.scripts = e.scripts
        .filter((s) => s && typeof s === "object")
        .slice(0, 5)
        .map((s) => {
          const out = { invoker: str(s.invoker) || "unknown", duration: nonNeg(s.duration) };
          const url = str(s.sourceURL, 300);
          if (url) out.sourceURL = url;
          const fn = str(s.sourceFunctionName);
          if (fn) out.sourceFunctionName = fn;
          return out;
        });
    }
    return ev;
  }
  if (e.kind === "event") {
    return {
      ...base,
      type: "interaction",
      name: str(e.name, 40) || "interaction",
      interactionId: isNum(e.interactionId) && e.interactionId > 0 ? e.interactionId : 0,
      duration: nonNeg(e.duration),
      inputDelay: nonNeg(e.inputDelay),
      processingMs: nonNeg(e.processingMs),
      presentationDelay: nonNeg(e.presentationDelay),
      target: str(e.target) || "unknown",
    };
  }
  return null;
}

const VITAL_KEYS = ["lcp", "inp", "cls", "fcp", "ttfb"];

/** Sanitises the collector's vitals object: numbers or null only. */
export function validateVitals(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const k of VITAL_KEYS) out[k] = isNum(raw[k]) && raw[k] >= 0 ? raw[k] : null;
  out.interactions = isNum(raw.interactions) && raw.interactions >= 0 ? Math.round(raw.interactions) : 0;
  out.lcpTarget = str(raw.lcpTarget);
  return out;
}

// ── Poller ───────────────────────────────────────────────────────────

/**
 * Promise wrapper for chrome.devtools.inspectedWindow.eval. Resolves `{ value }` or
 * `{ error, isException }`; never rejects.
 */
export function evalInPage(inspectedWindow, expression) {
  return new Promise((resolve) => {
    try {
      inspectedWindow.eval(expression, (result, info) => {
        if (info && (info.isException || info.isError)) {
          resolve({ error: String(info.value || info.description || info.code || "eval failed").slice(0, 300), isException: !!info.isException });
        } else resolve({ value: result });
      });
    } catch (err) {
      resolve({ error: String(err?.message || err), isException: false });
    }
  });
}

/**
 * Installs + polls the collector. `onData({ events, vitals, timeOrigin, now, href, origin, title, newDocument })`
 * is called after every successful poll. `onStatus({ ok, error })` reports availability.
 */
export function createCollectorClient({ inspectedWindow, onData, onStatus, intervalMs = POLL_INTERVAL_MS }) {
  let cursor = 0;
  let timeOrigin = null;
  let timer = 0;
  let running = false;
  let busy = false;
  let failures = 0;
  let needsInstall = true;
  let generation = 0;

  async function install() {
    const res = await evalInPage(inspectedWindow, COLLECTOR_SOURCE);
    if (res.error || !res.value || res.value.installed !== true) {
      onStatus?.({ ok: false, error: res.error || res.value?.error || "collector install failed" });
      return false;
    }
    needsInstall = false;
    return true;
  }

  async function tick() {
    if (!running || busy) return;
    busy = true;
    const gen = generation;
    try {
      if (needsInstall && !(await install())) return backoff();
      const res = await evalInPage(inspectedWindow, pollExpression(cursor));
      if (gen !== generation) return; // navigation reset while in flight
      if (res.error) {
        // An exception usually means the page is mid-navigation or the global was clobbered.
        if (res.isException) needsInstall = true;
        onStatus?.({ ok: false, error: res.error });
        return backoff();
      }
      const v = res.value;
      if (!v || typeof v !== "object" || v.missing) {
        needsInstall = true; // new document (reload / navigation) or never installed
        cursor = 0;
        return;
      }
      failures = 0;
      const to = isNum(v.timeOrigin) ? v.timeOrigin : null;
      const newDocument = timeOrigin !== null && to !== null && Math.abs(to - timeOrigin) > 1;
      if (newDocument || (isNum(v.cursor) && v.cursor < cursor)) cursor = 0;
      timeOrigin = to;
      const entries = Array.isArray(v.entries) ? v.entries.filter((e) => e && isNum(e.seq) && e.seq > cursor) : [];
      const events = [];
      for (const e of entries.slice(-COLLECTOR_CAP)) {
        const ev = mapCollectorEntry(e);
        if (ev) events.push(ev);
      }
      if (isNum(v.cursor)) cursor = Math.max(cursor, v.cursor);
      onStatus?.({ ok: true });
      onData({
        events,
        vitals: validateVitals(v.vitals),
        timeOrigin: to,
        now: isNum(v.now) ? v.now : null,
        href: str(v.href, 2000) || "",
        origin: str(v.origin, 300) || "",
        title: str(v.title, 300) || "",
        newDocument,
      });
    } finally {
      busy = false;
    }
  }

  function backoff() {
    failures += 1;
  }

  function loop() {
    if (!running) return;
    // Back off (up to ~12s) while the page refuses eval, e.g. chrome:// pages.
    const delay = failures ? Math.min(intervalMs * 2 ** Math.min(failures, 3), 12000) : intervalMs;
    timer = setTimeout(async () => {
      await tick();
      loop();
    }, delay);
  }

  return {
    start() {
      if (running) return;
      running = true;
      tick().then(loop);
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    /** Page navigated: the new document needs a fresh collector. */
    reset() {
      generation += 1;
      cursor = 0;
      timeOrigin = null;
      needsInstall = true;
      failures = 0;
      if (running) {
        clearTimeout(timer);
        // Give the new document a moment to exist before evaluating into it.
        timer = setTimeout(async () => {
          await tick();
          loop();
        }, 400);
      }
    },
    pollNow: () => tick(),
    get timeOrigin() {
      return timeOrigin;
    },
  };
}
