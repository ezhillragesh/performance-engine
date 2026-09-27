// Port to the background service worker, with reconnect + invalidation handling.

export function contextValid() {
  try {
    return !!(globalThis.chrome && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

/**
 * @param {{ tabId: number, onMessage(msg): void, onState(state: "open"|"closed"|"invalidated"): void }} opts
 */
export function createConnection({ tabId, onMessage, onState }) {
  let port = null;
  let attempt = 0;
  let timer = null;
  let stopped = false;

  function scheduleReconnect() {
    if (stopped || timer) return;
    const delay = Math.min(250 * 2 ** attempt, 5000);
    attempt++;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, delay);
  }

  function invalidated() {
    stopped = true;
    port = null;
    onState("invalidated");
  }

  function connect() {
    if (stopped) return;
    if (!contextValid()) return invalidated();
    let p;
    try {
      p = chrome.runtime.connect({ name: "devtools" });
    } catch {
      // "Extension context invalidated" throws synchronously after an update/reload.
      if (!contextValid()) return invalidated();
      onState("closed");
      scheduleReconnect();
      return;
    }
    port = p;
    p.onMessage.addListener((msg) => {
      attempt = 0;
      onMessage(msg);
    });
    p.onDisconnect.addListener(() => {
      // Reading lastError prevents "Unchecked runtime.lastError" noise.
      void chrome.runtime.lastError;
      if (port === p) port = null;
      if (!contextValid()) return invalidated();
      onState("closed");
      scheduleReconnect(); // MV3 service worker was terminated or restarted.
    });
    // Background replays stored state once per port in response to this.
    post({ type: "DEVTOOLS_INIT", tabId });
    onState("open");
  }

  function post(message) {
    if (!port) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      port = null;
      if (!contextValid()) invalidated();
      else scheduleReconnect();
      return false;
    }
  }

  return {
    connect,
    get connected() {
      return !!port;
    },
    command(command, payload) {
      return post({ type: "PANEL_COMMAND", tabId, command, payload });
    },
    requestSnapshot() {
      return post({ type: "REQUEST_SNAPSHOT", tabId });
    },
    /** Injection control (PROTOCOL.md v2.1): INJECTION_STATUS_REQUEST / ENABLE_INJECTION / DISABLE_INJECTION. */
    injection(type, origin) {
      return post({ type, tabId, origin, payload: { origin } });
    },
  };
}
