// DevTools-only layer controller: HAR + page collector -> events, Web Vitals and (on demand)
// a synthetic PerfSnapshot. Always running while the panel is open (vitals are shown in every
// mode); snapshots are only built when no engine is present.
import { createHarSource } from "./har.js";
import { createCollectorClient, evalInPage } from "./collector.js";
import { loadAnalyzer, buildPassiveSnapshot } from "./passiveSnapshot.js";
import { validateSnapshot, validateEvents } from "../validate.js";

const COLLECTOR_EVENT_CAP = 1500;
const REBUILD_MIN_INTERVAL_MS = 1000;

/**
 * @param {{
 *   devtools: typeof chrome.devtools,
 *   onSnapshot(snapshot): void,     // validated passive snapshot
 *   onVitals(vitals): void,
 *   onPage(info: { origin, href, title, timeOrigin }): void,
 *   onCollectorStatus?(status: { ok: boolean, error?: string }): void,
 *   wantSnapshots(): boolean,       // true while the panel is in DevTools-only mode
 * }} opts
 */
export function createDevtoolsLayer({ devtools, onSnapshot, onVitals, onPage, onCollectorStatus, wantSnapshots }) {
  let analyzer = null;
  let collectorEvents = [];
  let collectorDropped = 0;
  let timeOrigin = null;
  let href = "";
  let pageNow = 0;
  let paused = false;
  let budgets = null;
  let dirty = true;
  let lastBuild = 0;
  let buildTimer = 0;
  let started = false;
  let lastPageKey = "";
  let collectorFailing = false;

  loadAnalyzer().then((mod) => {
    analyzer = mod;
    markDirty();
  });

  const har = createHarSource({ network: devtools?.network, onChange: markDirty });

  const collector = devtools?.inspectedWindow
    ? createCollectorClient({
        inspectedWindow: devtools.inspectedWindow,
        onStatus: (s) => {
          const failing = !s.ok;
          if (failing !== collectorFailing) {
            collectorFailing = failing;
            markDirty();
          }
          onCollectorStatus?.(s);
        },
        onData: (d) => {
          let changed = false;
          if (d.newDocument) {
            collectorEvents = [];
            collectorDropped = 0;
            changed = true;
          }
          if (d.timeOrigin !== null && d.timeOrigin !== timeOrigin) {
            timeOrigin = d.timeOrigin;
            changed = true;
          }
          if (d.now !== null) pageNow = d.now;
          href = d.href || href;
          const key = `${d.origin}|${d.href}|${d.title}|${d.timeOrigin}`;
          if (key !== lastPageKey) {
            lastPageKey = key;
            onPage({ origin: d.origin, href: d.href, title: d.title, timeOrigin: d.timeOrigin });
          }
          if (d.vitals) onVitals(d.vitals);
          if (!paused && d.events.length) {
            collectorEvents = collectorEvents.concat(d.events);
            if (collectorEvents.length > COLLECTOR_EVENT_CAP) {
              collectorDropped += collectorEvents.length - COLLECTOR_EVENT_CAP;
              collectorEvents = collectorEvents.slice(-COLLECTOR_EVENT_CAP);
            }
            changed = true;
          }
          // A new timeOrigin also re-places HAR entries on the page clock.
          if (changed) markDirty();
        },
      })
    : null;

  function markDirty() {
    dirty = true;
    schedule();
  }

  function schedule() {
    if (buildTimer || !started || !wantSnapshots()) return;
    const wait = Math.max(0, REBUILD_MIN_INTERVAL_MS - (Date.now() - lastBuild));
    buildTimer = setTimeout(() => {
      buildTimer = 0;
      build();
    }, wait);
  }

  /** Page clock origin: the collector's, else (collector unavailable) the first HAR request. */
  function origin() {
    if (timeOrigin !== null) return timeOrigin;
    return collectorFailing ? har.minStart() : null;
  }

  function events(to) {
    const sanitize = analyzer ? analyzer.sanitizeUrl : undefined;
    const net = to === null ? [] : har.toEvents({ timeOrigin: to, sanitize, baseHref: href || undefined });
    return net.concat(collectorEvents);
  }

  function build() {
    if (!dirty || !wantSnapshots()) return;
    // Without a timeOrigin, HAR entries can't be placed on the page clock yet.
    const to = origin();
    if (to === null && collectorEvents.length === 0 && har.size > 0) return;
    dirty = false;
    lastBuild = Date.now();
    const raw = buildPassiveSnapshot(analyzer, {
      events: validateEvents(events(to), 4000),
      budgets,
      timeOrigin: to,
      capturedAt: pageNow,
      paused,
      droppedEvents: collectorDropped,
    });
    const snap = validateSnapshot(raw);
    if (snap) onSnapshot(snap);
  }

  return {
    start() {
      if (started) return;
      started = true;
      har.start();
      collector?.start();
      markDirty();
    },
    /** Page navigated (chrome.devtools.network.onNavigated). */
    navigated() {
      har.reset();
      collector?.reset();
      collectorEvents = [];
      collectorDropped = 0;
      timeOrigin = null;
      lastPageKey = "";
      markDirty();
    },
    /** User cleared recorded data (vitals are page state and stay). */
    clear() {
      har.reset({ reload: false });
      collectorEvents = [];
      collectorDropped = 0;
      markDirty();
    },
    setPaused(p) {
      paused = !!p;
      har.setPaused(paused);
      markDirty();
    },
    get paused() {
      return paused;
    },
    setBudgets(b) {
      budgets = b ? { ...b } : null;
      markDirty();
    },
    /** Re-evaluate whether snapshots are wanted (mode changed) and build immediately. */
    refresh() {
      dirty = true;
      clearTimeout(buildTimer);
      buildTimer = 0;
      build();
    },
    pollNow: () => collector?.pollNow(),
    get hasAnalyzer() {
      return !!analyzer;
    },
    /** One-off `location.origin` lookup (cached by the caller for the permission prompt). */
    fetchOrigin() {
      if (!devtools?.inspectedWindow) return Promise.resolve(null);
      return evalInPage(devtools.inspectedWindow, "location.origin").then((r) => (typeof r.value === "string" ? r.value : null));
    },
  };
}
