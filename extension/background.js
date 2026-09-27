// MV3 service worker: routes page messages (via content script) to DevTools panels by tabId.
// State survives SW termination via chrome.storage.session.

const PORTS = new Map(); // tabId -> Set<Port>
const TABS = new Map(); // tabId -> { hello, snapshot, legacy: { INSIGHTS_UPDATE, EVENTS_UPDATE }, url }
const LOADING = new Map(); // tabId -> Promise<state>
const QUEUES = new Map(); // tabId -> Promise (serializes async handling per tab)
const PERSIST_TIMERS = new Map();

const PAGE_TYPES = new Set(["HELLO", "SNAPSHOT", "RESET", "INSIGHTS_UPDATE", "EVENTS_UPDATE"]);
const COMMANDS = new Set(["PING", "ATTACH", "DETACH", "REQUEST_SNAPSHOT", "CLEAR", "PAUSE", "RESUME", "SET_BUDGETS"]);
const PERSIST_DELAY_MS = 1500;
const PERSIST_EVENTS = 1000;
const PERSIST_MAX_CHARS = 3000000;
// storage.session holds 10 MB in total (all tabs). Keep the sum of persisted tab records
// under this budget by evicting the least recently updated tabs' records (their live
// in-memory state is kept; only the copy that survives a service-worker restart is dropped).
const PERSIST_TOTAL_CHARS = 8000000;
const INDEX_KEY = "tab-index"; // { [tabId]: { chars, at } }
const DETACH_THROTTLE_MS = 1000;
const LAST_DETACH = new Map(); // tabId -> time an orphan-stream DETACH was sent

const storageKey = (tabId) => `tab:${tabId}`;

let persistIndex = null; // lazily loaded mirror of INDEX_KEY

function loadIndex() {
  if (persistIndex) return Promise.resolve(persistIndex);
  return chrome.storage.session
    .get(INDEX_KEY)
    .then((got) => {
      if (!persistIndex) persistIndex = isObj(got && got[INDEX_KEY]) ? got[INDEX_KEY] : {};
      return persistIndex;
    })
    .catch(() => {
      if (!persistIndex) persistIndex = {};
      return persistIndex;
    });
}

function emptyState() {
  return { hello: null, snapshot: null, legacy: {}, url: null };
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ── State ────────────────────────────────────────────────────────────

function getTab(tabId) {
  if (TABS.has(tabId)) return Promise.resolve(TABS.get(tabId));
  if (LOADING.has(tabId)) return LOADING.get(tabId);
  const p = chrome.storage.session
    .get(storageKey(tabId))
    .then((got) => {
      const stored = got && got[storageKey(tabId)];
      // Another path may have populated the tab meanwhile; prefer in-memory.
      if (!TABS.has(tabId)) TABS.set(tabId, isObj(stored) ? { ...emptyState(), ...stored } : emptyState());
      return TABS.get(tabId);
    })
    .catch(() => {
      if (!TABS.has(tabId)) TABS.set(tabId, emptyState());
      return TABS.get(tabId);
    })
    .finally(() => LOADING.delete(tabId));
  LOADING.set(tabId, p);
  return p;
}

function enqueue(tabId, fn) {
  const prev = QUEUES.get(tabId) || Promise.resolve();
  const next = prev.then(fn).catch((err) => console.warn("[perf-devtools] background error", err));
  QUEUES.set(tabId, next);
  return next;
}

function trimMessage(msg, maxEvents) {
  if (!isObj(msg) || !isObj(msg.payload) || !Array.isArray(msg.payload.events)) return msg;
  return { ...msg, payload: { ...msg.payload, events: msg.payload.events.slice(-maxEvents) } };
}

function schedulePersist(tabId) {
  if (PERSIST_TIMERS.has(tabId)) return;
  PERSIST_TIMERS.set(
    tabId,
    setTimeout(() => {
      PERSIST_TIMERS.delete(tabId);
      persist(tabId);
    }, PERSIST_DELAY_MS),
  );
}

function persist(tabId) {
  const state = TABS.get(tabId);
  if (!state) return;
  const build = (maxEvents) => ({
    hello: state.hello,
    url: state.url,
    snapshot: maxEvents < 0 ? null : trimMessage(state.snapshot, maxEvents),
    legacy: maxEvents < 0 ? {} : {
      INSIGHTS_UPDATE: state.legacy.INSIGHTS_UPDATE,
      EVENTS_UPDATE: state.legacy.EVENTS_UPDATE && Array.isArray(state.legacy.EVENTS_UPDATE.payload)
        ? { ...state.legacy.EVENTS_UPDATE, payload: state.legacy.EVENTS_UPDATE.payload.slice(-maxEvents) }
        : undefined,
    },
  });
  // Stay well within the storage.session quota: shrink until it fits.
  let record = null;
  let chars = 0;
  for (const n of [PERSIST_EVENTS, 300, 0, -1]) {
    record = build(n);
    try {
      chars = JSON.stringify(record).length;
      if (chars <= PERSIST_MAX_CHARS) break;
    } catch {
      record = build(-1);
      chars = 0;
      break;
    }
  }
  void loadIndex().then((index) => {
    if (!TABS.has(tabId)) return; // tab closed meanwhile
    const key = String(tabId);
    index[key] = { chars, at: Date.now() };
    // Global budget: evict least recently updated other tabs until everything fits.
    const evict = [];
    let total = 0;
    for (const k of Object.keys(index)) total += index[k].chars || 0;
    const byAge = Object.keys(index)
      .filter((k) => k !== key)
      .sort((a, b) => (index[a].at || 0) - (index[b].at || 0));
    while (total > PERSIST_TOTAL_CHARS && byAge.length > 0) {
      const k = byAge.shift();
      total -= index[k].chars || 0;
      delete index[k];
      evict.push(storageKey(k));
    }
    if (evict.length > 0) chrome.storage.session.remove(evict).catch(() => {});
    chrome.storage.session.set({ [storageKey(tabId)]: record, [INDEX_KEY]: index }).catch(() => {});
  });
}

function clearTab(tabId) {
  TABS.delete(tabId);
  clearTimeout(PERSIST_TIMERS.get(tabId));
  PERSIST_TIMERS.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId)).catch(() => {});
  void loadIndex().then((index) => {
    if (!(String(tabId) in index)) return;
    delete index[String(tabId)];
    chrome.storage.session.set({ [INDEX_KEY]: index }).catch(() => {});
  });
}

