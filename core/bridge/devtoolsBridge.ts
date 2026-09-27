/**
 * Page side of the DevTools protocol (docs/PROTOCOL.md).
 *
 * Sends HELLO on start and on PING. Streams throttled SNAPSHOTs only while a
 * panel is attached and only when data changed, so the cost is ~zero when
 * DevTools is closed.
 */

import type { PerformanceBudgets } from "../types/insights.js";
import {
  ENGINE_VERSION,
  PAGE_MESSAGE_SOURCE,
  PANEL_MESSAGE_SOURCE,
  PROTOCOL_VERSION,
  type HelloPayload,
  type PageMessage,
  type PanelCommand,
  type PanelCommandMessage,
  type PerfSnapshot,
} from "../types/protocol.js";
import { getTimeOrigin, now } from "../tracker/time.js";

/** The subset of PerfEngineSession the bridge needs (keeps it testable). */
export interface BridgeSession {
  readonly sessionId: string;
  getSnapshot(options?: { maxEvents?: number }): PerfSnapshot;
  isPaused(): boolean;
  pause(): void;
  resume(): void;
  clear(): void;
  setBudgets(budgets: Partial<PerformanceBudgets>): void;
  /** Cheap change token; when absent the bridge derives one from the snapshot. */
  getChangeSignature?(): string;
  /** Called with a listener that fires when the session is cleared. */
  onReset?(listener: () => void): () => void;
}

export interface DevtoolsBridgeOptions {
  /** Min interval between streamed snapshots, ms. Default 1000. */
  snapshotIntervalMs?: number;
  /** Events per snapshot. Default 1500. */
  maxEvents?: number;
  /** Tracking flags reported in HELLO. */
  getConfig?: () => HelloPayload["config"];
  /** Window to talk through (tests). Defaults to the global window. */
  target?: Window;
  /**
   * Stay silent until the document is parsed: the initial HELLO is sent after
   * DOMContentLoaded and panel commands (PING, ATTACH, ...) received before
   * are ignored (the background re-sends ATTACH when it sees the HELLO). Used
   * by the injected engine: an app engine loading later in the same document
   * replaces it, so the panel never sees the short-lived injected session.
   */
  deferInitialHello?: boolean;
}

const COMMANDS: ReadonlySet<string> = new Set<PanelCommand>([
  "PING",
  "ATTACH",
  "DETACH",
  "REQUEST_SNAPSHOT",
  "CLEAR",
  "PAUSE",
  "RESUME",
  "SET_BUDGETS",
]);

export function isPanelCommandMessage(data: unknown): data is PanelCommandMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.source === PANEL_MESSAGE_SOURCE &&
    msg.version === PROTOCOL_VERSION &&
    msg.type === "COMMAND" &&
    typeof msg.command === "string" &&
    COMMANDS.has(msg.command)
  );
}

