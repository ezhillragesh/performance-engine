// DevTools-only network source: chrome.devtools.network HAR entries -> NetworkEvent
// (docs/PROTOCOL.md "DevTools-only layer"). Pure mapping helpers are exported for Node tests.

export const HAR_CAP = 2000;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Fallback for the analyzer bundle's sanitizeUrl (same rules): same-origin -> `/path`,
 * cross-origin -> `host/path`, query values dropped (names kept), hash dropped.
 */
export function sanitizeUrlFallback(rawUrl, baseHref) {
  try {
    const base = baseHref || "http://localhost/";
    const parsed = new URL(rawUrl, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return parsed.protocol;
    const prefix = parsed.origin === new URL(base).origin ? "" : parsed.host;
    let query = "";
    if (parsed.search.length > 1) query = `?${[...new Set(parsed.searchParams.keys())].join("&")}`;
    return `${prefix}${parsed.pathname}${query}`;
  } catch {
    return String(rawUrl).split(/[?#]/)[0];
  }
}

/** Identity used to dedupe getHAR() entries against onRequestFinished ones. */
export function harEntryKey(entry) {
  const req = entry?.request || {};
  return `${entry?.startedDateTime}|${req.method}|${req.url}`;
}

/**
 * Extracts the fields we need from a HAR entry (the entry object itself is large and holds
 * getContent()). Returns null for non-http(s) or malformed entries.
 */
export function normalizeHarEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const req = entry.request;
  const res = entry.response || {};
  if (!req || typeof req.url !== "string" || !/^https?:/i.test(req.url)) return null;
  const started = Date.parse(entry.startedDateTime);
  if (!isNum(started)) return null;
  const status = isNum(res.status) ? res.status : 0;
  const rawError = typeof res._error === "string" && res._error ? res._error : null;
  let error;
  if (rawError && /ERR_ABORTED/i.test(rawError)) error = "aborted";
  else if (rawError) error = rawError.slice(0, 200);
  else if (status === 0) error = "failed";
  const transfer = isNum(res._transferSize) && res._transferSize > 0 ? res._transferSize : null;
  const body = isNum(res.bodySize) && res.bodySize >= 0 ? res.bodySize : null;
  const type = typeof entry._resourceType === "string" ? entry._resourceType : "";
  return {
    key: harEntryKey(entry),
    startedMs: started,
    time: isNum(entry.time) && entry.time > 0 ? entry.time : 0,
    method: typeof req.method === "string" ? req.method.toUpperCase().slice(0, 10) : "GET",
    url: req.url,
    status,
    fromCache: !!entry._fromCache,
    responseSize: transfer ?? body ?? undefined,
    initiator: type === "fetch" ? "fetch" : type === "xhr" ? "xhr" : undefined,
    resourceType: type,
    error,
  };
}

/**
 * Maps a normalized record to a NetworkEvent. `timestamp = startedMs - timeOrigin`.
 * Records that started before this document (previous page) are dropped.
 */
export function mapHarRecord(rec, { timeOrigin, sanitize = sanitizeUrlFallback, baseHref, sessionId = "devtools" }) {
  if (!rec || !isNum(timeOrigin)) return null;
  const timestamp = Math.round((rec.startedMs - timeOrigin) * 100) / 100;
  if (timestamp < -100) return null;
  const ts = Math.max(0, timestamp);
  const duration = Math.round(rec.time * 100) / 100;
  let url;
  try {
    url = sanitize(rec.url, baseHref);
  } catch {
    url = sanitizeUrlFallback(rec.url, baseHref);
  }
  const ev = {
    type: "network",
    eventId: `har-${rec.seq}`,
    sessionId,
    timestamp: ts,
    url: typeof url === "string" && url ? url : "(unknown)",
    method: rec.method,
    duration,
    endTime: ts + duration,
    status: rec.status,
    fromCache: rec.fromCache,
  };
  if (isNum(rec.responseSize)) ev.responseSize = rec.responseSize;
  if (rec.initiator) ev.initiator = rec.initiator;
  if (rec.error) ev.error = rec.error;
  return ev;
}

/**
 * Collects HAR entries from chrome.devtools.network. `onChange()` fires when records change.
 * Records are kept normalized and mapped lazily, because the page's timeOrigin may only be
 * known after the collector's first poll.
 */
export function createHarSource({ network, onChange, cap = HAR_CAP }) {
  let records = new Map(); // key -> record (insertion order = arrival order)
  let seen = new WeakSet();
  let seq = 0;
  let paused = false;
  let started = false;

  function ingest(entries, { force = false } = {}) {
    if (paused && !force) return;
    let changed = false;
    for (const entry of entries || []) {
      if (!entry || typeof entry !== "object" || seen.has(entry)) continue;
      seen.add(entry);
      const rec = normalizeHarEntry(entry);
      if (!rec) continue;
      const prev = records.get(rec.key);
      if (prev) {
        // Same request seen via getHAR() and onRequestFinished: keep the id, take the newer data.
        if (rec.time >= prev.time) {
          records.set(rec.key, { ...rec, seq: prev.seq });
          changed = true;
        }
        continue;
      }
      seq += 1;
      records.set(rec.key, { ...rec, seq });
      changed = true;
    }
    while (records.size > cap) {
      records.delete(records.keys().next().value);
      changed = true;
    }
    if (changed) onChange?.();
  }

  const onFinished = (request) => ingest([request]);

  function loadHar() {
    try {
      network.getHAR((log) => ingest(log?.entries, { force: false }));
    } catch {
      /* not available */
    }
  }

  return {
    start() {
      if (started || !network) return;
      started = true;
      loadHar();
      try {
        network.onRequestFinished.addListener(onFinished);
      } catch {
        /* not available */
      }
    },
    stop() {
      started = false;
      try {
        network.onRequestFinished.removeListener(onFinished);
      } catch {
        /* ignore */
      }
    },
    /** Navigation / clear: drop everything (ids keep increasing so they never collide). */
    reset({ reload = true } = {}) {
      records = new Map();
      seen = new WeakSet();
      onChange?.();
      // The new document's own request may have finished before onNavigated fired; getHAR()
      // picks it up (older entries kept by "Preserve log" are dropped by timestamp).
      if (reload && started) setTimeout(loadHar, 600);
    },
    setPaused(p) {
      paused = !!p;
    },
    get size() {
      return records.size;
    },
    /** Earliest request start (epoch ms), a timeOrigin stand-in when the collector can't run. */
    minStart() {
      let min = null;
      for (const r of records.values()) if (min === null || r.startedMs < min) min = r.startedMs;
      return min;
    },
    ingest,
    toEvents(opts) {
      const out = [];
      for (const rec of records.values()) {
        const ev = mapHarRecord(rec, opts);
        if (ev) out.push(ev);
      }
      return out;
    },
  };
}