// ── Messaging helpers ────────────────────────────────────────────────

function broadcast(tabId, message) {
  const ports = PORTS.get(tabId);
  if (!ports) return;
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

function sendCommand(tabId, command, payload) {
  try {
    chrome.tabs
      .sendMessage(tabId, { type: "PANEL_COMMAND", command, payload }, { frameId: 0 })
      .catch(() => {}); // no content script / engine on this page
  } catch {
    /* tab gone */
  }
}

function hasPanel(tabId) {
  const ports = PORTS.get(tabId);
  return !!ports && ports.size > 0;
}

// ── Page -> panel ────────────────────────────────────────────────────

async function handlePageMessage(tabId, msg) {
  const state = await getTab(tabId);
  switch (msg.type) {
    case "HELLO": {
      const sessionId = isObj(msg.payload) ? msg.payload.sessionId : undefined;
      if (state.hello && state.hello.payload && state.hello.payload.sessionId !== sessionId) {
        // New session (page reload or re-init): drop stale data.
        state.snapshot = null;
        state.legacy = {};
      }
      state.hello = msg;
      if (isObj(msg.payload) && typeof msg.payload.url === "string") state.url = msg.payload.url.slice(0, 2000);
      broadcast(tabId, { type: "CONNECTION", engineDetected: true });
      broadcast(tabId, { type: "PERF_MESSAGE", payload: msg });
      if (hasPanel(tabId)) sendCommand(tabId, "ATTACH"); // resume streaming after reload
      break;
    }
    case "SNAPSHOT":
      state.snapshot = msg;
      broadcast(tabId, { type: "PERF_MESSAGE", payload: msg });
      // Snapshots only stream while a panel is attached. None is (e.g. the panel closed
      // while this service worker was stopped and never saw the port disconnect): stop it.
      if (!hasPanel(tabId)) {
        const now = Date.now();
        if (now - (LAST_DETACH.get(tabId) || 0) >= DETACH_THROTTLE_MS) {
          LAST_DETACH.set(tabId, now);
          sendCommand(tabId, "DETACH");
        }
      }
      break;
    case "RESET":
      state.snapshot = null;
      state.legacy = {};
      broadcast(tabId, { type: "PERF_MESSAGE", payload: msg });
      break;
    default:
      state.legacy[msg.type] = msg;
      broadcast(tabId, { type: "PERF_MESSAGE", payload: msg });
  }
  schedulePersist(tabId);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!sender.tab || typeof sender.tab.id !== "number" || sender.frameId !== 0) return; // top frame only
  if (!isObj(message) || message.type !== "PERF_MESSAGE") return;
  const payload = message.payload;
  if (!isObj(payload) || payload.source !== "perf-engine" || !PAGE_TYPES.has(payload.type)) return;
  const tabId = sender.tab.id;
  enqueue(tabId, () => handlePageMessage(tabId, payload));
});