function sanitizeBudgets(payload: unknown): Partial<PerformanceBudgets> {
  const out: Partial<PerformanceBudgets> = {};
  if (!payload || typeof payload !== "object") return out;
  const keys: (keyof PerformanceBudgets)[] = [
    "interactionLatencyMs",
    "longTaskMs",
    "componentRenderMs",
    "rendersPerInteraction",
    "networkRequestMs",
    "wastedRenderPct",
  ];
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

function defaultConfig(): HelloPayload["config"] {
  return {
    trackEvents: true,
    trackNetwork: true,
    trackRenders: true,
    trackLongTasks: true,
    trackInteractions: true,
    react: false,
    mode: "app",
  };
}

function pageUrl(win: Window): string {
  try {
    // Origin + path only: query strings may carry PII.
    return `${win.location.origin}${win.location.pathname}`;
  } catch {
    return "";
  }
}

export function startDevtoolsBridge(session: BridgeSession, options: DevtoolsBridgeOptions = {}): () => void {
  const win: Window | undefined = options.target ?? (typeof window !== "undefined" ? window : undefined);
  if (!win || typeof win.postMessage !== "function" || typeof win.addEventListener !== "function") {
    return () => undefined;
  }
  const intervalMs = Math.max(100, options.snapshotIntervalMs ?? 1000);
  const maxEvents = Math.max(0, options.maxEvents ?? 1500);
  let attached = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSignature = "";
  let stopped = false;

  const post = (message: PageMessage): void => {
    try {
      win.postMessage(message, "*");
    } catch {
      // DataCloneError (e.g. a custom rule put a function in metadata): fall back to JSON.
      try {
        win.postMessage(JSON.parse(JSON.stringify(message)) as PageMessage, "*");
      } catch {
        // give up silently
      }
    }
  };

  const signature = (): string => {
    if (typeof session.getChangeSignature === "function") return session.getChangeSignature();
    const snapshot = session.getSnapshot({ maxEvents: 1 });
    const last = snapshot.events[snapshot.events.length - 1];
    return `${snapshot.summary.renders}|${last?.eventId ?? ""}|${snapshot.insights.map((i) => i.id).join(",")}|${snapshot.paused}`;
  };

  const readConfig = (): HelloPayload["config"] => (options.getConfig ? options.getConfig() : defaultConfig());
  let helloConfigKey = "";
  const sendHello = (): void => {
    const config = readConfig();
    helloConfigKey = JSON.stringify(config);
    const payload: HelloPayload = {
      sessionId: session.sessionId,
      engineVersion: ENGINE_VERSION,
      url: pageUrl(win),
      title: typeof win.document?.title === "string" ? win.document.title : "",
      timeOrigin: getTimeOrigin(),
      config,
    };
    post({ source: PAGE_MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: "HELLO", payload, timestamp: now() });
  };

  const sendSnapshot = (): void => {
    try {
      const snapshot = session.getSnapshot({ maxEvents });
      lastSignature = signature();
      post({ source: PAGE_MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: "SNAPSHOT", payload: snapshot, timestamp: now() });
    } catch {
      // never throw into the page
    }
  };

  const sendReset = (): void => {
    post({
      source: PAGE_MESSAGE_SOURCE,
      version: PROTOCOL_VERSION,
      type: "RESET",
      payload: { sessionId: session.sessionId },
      timestamp: now(),
    });
  };

  const tick = (): void => {
    if (!attached) return;
    try {
      if (signature() !== lastSignature) sendSnapshot();
    } catch {
      // ignore
    }
  };

  /** Re-announces when the reported config changed (e.g. React registered after start). */
  const refreshHello = (): void => {
    try {
      if (JSON.stringify(readConfig()) !== helloConfigKey) sendHello();
    } catch {
      // ignore
    }
  };

  const attach = (): void => {
    refreshHello();
    attached = true;
    if (!timer) {
      timer = setInterval(tick, intervalMs);
    }
    sendSnapshot();
  };

  const detach = (): void => {
    attached = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  let resetFromCommand = false;
  const unsubscribeReset =
    typeof session.onReset === "function"
      ? session.onReset(() => {
          // App-initiated clear(): tell the panel. Command-initiated clears reply themselves.
          if (!resetFromCommand) {
            sendReset();
            if (attached) sendSnapshot();
          }
        })
      : () => undefined;

  const handleCommand = (msg: PanelCommandMessage): void => {
    switch (msg.command) {
      case "PING":
        sendHello();
        break;
      case "ATTACH":
        attach();
        break;
      case "DETACH":
        detach();
        break;
      case "REQUEST_SNAPSHOT":
        sendSnapshot();
        break;
      case "CLEAR":
        resetFromCommand = true;
        try {
          session.clear();
        } finally {
          resetFromCommand = false;
        }
        sendReset();
        sendSnapshot();
        break;
      case "PAUSE":
        session.pause();
        sendSnapshot();
        break;
      case "RESUME":
        session.resume();
        sendSnapshot();
        break;
      case "SET_BUDGETS":
        session.setBudgets(sanitizeBudgets(msg.payload));
        sendSnapshot();
        break;
    }
  };

  let announced = false;
  const onMessage = (event: MessageEvent): void => {
    if (stopped || !announced) return;
    try {
      if (event.source !== win) return;
      if (!isPanelCommandMessage(event.data)) return;
      handleCommand(event.data);
    } catch {
      // never throw into the page
    }
  };

  win.addEventListener("message", onMessage);

  let helloTimer: ReturnType<typeof setTimeout> | undefined;
  const announce = (): void => {
    if (stopped || announced) return;
    announced = true;
    sendHello();
    // The engine starts before the framework loads (by design), so e.g. the
    // `react` flag is only known once React has registered: re-check after the
    // current task.
    helloTimer = setTimeout(() => {
      if (!stopped) refreshHello();
    }, 0);
  };
  const doc = win.document as Document | undefined;
  let onReady: (() => void) | null = null;
  if (options.deferInitialHello && doc && doc.readyState === "loading" && typeof doc.addEventListener === "function") {
    onReady = () => {
      doc.removeEventListener("DOMContentLoaded", onReady!);
      onReady = null;
      // After the DOMContentLoaded handlers, where an app engine may start.
      helloTimer = setTimeout(announce, 0);
    };
    doc.addEventListener("DOMContentLoaded", onReady);
  } else {
    announce();
  }

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(helloTimer);
    if (onReady && doc) doc.removeEventListener("DOMContentLoaded", onReady);
    detach();
    unsubscribeReset();
    win.removeEventListener("message", onMessage);
  };
}