// ── Panel <-> background ─────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") return;
  if (port.sender && port.sender.id !== chrome.runtime.id) return port.disconnect();
  let tabId = null;

  port.onMessage.addListener((message) => {
    if (!isObj(message)) return;

    if (message.type === "DEVTOOLS_INIT") {
      if (tabId !== null || !Number.isInteger(message.tabId)) return; // one init per port
      tabId = message.tabId;
      const id = tabId;
      if (!PORTS.has(id)) PORTS.set(id, new Set());
      const ports = PORTS.get(id);
      ports.add(port);
      const first = ports.size === 1;
      enqueue(id, async () => {
        const state = await getTab(id);
        // Replay stored state to this port only, exactly once.
        const post = (m) => {
          try {
            port.postMessage(m);
          } catch {
            /* port closed */
          }
        };
        post({ type: "CONNECTION", engineDetected: !!state.hello });
        if (state.hello) post({ type: "PERF_MESSAGE", payload: state.hello });
        if (state.snapshot) post({ type: "PERF_MESSAGE", payload: state.snapshot });
        else {
          if (state.legacy.INSIGHTS_UPDATE) post({ type: "PERF_MESSAGE", payload: state.legacy.INSIGHTS_UPDATE });
          if (state.legacy.EVENTS_UPDATE) post({ type: "PERF_MESSAGE", payload: state.legacy.EVENTS_UPDATE });
        }
        if (first) sendCommand(id, "ATTACH");
        sendCommand(id, "PING"); // lets the panel learn whether an engine exists
      });
      return;
    }

    if (tabId === null) return;

    if (INJECTION_TYPES.has(message.type)) {
      handleInjectionMessage(port, tabId, message);
      return;
    }

    if (message.type === "REQUEST_SNAPSHOT") {
      sendCommand(tabId, "REQUEST_SNAPSHOT");
      return;
    }

    if (message.type === "PANEL_COMMAND" && typeof message.command === "string" && COMMANDS.has(message.command)) {
      const payload = message.command === "SET_BUDGETS" && isObj(message.payload) ? message.payload : undefined;
      if (message.command === "CLEAR") {
        const id = tabId;
        enqueue(id, async () => {
          const state = await getTab(id);
          state.snapshot = null;
          state.legacy = {};
          schedulePersist(id);
        });
      }
      sendCommand(tabId, message.command, payload);
    }
  });

  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (tabId === null) return;
    const ports = PORTS.get(tabId);
    if (!ports) return;
    ports.delete(port);
    if (ports.size === 0) {
      PORTS.delete(tabId);
      sendCommand(tabId, "DETACH"); // zero overhead when DevTools is closed
    }
  });
});

// ── Injected engine (docs/PROTOCOL.md "Engine modes & DevTools-only layer") ──
//
// Per-site opt-in: the panel requests the host permission (user gesture), then
// asks us to register vendor/perf-engine.inject.js into the page MAIN world.

const INJECTION_TYPES = new Set(["INJECTION_STATUS_REQUEST", "ENABLE_INJECTION", "DISABLE_INJECTION"]);
const INJECT_SCRIPT = "vendor/perf-engine.inject.js";
const INJECT_ID_PREFIX = "perf-inject:";
const INJECT_MAP_KEY = "inject-origins"; // chrome.storage.local: { [scriptId]: origin }
let injectQueue = Promise.resolve(); // serializes register/unregister (duplicate ids throw)

function queueInjection(fn) {
  const next = injectQueue.then(fn);
  injectQueue = next.catch(() => {});
  return next;
}

/** "https://host[:port]" only: http/https, no path, query, hash or credentials. */
function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname || url.origin === "null") return null;
  // new URL normalises: equality rejects paths ("/", "/x"), queries, hashes, userinfo, odd casing.
  return url.origin === value ? url.origin : null;
}

/** Content-script ids must not contain some characters: hex-escape everything but [A-Za-z0-9.-]. */
function injectScriptId(origin) {
  return INJECT_ID_PREFIX + origin.replace(/[^A-Za-z0-9.-]/g, (c) => "_" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

function originPattern(origin) {
  return origin + "/*";
}

async function loadInjectMap() {
  try {
    const got = await chrome.storage.local.get(INJECT_MAP_KEY);
    return isObj(got && got[INJECT_MAP_KEY]) ? got[INJECT_MAP_KEY] : {};
  } catch {
    return {};
  }
}

async function saveInjectMap(map) {
  try {
    await chrome.storage.local.set({ [INJECT_MAP_KEY]: map });
  } catch {
    /* ignore */
  }
}

async function isRegistered(id) {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    return Array.isArray(scripts) && scripts.some((s) => s && s.id === id);
  } catch {
    return false;
  }
}

async function hasHostPermission(origin) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(origin)] });
  } catch {
    return false;
  }
}

async function injectionStatus(origin) {
  const [enabled, granted] = await Promise.all([isRegistered(injectScriptId(origin)), hasHostPermission(origin)]);
  return { origin, enabled, granted };
}

async function enableInjection(origin) {
  if (!(await hasHostPermission(origin))) return false; // panel must request it first (user gesture)
  const id = injectScriptId(origin);
  const script = {
    id,
    matches: [originPattern(origin)],
    js: [INJECT_SCRIPT],
    runAt: "document_start",
    world: "MAIN",
    allFrames: false,
    persistAcrossSessions: true,
  };
  if (await isRegistered(id)) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
  const map = await loadInjectMap();
  map[id] = origin;
  await saveInjectMap(map);
  return true;
}

async function unregisterInjection(ids) {
  const registered = [];
  for (const id of ids) if (await isRegistered(id)) registered.push(id);
  if (registered.length > 0) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: registered });
    } catch (err) {
      console.warn("[perf-devtools] unregister failed", err);
    }
  }
  const map = await loadInjectMap();
  let changed = false;
  for (const id of ids) {
    if (id in map) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await saveInjectMap(map);
}

async function disableInjection(origin, removePermission) {
  await unregisterInjection([injectScriptId(origin)]);
  if (removePermission) {
    try {
      await chrome.permissions.remove({ origins: [originPattern(origin)] });
    } catch {
      /* e.g. permission was granted as a required one */
    }
  }
}

function reloadTab(tabId) {
  try {
    chrome.tabs.reload(tabId).catch(() => {});
  } catch {
    /* tab gone */
  }
}

function handleInjectionMessage(port, tabId, message) {
  const reply = (m) => {
    try {
      port.postMessage(m);
    } catch {
      /* port closed */
    }
  };
  const origin = normalizeOrigin(message.origin);
  if (!origin) {
    reply({
      type: "INJECTION_STATUS",
      origin: typeof message.origin === "string" ? message.origin.slice(0, 300) : "",
      enabled: false,
      granted: false,
      error: "invalid-origin",
    });
    return;
  }
  void queueInjection(async () => {
    let error;
    try {
      if (message.type === "ENABLE_INJECTION") {
        if (await enableInjection(origin)) reloadTab(tabId);
      } else if (message.type === "DISABLE_INJECTION") {
        await disableInjection(origin, message.removePermission === true);
        reloadTab(tabId);
      }
    } catch (err) {
      error = String((err && err.message) || err).slice(0, 300);
      console.warn("[perf-devtools] injection change failed", err);
    }
    const status = await injectionStatus(origin);
    reply(error ? { type: "INJECTION_STATUS", ...status, error } : { type: "INJECTION_STATUS", ...status });
  });
}

// Revoking site access (chrome://extensions, the puzzle menu) must also stop injection there.
if (chrome.permissions && chrome.permissions.onRemoved) {
  chrome.permissions.onRemoved.addListener((removed) => {
    const origins = removed && Array.isArray(removed.origins) ? removed.origins : [];
    if (origins.length === 0) return;
    void queueInjection(async () => {
      const map = await loadInjectMap();
      const ids = [];
      for (const [id, origin] of Object.entries(map)) {
        // The site may still be covered by another granted pattern: check, don't pattern-match.
        if (typeof origin !== "string" || !(await hasHostPermission(origin))) ids.push(id);
      }
      if (ids.length > 0) await unregisterInjection(ids);
    });
  });
}

// ── Tab lifecycle ────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  PORTS.delete(tabId);
  QUEUES.delete(tabId);
  LAST_DETACH.delete(tabId);
  clearTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  enqueue(tabId, async () => {
    const state = await getTab(tabId);
    const url = typeof changeInfo.url === "string" ? changeInfo.url : null;
    // Without the "tabs" permission the URL may be unavailable; treat unknown as a navigation.
    if (url !== null && state.url !== null && url === state.url) return;
    const hadData = !!(state.hello || state.snapshot);
    clearTab(tabId);
    TABS.set(tabId, { ...emptyState(), url });
    if (hasPanel(tabId)) {
      broadcast(tabId, { type: "TAB_NAVIGATED", url });
      // Same-document navigations keep the engine alive: ask it to re-announce itself.
      if (hadData) sendCommand(tabId, "PING");
    }
  });
});
